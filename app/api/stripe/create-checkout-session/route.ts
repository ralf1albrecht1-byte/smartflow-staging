import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { mapPriceIdToPlan, resolvePriceId, validateStripeEnv } from '@/lib/stripe-helpers';
import { handleAuthError, requireUserId } from '@/lib/get-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    validateStripeEnv();

    let userId: string;
    try {
      userId = await requireUserId();
    } catch (authError) {
      return handleAuthError(authError);
    }

    const body = await request.json().catch(() => null);
    const priceId = typeof body?.priceId === 'string' ? body.priceId.trim() : '';

    if (!priceId) {
      return NextResponse.json({ error: 'priceId ist erforderlich.' }, { status: 400 });
    }

    const resolvedPriceId = resolvePriceId(priceId);
    const mappedPlan = mapPriceIdToPlan(priceId) || (resolvedPriceId ? mapPriceIdToPlan(resolvedPriceId) : null);

    if (!resolvedPriceId || !mappedPlan) {
      return NextResponse.json({ error: 'Ungültige priceId.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    }

    const stripe = getStripeClient();

    const successUrl = new URL('/dashboard?checkout=success', request.url).toString();
    const cancelUrl = new URL('/dashboard?checkout=cancelled', request.url).toString();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      client_reference_id: userId,
      metadata: {
        userId,
        plan: mappedPlan,
      },
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      console.error('[stripe][checkout] Missing checkout URL', { userId, priceId, sessionId: session.id });
      return NextResponse.json({ error: 'Checkout-Session konnte nicht erstellt werden.' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('[stripe][checkout] Failed to create checkout session', {
      message: error?.message,
      type: error?.type,
      code: error?.code,
    });

    return NextResponse.json(
      { error: 'Fehler beim Erstellen der Stripe Checkout Session.' },
      { status: 500 },
    );
  }
}
