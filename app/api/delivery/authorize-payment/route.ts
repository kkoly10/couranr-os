import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "../../../../lib/supabaseClient";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId, amountCents, currency = "usd" } = body;

    if (!orderId || !amountCents) {
      return NextResponse.json(
        { error: "orderId and amountCents are required" },
        { status: 400 }
      );
    }

    // 1️⃣ Create PaymentIntent (manual capture = authorization only)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      capture_method: "manual",
      metadata: {
        order_id: orderId,
        service: "delivery",
      },
    });

    // 2️⃣ Store payment record
    const { error: paymentError } = await supabase.from("payments").insert({
      order_id: orderId,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount_authorized_cents: amountCents,
      currency,
      authorized_at: new Date().toISOString(),
    });

    if (paymentError) {
      throw paymentError;
    }

    // 3️⃣ Update order status → authorized
    const { error: orderError } = await supabase
      .from("orders")
      .update({ status: "authorized" })
      .eq("id", orderId);

    if (orderError) {
      throw orderError;
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err: any) {
    console.error("Authorize payment error:", err);

    return NextResponse.json(
      { error: err.message || "Payment authorization failed" },
      { status: 500 }
    );
  }
}