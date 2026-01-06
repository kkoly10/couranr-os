import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export async function POST(req: Request) {
  try {
    // 🔐 Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await supabaseAdmin.auth.getUser(token);

    if (!auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // 1️⃣ Create order + delivery (DB)
    const { orderId, orderNumber, deliveryId } =
      await createDeliveryOrderFlow({
        customerId: auth.user.id,
        pickupAddress: body.pickupAddress,
        dropoffAddress: body.dropoffAddress,
        estimatedMiles: body.estimatedMiles,
        weightLbs: body.weightLbs,
        rush: body.rush,
        signatureRequired: body.signatureRequired,
        stops: body.stops,
        scheduledAt: body.scheduledAt,
        totalCents: body.totalCents,
      });

    // 2️⃣ Create Stripe Checkout Session (DIRECT)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          order_id: orderId,
          order_number: orderNumber,
          delivery_id: deliveryId,
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
            unit_amount: body.totalCents,
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/confirmation?order=${orderId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/courier/checkout`,
    });

    return NextResponse.json({
      url: session.url,
      orderId,
      orderNumber,
      deliveryId,
    });
  } catch (err: any) {
    console.error("START CHECKOUT ERROR:", err);
    return NextResponse.json(
      { error: err.message || "Checkout failed" },
      { status: 500 }
    );
  }
}