import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { createDeliveryOrderFlow } from "@/lib/delivery/createDeliveryOrderFlow";

export async function POST(req: Request) {
  try {
    // 1️⃣ Get authenticated user
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

    // 2️⃣ Parse request body
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

    // 3️⃣ Basic validation (minimal, backend-safe)
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

    // 4️⃣ Create delivery + order + authorize payment
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

      scheduledAt: null, // ✅ REQUIRED — deliver now (FIX)

      totalCents,
    });

    // 5️⃣ Success response
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