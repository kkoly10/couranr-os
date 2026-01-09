import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ------------------------ helpers ------------------------ */

const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;

function isValidPickupTime(d: Date) {
  const hour = d.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/* ------------------------- route ------------------------- */

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.replace("Bearer ", "");

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    // 1️⃣ Get user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2️⃣ Parse body
    const body = await req.json();
    const {
      vehicleId,
      fullName,
      phone,
      license,
      days,
      pickupAt,
      signature,
    } = body;

    if (
      !vehicleId ||
      !fullName ||
      !phone ||
      !license ||
      !days ||
      !pickupAt ||
      !signature
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const pickupDate = new Date(pickupAt);
    if (!isValidPickupTime(pickupDate)) {
      return NextResponse.json(
        { error: "Pickup time outside business hours" },
        { status: 400 }
      );
    }

    // 3️⃣ Load vehicle
    const { data: vehicle, error: vehicleErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .single();

    if (vehicleErr || !vehicle) {
      return NextResponse.json(
        { error: "Vehicle not found" },
        { status: 404 }
      );
    }

    // 4️⃣ Upsert renter
    const { data: renter } = await supabase
      .from("renters")
      .upsert(
        {
          user_id: user.id,
          full_name: fullName,
          phone,
          license_number: license,
          license_state: "VA",
          license_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    // 5️⃣ Compute pricing
    const isWeekly = days >= 7;

    const rateCents = isWeekly
      ? vehicle.weekly_rate_cents
      : vehicle.daily_rate_cents * days;

    const depositCents = vehicle.deposit_cents || 0;

    // 6️⃣ Create rental
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        renter_id: renter.id,
        user_id: user.id,
        vehicle_id: vehicle.id,
        pricing_mode: isWeekly ? "weekly" : "daily",
        rate_cents: rateCents,
        deposit_cents: depositCents,
        start_date: pickupDate.toISOString().slice(0, 10),
        end_date: new Date(
          pickupDate.getTime() + days * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .slice(0, 10),
        status: "awaiting_payment",
        pickup_location: "1090 Stafford Marketplace, Stafford, VA 22556",
      })
      .select()
      .single();

    if (rentalErr) {
      return NextResponse.json(
        { error: rentalErr.message },
        { status: 500 }
      );
    }

    // 7️⃣ Save agreement signature
    await supabase.from("rental_agreements").insert({
      rental_id: rental.id,
      signed_name: signature,
      ip_address: req.headers.get("x-forwarded-for") || null,
      agreement_version: "v1",
    });

    return NextResponse.json({
      rentalId: rental.id,
    });
  } catch (err: any) {
    console.error("Create rental error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}