// app/api/admin/docs/set-status/route.ts
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

async function logEvent(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  actorUserId: string | null,
  eventType: string,
  payload: any
) {
  try {
    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: actorUserId,
      actor_role: "admin",
      event_type: eventType,
      event_payload: payload ?? {},
    });
  } catch {
    // best-effort
  }
}

const ALLOWED = new Set([
  "draft",
  "submitted",
  "quoted",
  "in_progress",
  "awaiting_customer",
  "ready",
  "completed",
  "cancelled",
]);

export async function POST(req: NextRequest) {
  try {
    const adminUser = await requireAdmin(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    const status = String(body?.status || "").trim().toLowerCase();
    const note = body?.note ? String(body.note).slice(0, 2000) : null;

    if (!requestId || !ALLOWED.has(status)) {
      return NextResponse.json({ error: "Missing requestId or invalid status" }, { status: 400 });
    }

    const payload: any = { status };

    if (status === "completed") {
      payload.completed_at = new Date().toISOString();
    } else if (status !== "completed") {
      // keep previous completed_at unless you explicitly want to clear it
      // (safer for audit/history)
    }

    const { error } = await supabase.from("doc_requests").update(payload).eq("id", requestId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logEvent(supabase, requestId, adminUser?.id ?? null, "status_changed", {
      status,
      note,
    });

    return NextResponse.json({ ok: true, status });
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