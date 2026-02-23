// app/api/admin/docs/requests/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const supabase = svc();

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "").trim();

    let q = supabase.from("doc_requests").select("*").order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ requests: data || [] });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : msg.includes("Admin access required")
        ? 403
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}