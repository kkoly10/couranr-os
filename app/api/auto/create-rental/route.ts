import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    // Convert pickupAt (local datetime string) -> ISO timestamp
    // We store as timestamptz; browser sends "YYYY-MM-DDTHH:mm"
    const pickupAt = new Date(pickupAtLocal);
    if (Number.isNaN(pickupAt.getTime())) {
      return NextResponse.json({ error: "Invalid pickupAt" }, { status: 400 });
    }

    const email = u.user.email || null;
    if (!email) {
      return NextResponse.json({ error: "Missing authenticated email" }, { status: 400 });
    }

    // Pull vehicle pricing
    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("id, daily_rate_cents, weekly_rate_cents, deposit_cents, status")
      .eq("id", vehicleId)
      .single();

    if (vErr || !vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    if (vehicle.status !== "available") {
      return NextResponse.json({ error: "Vehicle not available" }, { status: 400 });
    }

    // pricing mode
    const pricing_mode = days >= 7 ? "weekly" : "daily";
    const rate_cents =
      pricing_mode === "weekly" ? Number(vehicle.weekly_rate_cents || 0) : Number(vehicle.daily_rate_cents || 0);

    if (!Number.isFinite(rate_cents) || rate_cents <= 0) {
      return NextResponse.json({ error: "Vehicle pricing not configured" }, { status: 400 });
    }

    // Upsert renter (one per user_id)
    const { data: renterUp, error: renterErr } = await supabase
      .from("renters")
      .upsert(
        {
          user_id: u.user.id,
          full_name: fullName,
          phone,
          email,
          license_number: licenseNumber,
          license_state: licenseState,
          // Temporary safe default; you can collect real expiry later
          license_expires: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (renterErr || !renterUp?.id) {
      return NextResponse.json({ error: renterErr?.message || "Failed to save renter profile" }, { status: 400 });
    }

    // Rental dates (simple MVP: start now, end by days)
    const start = new Date(pickupAt);
    const end = new Date(pickupAt);
    end.setDate(end.getDate() + days);

    const start_date = start.toISOString().slice(0, 10);
    const end_date = end.toISOString().slice(0, 10);

    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .insert({
        renter_id: renterUp.id,
        user_id: u.user.id,
        vehicle_id: vehicleId,
        pricing_mode,
        rate_cents,
        deposit_cents: Number(vehicle.deposit_cents || 0),
        start_date,
        end_date,
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

    // Save signature as agreement record (your agreement system will extend this)
    await supabase.from("rental_agreements").insert({
      rental_id: rental.id,
      signed_name: signature,
      agreement_version: purpose === "rideshare" ? "rideshare_v1" : "personal_v1",
    });

    return NextResponse.json({ rentalId: rental.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
