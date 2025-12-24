import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20"
});

export async function POST(req: Request) {
  try {
    const { amountCents } = await req.json();

    if (!amountCents || amountCents < 50) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual" // AUTHORIZE ONLY
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Courier Delivery" },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Stripe error" },
      { status: 500 }
    );
  }
}
