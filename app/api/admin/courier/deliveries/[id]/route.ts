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
  const { data: profile, error: pErr } = await supabaseSrv
    .from("profiles")
    .select("role")
    .eq("id", u.user.id)
    .single();

  if (pErr || !profile || profile.role !== "admin") throw new Error("Forbidden");
  return { adminId: u.user.id, supabaseSrv };
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { supabaseSrv } = await requireAdmin(token);

    const { data, error } = await supabaseSrv
      .from("deliveries")
      .select("*")
      .eq("id", ctx.params.id)
      .single();

    if (error || !data) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });

    const { data: events } = await supabaseSrv
      .from("delivery_admin_events")
      .select("id,event_type,created_at,admin_user_id,before_json,after_json")
      .eq("delivery_id", ctx.params.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({ delivery: data, events: events || [] });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { adminId, supabaseSrv } = await requireAdmin(token);

    const body = await req.json().catch(() => ({}));
    const patch: any = {};

    // only allow these fields to be edited
    const allowed = [
      "pickup_address",
      "dropoff_address",
      "recipient_name",
      "recipient_phone",
      "delivery_notes",
      "status",
    ];

    for (const k of allowed) {
      if (typeof body[k] !== "undefined") patch[k] = body[k];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    // Lock completed deliveries: allow notes only
    const { data: existing, error: getErr } = await supabaseSrv
      .from("deliveries")
      .select("id,status,pickup_address,dropoff_address,recipient_name,recipient_phone,delivery_notes,driver_id")
      .eq("id", ctx.params.id)
      .single();

    if (getErr || !existing) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });

    if (existing.status === "completed") {
      const onlyNotes =
        Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, "delivery_notes");
      if (!onlyNotes) {
        return NextResponse.json({ error: "Completed deliveries are locked" }, { status: 403 });
      }
    }

    patch.admin_last_edited_at = new Date().toISOString();
    patch.admin_last_edited_by = adminId;

    const beforeJson = existing;
    const afterJson = { ...existing, ...patch };

    const { error: upErr } = await supabaseSrv.from("deliveries").update(patch).eq("id", ctx.params.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await supabaseSrv.from("delivery_admin_events").insert({
      delivery_id: ctx.params.id,
      admin_user_id: adminId,
      event_type: "edit_delivery",
      before_json: beforeJson,
      after_json: afterJson,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}