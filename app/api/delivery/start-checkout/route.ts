import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

export async function POST(req: Request) {
  try {
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

    // 1️⃣ Create order + delivery in DB
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

    // 2️⃣ Create Stripe Checkout session
    const checkoutRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/create-checkout-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: body.totalCents,
          orderId,
          orderNumber,
        }),
      }
    );

    const checkout = await checkoutRes.json();

    if (!checkout.url) {
      throw new Error("Failed to create checkout session");
    }

    return NextResponse.json({
      url: checkout.url,
      orderId,
      orderNumber,
      deliveryId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Checkout failed" },
      { status: 500 }
    );
  }
}