import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20"
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { amountCents, currency = "usd", metadata } = body || {};

    if (!amountCents || typeof amountCents !== "number") {
      return NextResponse.json(
        { error: "Invalid amountCents" },
        { status: 400 }
      );
    }

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
      metadata: metadata || {}
    });

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create payment intent" },
      { status: 500 }
    );
  }
}
