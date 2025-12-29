import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // 1) Find delivery for this order
    const { data: delivery, error: deliveryErr } = await supabaseAdmin
      .from("deliveries")
      .select("id, order_id")
      .eq("order_id", orderId)
      .single();

    if (deliveryErr) throw deliveryErr;

    // 2) Enforce dropoff photo exists
    const { data: dropoffPhotos, error: photoErr } = await supabaseAdmin
      .from("delivery_photos")
      .select("id")
      .eq("delivery_id", delivery.id)
      .eq("photo_type", "dropoff")
      .limit(1);

    if (photoErr) throw photoErr;

    if (!dropoffPhotos || dropoffPhotos.length === 0) {
      return NextResponse.json(
        { error: "Dropoff photo required before capture" },
        { status: 400 }
      );
    }

    // 3) Find PaymentIntent for the order
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id, payment_intent_id, amount_authorized_cents, currency")
      .eq("order_id", orderId)
      .single();

    if (payErr) throw payErr;

    // 4) Capture PaymentIntent in Stripe
    const captured = await stripe.paymentIntents.capture(payment.payment_intent_id);

    // 5) Update payments row
    const { error: updPayErr } = await supabaseAdmin
      .from("payments")
      .update({
        status: captured.status,
        amount_captured_cents: captured.amount_received ?? payment.amount_authorized_cents,
        captured_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    if (updPayErr) throw updPayErr;

    // 6) Update order status to completed
    const { error: updOrderErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId);

    if (updOrderErr) throw updOrderErr;

    return NextResponse.json({ success: true, stripeStatus: captured.status });
  } catch (err: any) {
    console.error("Capture payment error:", err);
    return NextResponse.json(
      { error: err.message || "Capture failed" },
      { status: 500 }
    );
  }
}
