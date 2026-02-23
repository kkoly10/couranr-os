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

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "all").trim();
    const q = (url.searchParams.get("q") || "").trim();

    const supabase = svc();

    let query = supabase
      .from("doc_requests")
      .select(`
        id,
        user_id,
        request_code,
        service_type,
        title,
        status,
        description,
        delivery_method,
        phone,
        quoted_total_cents,
        paid,
        paid_at,
        due_at,
        submitted_at,
        completed_at,
        cancelled_at,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (q) {
      // Search request code/title/description
      query = query.or(
        `request_code.ilike.%${q}%,title.ilike.%${q}%,description.ilike.%${q}%`
      );
    }

    const { data: requests, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rows = (requests || []) as any[];

    // Profiles (email lookup)
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const profileMap: Record<string, any> = {};

    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);

      for (const p of profiles || []) {
        profileMap[(p as any).id] = p;
      }
    }

    // File counts
    const requestIds = rows.map((r) => r.id);
    const fileCountMap: Record<string, number> = {};

    if (requestIds.length) {
      const { data: files } = await supabase
        .from("doc_request_files")
        .select("id, request_id")
        .in("request_id", requestIds);

      for (const f of files || []) {
        const rid = String((f as any).request_id);
        fileCountMap[rid] = (fileCountMap[rid] || 0) + 1;
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      customer_email: profileMap[r.user_id]?.email || null,
      file_count: fileCountMap[r.id] || 0,
    }));

    return NextResponse.json({ requests: enriched });
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
