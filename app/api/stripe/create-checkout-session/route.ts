import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
apiVersion: '2024-06-20',
})

export async function POST() {
try {
const session = await stripe.checkout.sessions.create({
mode: 'subscription',
payment_method_types: ['card'],


  line_items: [
    {
      price: process.env.STRIPE_PRICE_ID_MONTHLY,
      quantity: 1,
    },
  ],

  success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success`,
  cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/cancel`,
})

return NextResponse.json({ url: session.url })


} catch (error) {
console.error('Stripe Checkout Error:', error)
return NextResponse.json({ error: 'Error creating checkout session' }, { status: 500 })
}
}
