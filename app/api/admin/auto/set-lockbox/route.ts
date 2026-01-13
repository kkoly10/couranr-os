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

    const admin = await requireAdmin(supabase);
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    const code = String(body.code || "");

    if (!rentalId || !code.trim()) {
      return NextResponse.json({ error: "Missing rentalId/code" }, { status: 400 });
    }

    const { error } = await supabase
      .from("rentals")
      .update({ lockbox_code: code.trim(), lockbox_code_released_at: new Date().toISOString() })
      .eq("id", rentalId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: admin.id,
      actor_role: "admin",
      event_type: "lockbox_code_set",
      event_payload: { code: code.trim() },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}