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
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();

    const licenseNumber = String(body.licenseNumber || "").trim();
    const licenseState = String(body.licenseState || "").trim().toUpperCase();
    const licenseExpires = String(body.licenseExpires || "").trim(); // YYYY-MM-DD

    const purpose = (String(body.purpose || "personal") as "personal" | "rideshare");
    const days = Number(body.days || 1);
    const pickupAt = String(body.pickupAt || "").trim();
    const signature = String(body.signature || "").trim();

    if (!vehicleId) return NextResponse.json({ error: "Missing vehicleId" }, { status: 400 });

    if (!fullName || !email || !phone || !licenseNumber || !licenseState || !licenseExpires || !pickupAt || !signature) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!Number.isFinite(days) || days < 1) {
      return NextResponse.json({ error: "Invalid rental length" }, { status: 400 });
    }

    // Load vehicle for pricing
    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("id, daily_rate_cents, weekly_rate_cents, deposit_cents, status")
      .eq("id", vehicleId)
      .single();

    if (vErr || !vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

    if (vehicle.status !== "available") {
      return NextResponse.json({ error: "Vehicle is not available" }, { status: 400 });
    }

    // Pricing mode rule: weekly starts at 7 days (locked)
    const pricing_mode = days >= 7 ? "weekly" : "daily";
    const rate_cents =
      pricing_mode === "weekly"
        ? Number(vehicle.weekly_rate_cents || 0)
        : Number(vehicle.daily_rate_cents || 0);

    const deposit_cents = Number(vehicle.deposit_cents || 0);

    // Upsert renter (by user_id)
    const { data: renter, error: rErr } = await supabase
      .from("renters")
      .upsert(
        {
          user_id: u.user.id,
          full_name: fullName,
          phone,
          email,
          license_number: licenseNumber,
          license_state: licenseState,
          license_expires: licenseExpires,
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (rErr || !renter) {
      return NextResponse.json({ error: rErr?.message || "Failed to save renter profile" }, { status: 400 });
    }

    // Create rental (draft) — agreement/payment come next
    const { data: rentalRow, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        renter_id: renter.id,
        user_id: u.user.id,
        vehicle_id: vehicleId,

        pricing_mode,
        rate_cents,
        deposit_cents,

        start_date: new Date(pickupAt).toISOString().slice(0, 10),
        end_date: new Date(new Date(pickupAt).getTime() + (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),

        status: "draft",
        pickup_location: "1090 Stafford Marketplace, VA 22556",

        // These columns are referenced by your /api/auto/start-checkout gate
        purpose,
        docs_complete: false,
        condition_photos_complete: false,
        agreement_signed: false,

        notes: `Signature captured for reservation intent: ${signature}`,
      })
      .select("id")
      .single();

    if (rentalErr || !rentalRow) {
      return NextResponse.json({ error: rentalErr?.message || "Failed to create rental" }, { status: 400 });
    }

    return NextResponse.json({ rentalId: rentalRow.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}