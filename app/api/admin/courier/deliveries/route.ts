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

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { supabaseSrv } = await requireAdmin(token);

    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // optional
    const onlyUnassigned = url.searchParams.get("unassigned") === "1";

    let q = supabaseSrv
      .from("deliveries")
      .select(
        "id,status,created_at,pickup_address,dropoff_address,recipient_name,recipient_phone,delivery_notes,customer_id,driver_id,cancelled_at,cancel_reason"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) q = q.eq("status", status);
    if (onlyUnassigned) q = q.is("driver_id", null);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ deliveries: data || [] });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}