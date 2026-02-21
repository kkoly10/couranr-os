import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // 1. Verify Authentication securely
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));

    const vehicleId = String(body.vehicleId || "");
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const licenseNumber = String(body.licenseNumber || "").trim();
    const licenseState = String(body.licenseState || "").trim().toUpperCase();
    const days = Number(body.days || 0);
    const pickupAtLocal = String(body.pickupAt || "");
    const purpose = (String(body.purpose || "personal") === "rideshare" ? "rideshare" : "personal") as
      | "personal"
      | "rideshare";
    const signature = String(body.signature || "").trim();

    if (!vehicleId || !fullName || !phone || !licenseNumber || !licenseState || !pickupAtLocal || !signature) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!Number.isFinite(days) || days < 1) {
      return NextResponse.json({ error: "Invalid days" }, { status: 400 });
    }

    const pickupAt = new Date(pickupAtLocal);
    if (Number.isNaN(pickupAt.getTime())) {
      return NextResponse.json({ error: "Invalid pickupAt" }, { status: 400 });
    }

    const email = u.user.email || null;
    if (!email) {
      return NextResponse.json({ error: "Missing authenticated email" }, { status: 400 });
    }

    // 3. Fetch Vehicle details (using Admin to bypass any read blocks)
    const { data: vehicle, error: vErr } = await supabaseAdmin
      .from("vehicles")
      .select("id, daily_rate_cents, weekly_rate_cents, deposit_cents, status")
      .eq("id", vehicleId)
      .single();

    // Pass the exact database error to the frontend if it fails
    if (vErr || !vehicle) {
      return NextResponse.json({ error: vErr?.message || "Vehicle not found in database" }, { status: 404 });
    }
    
    if (vehicle.status !== "available") {
      return NextResponse.json({ error: "Vehicle not available" }, { status: 400 });
    }

    // 4. Calculate Pricing
    const pricing_mode = days >= 7 ? "weekly" : "daily";
    const rate_cents = pricing_mode === "weekly" ? Number(vehicle.weekly_rate_cents || 0) : Number(vehicle.daily_rate_cents || 0);

    if (!Number.isFinite(rate_cents) || rate_cents <= 0) {
      return NextResponse.json({ error: "Vehicle pricing not configured" }, { status: 400 });
    }

    // 5. Upsert Renter Profile
    const { data: renterUp, error: renterErr } = await supabaseAdmin
      .from("renters")
      .upsert(
        {
          user_id: u.user.id,
          full_name: fullName,
          phone,
          email,
          license_number: licenseNumber,
          license_state: licenseState,
          license_expires: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (renterErr || !renterUp?.id) {
      return NextResponse.json({ error: renterErr?.message || "Failed to save renter profile" }, { status: 400 });
    }

    // 6. Create Rental Record
    const start = new Date(pickupAt);
    const end = new Date(pickupAt);
    end.setDate(end.getDate() + days);

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .insert({
        renter_id: renterUp.id,
        user_id: u.user.id,
        vehicle_id: vehicleId,
        pricing_mode,
        rate_cents,
        deposit_cents: Number(vehicle.deposit_cents || 0),
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        status: "draft",
        purpose,
        pickup_at: pickupAt.toISOString(),
        docs_complete: false,
        condition_photos_complete: false,
        approval_status: "pending",
      })
      .select("id")
      .single();

    if (rErr || !rental?.id) {
      return NextResponse.json({ error: rErr?.message || "Failed to create rental" }, { status: 400 });
    }

    // 7. Save Agreement Signature
    const { error: sigErr } = await supabaseAdmin.from("rental_agreements").insert({
      rental_id: rental.id,
      signed_name: signature,
      agreement_version: purpose === "rideshare" ? "rideshare_v1" : "personal_v1",
    });

    if (sigErr) {
      console.error("Signature save error:", sigErr.message);
    }

    return NextResponse.json({ rentalId: rental.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
