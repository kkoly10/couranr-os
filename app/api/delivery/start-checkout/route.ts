import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    // 1️⃣ Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2️⃣ Parse input
    const body = await req.json();
    const {
      miles,
      weightLbs,
      stops,
      rush,
      signature,
      pickupAddress,
      dropoffAddress,
    } = body;

    // 3️⃣ Server-side pricing (source of truth)
    const pricing = computeDeliveryPrice({
      miles,
      weightLbs,
      stops,
      rush,
      signature,
    });

    // 4️⃣ Create order FIRST
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: user.id,
        total_cents: pricing.amountCents,
        status: "pending_payment",
        service_type: "delivery",
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    // 5️⃣ Create delivery
    const { error: deliveryErr } = await supabaseAdmin
      .from("deliveries")
      .insert({
        order_id: order.id,
        status: "pending_payment",
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        estimated_miles: miles,
        weight_lbs: weightLbs,
        stops,
        rush,
        signature_required: signature,
      });

    if (deliveryErr) throw deliveryErr;

    // 6️⃣ Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_intent_data: {
        metadata: {
          orderId: order.id,
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Couranr Delivery — Order #${order.order_number}`,
            },
            unit_amount: pricing.amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation?orderId=${order.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("start-checkout error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}