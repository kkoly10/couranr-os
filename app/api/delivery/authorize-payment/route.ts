import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
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

    // Create PaymentIntent (authorize only)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      capture_method: "manual",
      metadata: { order_id: orderId, service: "delivery" },
    });

    // Store payment record (server admin client bypasses RLS)
    const { error: paymentError } = await supabaseAdmin.from("payments").insert({
      order_id: orderId,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount_authorized_cents: amountCents,
      currency,
      authorized_at: new Date().toISOString(),
    });

    if (paymentError) throw paymentError;

    // Update order status
    const { error: orderError } = await supabaseAdmin
      .from("orders")
      .update({ status: "authorized" })
      .eq("id", orderId);

    if (orderError) throw orderError;

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err: any) {
    console.error("Authorize payment error:", err);
    return NextResponse.json(
      { error: err.message || "Payment authorization failed" },
      { status: 500 }
    );
  }
}
