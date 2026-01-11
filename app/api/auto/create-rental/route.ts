import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");

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

  const body = await req.json();
  const {
    vehicleId,
    fullName,
    phone,
    licenseNumber,
    licenseState,
    pickupAt,
    days,
    purpose,
    signature,
  } = body;

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: renter, error: renterErr } = await supabase
    .from("renters")
    .upsert(
      {
        user_id: user.id,
        full_name: fullName,
        phone,
        email: user.email,
        license_number: licenseNumber,
        license_state: licenseState,
        license_expires: "2030-01-01",
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (renterErr) {
    return NextResponse.json({ error: renterErr.message }, { status: 400 });
  }

  const { data: rental, error: rentalErr } = await supabase
    .from("rentals")
    .insert({
      renter_id: renter.id,
      user_id: user.id,
      vehicle_id: vehicleId,
      pricing_mode: days >= 7 ? "weekly" : "daily",
      rate_cents: 0,
      deposit_cents: 0,
      start_date: pickupAt,
      end_date: pickupAt,
      status: "awaiting_payment",
      notes: purpose,
    })
    .select()
    .single();

  if (rentalErr) {
    return NextResponse.json({ error: rentalErr.message }, { status: 400 });
  }

  return NextResponse.json({ rentalId: rental.id });
}