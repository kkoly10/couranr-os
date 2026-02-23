// app/api/admin/docs/set-quote/route.ts
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

export async function POST(req: NextRequest) {
  try {
    const adminUser = await requireAdmin(req);
    const supabase = svc();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    const amountCentsRaw = body?.amountCents;
    const note = body?.note ? String(body.note).slice(0, 2000) : null;

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const amountCents = Math.round(Number(amountCentsRaw));
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return NextResponse.json({ error: "Invalid amountCents" }, { status: 400 });
    }

    const { data: current, error: loadErr } = await supabase
      .from("doc_requests")
      .select("id,status")
      .eq("id", requestId)
      .maybeSingle();

    if (loadErr || !current) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const nextStatus =
      ["draft", "submitted", "pending_quote", "pending"].includes(String(current.status || "").toLowerCase())
        ? "quoted"
        : current.status;

    const { error: updErr } = await supabase
      .from("doc_requests")
      .update({
        quoted_total_cents: amountCents,
        final_total_cents: amountCents,
        status: nextStatus,
      })
      .eq("id", requestId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await logEvent(supabase, requestId, adminUser?.id ?? null, "quote_set", {
      amount_cents: amountCents,
      note,
      status_after: nextStatus,
    });

    return NextResponse.json({ ok: true, amount_cents: amountCents, status: nextStatus });
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