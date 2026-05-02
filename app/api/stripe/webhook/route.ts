
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-02-24.acacia',
})

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature') as string

  let event: Stripe.Event

  try {
    const body = await req.text()

    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    )
  } catch (err: any) {
    console.error('Webhook signature error:', err.message)
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      const userId = session.metadata?.userId || session.client_reference_id
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id

      const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id

      if (!userId) {
        console.error('Stripe webhook missing userId on checkout session')
        return NextResponse.json({ received: true })
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
          subscriptionStatus: 'active',
          accountStatus: 'active',
        },
      })
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription
      const userId = subscription.metadata?.userId

      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            accountStatus: subscription.status === 'active' ? 'active' : undefined,
          },
        })
      } else {
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionStatus: subscription.status,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            accountStatus: subscription.status === 'active' ? 'active' : undefined,
          },
        })
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription

      await prisma.user.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          subscriptionStatus: 'canceled',
        },
      })
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
