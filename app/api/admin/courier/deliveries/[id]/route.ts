import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function formatAddress(a: any): string | null {
  if (!a || typeof a !== "object") return null;
  const parts = [a.address_line, a.city, a.state, a.zip].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return a.label || null;
}

function firstRow(v: any) {
  return Array.isArray(v) ? (v[0] || null) : v || null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    await requireAdmin(req);

    const supabaseSrv = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data, error } = await supabaseSrv
      .from("deliveries")
      .select(
        `id,status,created_at,driver_id,recipient_name,recipient_phone,delivery_notes,estimated_miles,weight_lbs,rush,signature_required,stops,scheduled_at,
         pickup_address:pickup_address_id (label,address_line,city,state,zip),
         dropoff_address:dropoff_address_id (label,address_line,city,state,zip)`
      )
      .eq("id", ctx.params.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Delivery not found" },
        { status: 404 }
      );
    }

    const { data: events } = await supabaseSrv
      .from("delivery_admin_events")
      .select("id,event_type,created_at,admin_user_id,before_json,after_json")
      .eq("delivery_id", ctx.params.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const delivery = {
      ...data,
      pickup_address: formatAddress(firstRow((data as any).pickup_address)),
      dropoff_address: formatAddress(firstRow((data as any).dropoff_address)),
    };

    return NextResponse.json({ delivery, events: events || [] });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg === "Missing Authorization header" ||
      msg === "Invalid or expired token"
        ? 401
        : msg === "Admin access required"
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    const admin = await requireAdmin(req);

    const supabaseSrv = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY")
    );

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, any> = {};

    const allowed = [
      "recipient_name",
      "recipient_phone",
      "delivery_notes",
      "status",
    ];

    for (const k of allowed) {
      if (typeof body[k] !== "undefined") patch[k] = body[k];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields provided" },
        { status: 400 }
      );
    }

    const { data: existing, error: getErr } = await supabaseSrv
      .from("deliveries")
      .select("id,status,recipient_name,recipient_phone,delivery_notes,driver_id")
      .eq("id", ctx.params.id)
      .single();

    if (getErr || !existing) {
      return NextResponse.json(
        { error: "Delivery not found" },
        { status: 404 }
      );
    }

    if (existing.status === "completed") {
      const onlyNotes =
        Object.keys(patch).length === 1 &&
        Object.prototype.hasOwnProperty.call(patch, "delivery_notes");

      if (!onlyNotes) {
        return NextResponse.json(
          { error: "Completed deliveries are locked" },
          { status: 403 }
        );
      }
    }

    const beforeJson = existing;
    const afterJson = { ...existing, ...patch };

    const { error: upErr } = await supabaseSrv
      .from("deliveries")
      .update(patch)
      .eq("id", ctx.params.id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    await supabaseSrv.from("delivery_admin_events").insert({
      delivery_id: ctx.params.id,
      admin_user_id: admin.id,
      event_type: "edit_delivery",
      before_json: beforeJson,
      after_json: afterJson,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg === "Missing Authorization header" ||
      msg === "Invalid or expired token"
        ? 401
        : msg === "Admin access required"
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}