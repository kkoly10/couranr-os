// app/api/auto/upload-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const rentalId = String(body?.rentalId || "").trim();
    const licenseFrontUrl = String(body?.licenseFrontUrl || "").trim();
    const licenseBackUrl = String(body?.licenseBackUrl || "").trim();
    const selfieUrl = String(body?.selfieUrl || "").trim();

    const licenseState = String(body?.licenseState || "").trim();
    const licenseExpires = String(body?.licenseExpires || "").trim(); // "YYYY-MM-DD"
    const hasInsurance = !!body?.hasInsurance;

    const capturedLat = body?.capturedLat ?? null;
    const capturedLng = body?.capturedLng ?? null;
    const capturedAccuracyM = body?.capturedAccuracyM ?? null;

    if (!rentalId || !licenseFrontUrl || !licenseBackUrl || !selfieUrl) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!licenseState || !licenseExpires) {
      return NextResponse.json({ error: "Missing license state/expiry" }, { status: 400 });
    }

    // Ensure rental belongs to user
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select("id,user_id,status")
      .eq("id", rentalId)
      .eq("user_id", user.id)
      .single();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    // Upsert verification row (one per rental)
    const { error: upErr } = await supabaseAdmin.from("renter_verifications").upsert(
      {
        rental_id: rentalId,
        user_id: user.id,
        license_front_url: licenseFrontUrl,
        license_back_url: licenseBackUrl,
        selfie_url: selfieUrl,
        license_state: licenseState,
        license_expires: licenseExpires,
        has_insurance: hasInsurance,
        captured_lat: capturedLat,
        captured_lng: capturedLng,
        captured_accuracy_m: capturedAccuracyM,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "rental_id" }
    );

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    // Mark docs complete ONLY via server route
    const { error: updErr } = await supabaseAdmin
      .from("rentals")
      .update({ docs_complete: true, verification_status: "pending" })
      .eq("id", rentalId)
      .eq("user_id", user.id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    // Audit event
    await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "verification_submitted",
      event_payload: {
        has_insurance: hasInsurance,
        captured_lat: capturedLat,
        captured_lng: capturedLng,
        captured_accuracy_m: capturedAccuracyM,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}