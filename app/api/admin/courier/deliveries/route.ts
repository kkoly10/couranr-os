import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { supabaseSrv } = await requireAdmin(token);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const onlyUnassigned = url.searchParams.get("unassigned") === "1";

    let q = supabaseSrv
      .from("deliveries")
      .select(
        `id,status,created_at,recipient_name,recipient_phone,delivery_notes,driver_id,
         pickup_address:pickup_address_id (label,address_line,city,state,zip),
         dropoff_address:dropoff_address_id (label,address_line,city,state,zip)`
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) q = q.eq("status", status);
    if (onlyUnassigned) q = q.is("driver_id", null);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const deliveries = (data || []).map((d: any) => ({
      ...d,
      pickup_address: formatAddress(firstRow(d.pickup_address)),
      dropoff_address: formatAddress(firstRow(d.dropoff_address)),
    }));

    return NextResponse.json({ deliveries });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
