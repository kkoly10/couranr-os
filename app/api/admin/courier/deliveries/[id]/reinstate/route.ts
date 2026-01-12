import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function requireAdmin(token: string) {
  const supabaseAuth = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: u, error: uErr } = await supabaseAuth.auth.getUser();
  if (uErr || !u?.user) throw new Error("Unauthorized");

  const supabaseSrv = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: profile, error: pErr } = await supabaseSrv.from("profiles").select("role").eq("id", u.user.id).single();
  if (pErr || !profile || profile.role !== "admin") throw new Error("Forbidden");

  return { adminId: u.user.id, supabaseSrv };
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { adminId, supabaseSrv } = await requireAdmin(token);

    const { data: before, error: bErr } = await supabaseSrv
      .from("deliveries")
      .select("id,status,driver_id,pickup_address,dropoff_address")
      .eq("id", ctx.params.id)
      .single();

    if (bErr || !before) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
    if (before.status !== "cancelled") return NextResponse.json({ error: "Only cancelled deliveries can be reinstated" }, { status: 400 });

    const patch: any = {
      status: "pending",
      cancel_reason: null,
      cancelled_at: null,
      admin_last_edited_at: new Date().toISOString(),
      admin_last_edited_by: adminId,
    };

    const { error: upErr } = await supabaseSrv.from("deliveries").update(patch).eq("id", ctx.params.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await supabaseSrv.from("delivery_admin_events").insert({
      delivery_id: ctx.params.id,
      admin_user_id: adminId,
      event_type: "reinstate_delivery",
      before_json: before,
      after_json: { ...before, ...patch },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}