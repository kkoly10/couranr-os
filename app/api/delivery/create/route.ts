import { NextResponse } from "next/server";
import { createDeliveryOrderFlow } from "../../../../lib/delivery/createDeliveryOrderFlow";
import { supabase } from "../../../../lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      totalCents,
    } = body;

    if (!pickupAddress || !dropoffAddress || !totalCents) {
      return NextResponse.json(
        { error: "Missing required checkout data" },
        { status: 400 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { orderId, deliveryId } = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      rush,
      signatureRequired,
      stops,
      totalCents,
    });

    return NextResponse.json({
      orderId,
      deliveryId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create delivery order" },
      { status: 500 }
    );
  }
}
