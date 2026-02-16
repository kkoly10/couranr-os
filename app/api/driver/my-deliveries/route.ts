// app/api/driver/my-deliveries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearer(req: NextRequest) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });
    }

    // 1) Auth client (uses anon key) — only to validate token + get user
    const supabaseAuth = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    const user = userRes.user;

    // 2) Service client — used to read deliveries regardless of RLS
    // (You can switch this to RLS later if you add driver policies.)
    const supabaseSrv = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // 3) Role check (driver only)
    const { data: profile, error: profErr } = await supabaseSrv
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }
    if (profile?.role !== "driver") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4) Load driver deliveries
    const { data, error } = await supabaseSrv
      .from("deliveries")
      .select(
        `
          id,
          status,
          recipient_name,
          created_at,
          pickup_address:pickup_address_id ( address_line ),
          dropoff_address:dropoff_address_id ( address_line )
        `
      )
      .eq("driver_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deliveries =
      (data ?? []).map((d: any) => ({
        id: d.id,
        status: d.status,
        recipient_name: d.recipient_name ?? "",
        created_at: d.created_at,
        pickup_address: { address_line: d.pickup_address?.address_line ?? "—" },
        dropoff_address: { address_line: d.dropoff_address?.address_line ?? "—" },
      })) || [];

    return NextResponse.json({ deliveries }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}