export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const rentalId = searchParams.get("rentalId");

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: rental, error } = await admin
      .from("rentals")
      .select(
        `
        id,
        user_id,
        vehicle_id,
        status,
        purpose,
        docs_complete,
        verification_status,
        agreement_signed,
        paid,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        deposit_refund_status,
        deposit_refund_amount_cents,
        damage_confirmed,
        damage_confirmed_at,
        created_at
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (rental.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Vehicle label (optional)
    let vehicle: any = null;
    if (rental.vehicle_id) {
      const vRes = await admin
        .from("vehicles")
        .select("id,year,make,model")
        .eq("id", rental.vehicle_id)
        .single();
      vehicle = vRes.data || null;
    }

    // Compute “next step” hints (renter-facing)
    const next = {
      needsVerification: !rental.docs_complete,
      needsAgreement: !rental.agreement_signed,
      needsPayment: !rental.paid,
      needsApproval: rental.verification_status !== "approved",
      lockboxAvailable: !!rental.lockbox_code_released_at,
      needsPickupPhotos:
        rental.condition_photos_status === "not_started" ||
        rental.condition_photos_status === "pickup_exterior_done",
      needsReturnPhotos:
        rental.pickup_confirmed_at &&
        !rental.return_confirmed_at &&
        (rental.condition_photos_status === "pickup_interior_done" ||
          rental.condition_photos_status === "return_exterior_done"),
      damageUnderReview:
        !!rental.return_confirmed_at && !rental.damage_confirmed,
      depositPending:
        rental.deposit_refund_status === "pending" ||
        rental.deposit_refund_status === "withheld" ||
        rental.deposit_refund_status === "refunded",
    };

    return NextResponse.json({ rental, vehicle, next });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}