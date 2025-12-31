import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      scheduledAt,
      totalCents,
    } = body;

    // 🔒 HARD VALIDATION
    if (!totalCents || typeof totalCents !== "number" || totalCents < 50) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    // 1️⃣ Create order + delivery (NO Stripe yet)
    const { orderId, orderNumber, deliveryId } =
      await createDeliveryOrderFlow({
        customerId: user.id,
        pickupAddress,
        dropoffAddress,
        estimatedMiles,
        weightLbs,
        rush,
        signatureRequired,
        stops,
        scheduledAt,
        totalCents,
      });

    // 2️⃣ Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual", // authorize only
        metadata: {
          orderId,
          deliveryId,
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Delivery",
              description: `Order ${orderNumber}`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation?order=${orderId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`,
    });

    return NextResponse.json({
      url: session.url,
    });
  } catch (err: any) {
    console.error("start-checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
