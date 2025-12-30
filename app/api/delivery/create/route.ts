import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

import { createDeliveryOrderFlow } from "../../../../lib/delivery/createDeliveryOrderFlow";

export async function POST(req: Request) {
  try {
    // ✅ SERVER-SIDE SUPABASE WITH COOKIES
    const supabase = createRouteHandlerClient({ cookies });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse body
    const body = await req.json();

    const {
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      stops,
      rush,
      signatureRequired,
      totalCents,
    } = body;

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        { error: "Pickup and dropoff addresses are required" },
        { status: 400 }
      );
    }

    if (!totalCents || totalCents < 50) {
      return NextResponse.json(
        { error: "Invalid total amount" },
        { status: 400 }
      );
    }

    // ✅ CREATE DELIVERY (AUTHORIZED USER)
    const {
      orderId,
      deliveryId,
      orderNumber,
      clientSecret,
    } = await createDeliveryOrderFlow({
      customerId: user.id,
      pickupAddress,
      dropoffAddress,
      estimatedMiles,
      weightLbs,
      stops,
      rush,
      signatureRequired,
      scheduledAt: null,
      totalCents,
    });

    return NextResponse.json({
      orderId,
      deliveryId,
      orderNumber,
      clientSecret,
    });
  } catch (err: any) {
    console.error("Create delivery error:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to create delivery" },
      { status: 500 }
    );
  }
}
