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
    const signedName = String(body.signedName || "");
    const purpose = String(body.purpose || "personal");
    const signedText = String(body.signedText || "");

    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    if (!signedName.trim()) return NextResponse.json({ error: "Missing signedName" }, { status: 400 });
    if (!["personal", "rideshare"].includes(purpose)) {
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    }

    // Insert agreement (RLS ensures owner only)
    const { error: insErr } = await supabase
      .from("rental_agreements")
      .insert({
        rental_id: rentalId,
        signed_name: signedName.trim(),
        purpose,
        agreement_version: "v1",
        signed_text: signedText.slice(0, 50000),
      });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Mark rental signed
    const { error: upErr } = await supabase
      .from("rentals")
      .update({ agreement_signed: true, status: "awaiting_payment" })
      .eq("id", rentalId);

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}