ts
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireUserId, unauthorizedResponse } from '@/lib/get-session'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
    let userId: string

    try {
      userId = await requireUserId()
    } catch {
      return unauthorizedResponse()
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: '2025-02-24.acacia',
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user?.email ?? undefined,
      client_reference_id: userId,
      metadata: {
        userId,
      },
      subscription_data: {
        metadata: {
          userId,
        },
      },
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_MONTHLY,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe Checkout Error:', error)
    return NextResponse.json({ error: 'Error creating checkout session' }, { status: 500 })
  }
}

