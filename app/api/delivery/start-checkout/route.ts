import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const {
      pickupAddressId,
      dropoffAddressId,
      miles,
      weight,
      stops,
      rush,
      signature,
    } = body;

    if (!pickupAddressId || !dropoffAddressId) {
      return NextResponse.json(
        { error: "Missing address IDs" },
        { status: 400 }
      );
    }

    // ✅ pricing stays server-authoritative
    const pricing = computeDeliveryPrice({
      miles,
      weightLbs: weight,
      stops,
      rush,
      signature,
    });

    // 1️⃣ create order
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: user.id,
        total_cents: pricing.amountCents,
        service_type: "delivery",
        status: "pending",
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    // 2️⃣ create delivery (IDs only — NO address text)
    const { data: delivery, error: deliveryErr } = await supabaseAdmin
      .from("deliveries")
      .insert({
        order_id: order.id,
        pickup_address_id: pickupAddressId,
        dropoff_address_id: dropoffAddressId,
        estimated_miles: miles,
        weight_lbs: weight,
        status: "created",
      })
      .select()
      .single();

    if (deliveryErr) throw deliveryErr;

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.order_number,
      amountCents: pricing.amountCents,
    });
  } catch (err: any) {
    console.error("start-checkout error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}