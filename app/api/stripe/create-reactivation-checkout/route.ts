import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY fehlt');
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
  });
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json().catch(() => ({}));

    const normalizedEmail =
      typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'E-Mail und Passwort sind erforderlich.' },
        { status: 400 },
      );
    }

    if (!process.env.STRIPE_PRICE_ID_MONTHLY) {
      return NextResponse.json(
        { error: 'STRIPE_PRICE_ID_MONTHLY fehlt' },
        { status: 500 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        password: true,
        emailVerified: true,
        stripeCustomerId: true,
        accountStatus: true,
        anonymizedAt: true,
      },
    });

    if (!user?.email || !user.password) {
      return NextResponse.json(
        { error: 'Zugangsdaten ungültig.' },
        { status: 401 },
      );
    }

    const passwordOk = await bcrypt.compare(password, user.password);

    if (!passwordOk) {
      return NextResponse.json(
        { error: 'Zugangsdaten ungültig.' },
        { status: 401 },
      );
    }

    if (!user.emailVerified) {
      return NextResponse.json(
        { error: 'Bitte bestätige zuerst deine E-Mail-Adresse.' },
        { status: 403 },
      );
    }

    if (user.anonymizedAt || user.accountStatus === 'anonymized') {
      return NextResponse.json(
        {
          error:
            'Dieses Konto wurde anonymisiert und kann nicht wiederhergestellt werden.',
        },
        { status: 403 },
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      'http://localhost:3000';

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_MONTHLY,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          userId: user.id,
          plan: 'standard',
          flow: 'reactivation',
        },
      },
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        plan: 'standard',
        source: 'reactivation-login',
      },
      success_url: `${appUrl}/login?reactivation=success`,
      cancel_url: `${appUrl}/login?reactivation=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('[stripe/create-reactivation-checkout] error:', error);

    return NextResponse.json(
      { error: 'Abo konnte nicht neu gestartet werden.' },
      { status: 500 },
    );
  }
}