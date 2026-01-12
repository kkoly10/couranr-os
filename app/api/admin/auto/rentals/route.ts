import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Must be admin
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", u.user.id).single();
    if (prof?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await supabase
      .from("rentals")
      .select(`
        id,
        created_at,
        status,
        purpose,
        verification_status,
        paid,
        lockbox_code,
        vehicles ( year, make, model ),
        renters ( full_name, phone, email )
      `)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Supabase returns relations as arrays sometimes; normalize defensively
    const rentals = (data || []).map((r: any) => ({
      ...r,
      vehicles: Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles,
      renters: Array.isArray(r.renters) ? r.renters[0] : r.renters,
    }));

    return NextResponse.json({ rentals });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}