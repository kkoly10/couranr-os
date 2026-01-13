import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function requireAdmin(supabase: any) {
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return null;

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (prof?.role !== "admin") return null;

  return user;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const rentalId = url.searchParams.get("rentalId") || "";
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const admin = await requireAdmin(supabase);
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        verification_status,
        verification_denial_reason,
        docs_complete,
        agreement_signed,
        paid,
        lockbox_code,
        lockbox_code_released_at,
        condition_photos_status,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: rv } = await supabase
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    const { data: photos } = await supabase
      .from("rental_condition_photos")
      .select("phase, photo_url, captured_at, captured_lat, captured_lng")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      detail: {
        ...rental,
        renter_verifications: rv || null,
        photos: photos || [],
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}