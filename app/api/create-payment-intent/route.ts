import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10", // ✅ FIXED
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { amountCents } = body;

    if (!amountCents || amountCents < 50) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    // AUTHORIZE ONLY (manual capture)
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      clientSecret: intent.client_secret,
    });
  } catch (err: any) {
    console.error("create-payment-intent error:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to create PaymentIntent" },
      { status: 500 }
    );
  }
}
