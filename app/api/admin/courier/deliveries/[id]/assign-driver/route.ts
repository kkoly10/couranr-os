import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    const supabaseSrv = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const body = await req.json().catch(() => ({}));
    const driverId = String(body.driverId || "").trim();
    if (!driverId) return NextResponse.json({ error: "Missing driverId" }, { status: 400 });

    const { data: driver, error: dErr } = await supabaseSrv
      .from("profiles")
      .select("id,role")
      .eq("id", driverId)
      .single();

    if (dErr || !driver || driver.role !== "driver") {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }

    const { data: before, error: bErr } = await supabaseSrv
      .from("deliveries")
      .select("id,status,driver_id")
      .eq("id", ctx.params.id)
      .single();

    if (bErr || !before) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
    if (before.status === "completed") {
      return NextResponse.json({ error: "Completed deliveries are locked" }, { status: 403 });
    }

    const patch = {
      driver_id: driverId,
      status: before.status === "pending" ? "assigned" : before.status,

    };

    const { error: upErr } = await supabaseSrv.from("deliveries").update(patch).eq("id", ctx.params.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await supabaseSrv.from("delivery_admin_events").insert({
      delivery_id: ctx.params.id,
      admin_user_id: admin.id,
      event_type: "assign_driver",
      before_json: before,
      after_json: { ...before, ...patch },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Missing Authorization header" || msg === "Invalid or expired token" ? 401 : msg === "Admin access required" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
