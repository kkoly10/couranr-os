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

    const { data, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        status,
        created_at,
        purpose,
        docs_complete,
        agreement_signed,
        paid,
        paid_at,
        verification_status,
        verification_denial_reason,
        lockbox_code,
        lockbox_code_released_at,
        condition_photos_status,
        pickup_confirmed_at,
        return_confirmed_at,
        deposit_refund_status,
        deposit_refund_amount_cents,
        start_date,
        end_date,
        pickup_location,
        vehicles (
          year,
          make,
          model,
          trim,
          color
        )
      `
      )
      .eq("user_id", u.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rentals: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}