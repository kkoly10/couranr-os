// app/api/docs/test-mark-paid/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const TEST_MODE =
  envTrue(process.env.NEXT_PUBLIC_DOCS_TEST_MODE) || envTrue(process.env.NEXT_PUBLIC_TEST_MODE);

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
      actor_role: "renter",
      event_type: eventType,
      event_payload: payload ?? {},
    });
  } catch {
    // best-effort
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!TEST_MODE) {
      return NextResponse.json({ error: "Test mode is disabled" }, { status: 403 });
    }

    const user = await getUserFromRequest(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: row, error: rowErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,status")
      .eq("id", requestId)
      .maybeSingle();

    if (rowErr || !row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (row.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const nextStatus =
      ["draft", "submitted", "quoted", "pending_quote", "pending"].includes(String(row.status || "").toLowerCase())
        ? "paid"
        : row.status;

    const { error } = await supabase
      .from("doc_requests")
      .update({ paid: true, status: nextStatus })
      .eq("id", requestId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logEvent(supabase, requestId, user.id, "checkout_test_paid", { status_after: nextStatus });

    return NextResponse.json({ ok: true, paid: true, status: nextStatus });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}