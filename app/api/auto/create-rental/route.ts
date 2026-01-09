import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      vehicleId,
      pricingMode,
      rateCents,
      depositCents,
      startDate,
      endDate,
      pickupTime,
    } = body;

    if (!vehicleId || !pricingMode || !rateCents || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 🔐 Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // 👤 Ensure renter exists
    let { data: renter } = await supabase
      .from("renters")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!renter) {
      const { data: newRenter, error: renterErr } = await supabase
        .from("renters")
        .insert({
          user_id: user.id,
          full_name: user.email,
          phone: "pending",
          email: user.email,
          license_number: "pending",
          license_state: "VA",
          license_expires: "2099-01-01",
        })
        .select("id")
        .single();

      if (renterErr) {
        return NextResponse.json(
          { error: renterErr.message },
          { status: 500 }
        );
      }

      renter = newRenter;
    }

    // 🚗 Create rental (DRAFT)
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        renter_id: renter.id,
        user_id: user.id,
        vehicle_id: vehicleId,
        pricing_mode: pricingMode,
        rate_cents: rateCents,
        deposit_cents: depositCents || 0,
        start_date: startDate,
        end_date: endDate,
        pickup_location: "1090 Stafford Marketplace, VA 22556",
        status: "draft",
      })
      .select("id")
      .single();

    if (rentalErr) {
      return NextResponse.json(
        { error: rentalErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      rentalId: rental.id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}