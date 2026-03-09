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

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const supabaseSrv = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY")
    );

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const onlyUnassigned = url.searchParams.get("unassigned") === "1";
    const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") || "60") || 60)
    );
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = supabaseSrv
      .from("deliveries")
      .select(
        `id,status,created_at,recipient_name,recipient_phone,delivery_notes,driver_id,
         pickup_address:pickup_address_id (label,address_line,city,state,zip),
         dropoff_address:dropoff_address_id (label,address_line,city,state,zip)`
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) q = q.eq("status", status);
    if (onlyUnassigned) q = q.is("driver_id", null);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deliveries = (data || []).map((d: any) => ({
      ...d,
      pickup_address: formatAddress(firstRow(d.pickup_address)),
      dropoff_address: formatAddress(firstRow(d.dropoff_address)),
    }));

    return NextResponse.json({ deliveries });
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