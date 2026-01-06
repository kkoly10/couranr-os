import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    const { amountCents, orderId, orderNumber } = await req.json();

    if (!amountCents || amountCents < 50) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    if (!orderNumber) {
      return NextResponse.json(
        { error: "Missing order number" },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          order_id: orderId,
          order_number: orderNumber,
        },
        description: `Order #${orderNumber}`,
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Delivery",
              description: `Order #${orderNumber}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation?order=${orderId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Stripe error" },
      { status: 500 }
    );
  }
}