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
    const rentalId = String(body.rentalId || "");
    const signedName = String(body.signedName || "").trim();

    if (!rentalId || !signedName) {
      return NextResponse.json({ error: "Missing rentalId or signedName" }, { status: 400 });
    }

    // Load rental, enforce owner
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select("id, user_id, purpose")
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // ✅ Prevent account leakage
    if (rental.user_id !== u.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const agreementVersion = "v1";

    // Insert agreement record
    const { error: aErr } = await supabase
      .from("rental_agreements")
      .insert({
        rental_id: rentalId,
        signed_name: signedName,
        agreement_version: agreementVersion,
        // ip_address optional; we can add later via headers/server logs
      });

    if (aErr) {
      return NextResponse.json({ error: aErr.message || "Failed to save agreement" }, { status: 500 });
    }

    // Mark rental as signed
    const { error: upErr } = await supabase
      .from("rentals")
      .update({ agreement_signed: true })
      .eq("id", rentalId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message || "Failed to update rental" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
