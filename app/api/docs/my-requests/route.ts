// app/api/docs/my-requests/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const admin = adminClient();

    const { data: requests, error } = await admin
      .from("doc_requests")
      .select(`
        id,
        request_code,
        service_type,
        title,
        status,
        description,
        delivery_method,
        quoted_total_cents,
        paid,
        due_at,
        submitted_at,
        completed_at,
        cancelled_at,
        created_at,
        updated_at
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const requestIds = (requests || []).map((r: any) => r.id);

    let fileCountMap: Record<string, number> = {};
    if (requestIds.length) {
      const { data: files, error: filesErr } = await admin
        .from("doc_request_files")
        .select("id, request_id")
        .in("request_id", requestIds);

      if (!filesErr && files) {
        for (const f of files as any[]) {
          const k = String(f.request_id);
          fileCountMap[k] = (fileCountMap[k] || 0) + 1;
        }
      }
    }

    const enriched = (requests || []).map((r: any) => ({
      ...r,
      file_count: fileCountMap[r.id] || 0,
    }));

    return NextResponse.json({ requests: enriched });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      msg.includes("Missing authorization") || msg.includes("Invalid or expired token")
        ? 401
        : 500;

    return NextResponse.json({ error: msg }, { status: code });
  }
}