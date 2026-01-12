import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", u.user.id).single();
    if (prof?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    const { error } = await supabase
      .from("rentals")
      .update({ return_confirmed_at: new Date().toISOString(), status: "completed", deposit_refund_status: "pending" })
      .eq("id", rentalId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: u.user.id,
      actor_role: "admin",
      event_type: "return_confirmed",
      event_payload: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}