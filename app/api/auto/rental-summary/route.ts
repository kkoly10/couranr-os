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

    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        purpose,
        pickup_location,
        created_at,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // ✅ Prevent account leakage
    if (rental.user_id !== u.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const v: any = rental.vehicles;
    const vehicleLabel = `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim() || "Vehicle";

    return NextResponse.json({
      rental: {
        rentalId: rental.id,
        purpose: rental.purpose || "personal",
        vehicleLabel,
        pickupLocation: rental.pickup_location || "1090 Stafford Marketplace, VA 22556",
        pickupAt: rental.created_at, // best available without extra fields; we can swap to pickup_at column later if you add it
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}