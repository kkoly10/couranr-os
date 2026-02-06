import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
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

    // ✅ single query: include user_id + renter_id so we can gate correctly
    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        status,
        purpose,
        docs_complete,
        condition_photos_complete,
        pickup_at,
        user_id,
        renter_id,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // ✅ allow owner OR renter to view
    const viewerId = u.user.id;
    const allowed = rental.user_id === viewerId || rental.renter_id === viewerId;
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // (optional) if you don’t want to leak user_id/renter_id back to client:
    const { user_id, renter_id, ...safeRental } = rental as any;

    return NextResponse.json({ rental: safeRental });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}