import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "../../../../lib/delivery/createDeliveryOrderFlow";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ Verify JWT and get user
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(
      token
    );
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = userRes.user;

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
    } = body || {};

    if (!totalCents || typeof totalCents !== "number" || totalCents < 50) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // ✅ Create Order + Delivery in DB (server-side)
    const { orderId, orderNumber, deliveryId } = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress,
      dropoffAddress,
      estimatedMiles: Number(estimatedMiles || 0),
      weightLbs: Number(weightLbs || 0),
      rush: Boolean(rush),
      signatureRequired: Boolean(signatureRequired),
      stops: Number(stops || 0),
      scheduledAt: scheduledAt ?? null,
      totalCents,
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_BASE_URL is missing" },
        { status: 500 }
      );
    }

    // ✅ Stripe Checkout Session (single source of truth)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Couranr Delivery",
              description: `Order #${orderNumber}`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/courier/confirmation?orderId=${orderId}`,
      cancel_url: `${baseUrl}/courier/checkout`,
      metadata: {
        orderId,
        deliveryId,
        orderNumber,
        customerId: user.id,
      },
    });

    return NextResponse.json({
      url: session.url,
      orderId,
      deliveryId,
      orderNumber,
      amountCents: totalCents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}