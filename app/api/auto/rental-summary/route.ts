// app/api/auto/rental-summary/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function GET(req: Request) {
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

    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const { data: r, error } = await supabase
      .from("rentals")
      .select(
        `
          id,
          renter_id,
          user_id,
          purpose,
          pickup_location,
          pickup_at,
          vehicles:vehicles ( year, make, model )
        `
      )
      .eq("id", rentalId)
      .single();

    if (error || !r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // Gate: renter OR owner can view
    const me = u.user.id;
    if (r.renter_id !== me && r.user_id !== me) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const v = Array.isArray(r.vehicles) ? r.vehicles[0] : (r.vehicles as any);
    const vehicleLabel =
      v?.year && v?.make && v?.model ? `${v.year} ${v.make} ${v.model}` : "";

    return NextResponse.json({
      rental: {
        rentalId: r.id,
        purpose: r.purpose || "personal",
        vehicleLabel,
        pickupLocation: r.pickup_location || "1090 Stafford Marketplace, VA 22556",
        pickupAt: r.pickup_at || "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}