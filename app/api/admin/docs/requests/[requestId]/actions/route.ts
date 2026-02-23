// app/api/admin/docs/requests/[requestId]/actions/route.ts
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

const ALLOWED_STATUSES = new Set([
  "draft",
  "submitted",
  "intake_review",
  "awaiting_quote",
  "quoted",
  "awaiting_payment",
  "paid",
  "in_progress",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
]);

async function insertEvent(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  eventType: string,
  payload: any
) {
  try {
    await supabase.from("doc_request_events").insert({
      request_id: requestId,
      actor_user_id: null,
      actor_role: "admin",
      event_type: eventType,
      event_payload: payload ?? {},
    });
  } catch {
    // don't block workflow if event table insert fails
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    await requireAdmin(req);

    const requestId = String(params?.requestId || "");
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    const supabase = svc();

    const { data: current, error: currentErr } = await supabase
      .from("doc_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (currentErr || !current) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === "set_status") {
      const status = String(body?.status || "").trim();
      if (!ALLOWED_STATUSES.has(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }

      const patch: any = {
        status,
        updated_at: now,
      };

      if (status === "submitted" && !current.submitted_at) patch.submitted_at = now;
      if (status === "completed" && !current.completed_at) patch.completed_at = now;
      if (status === "cancelled" && !current.cancelled_at) patch.cancelled_at = now;

      // Helpful auto-state syncs (does not force if already set)
      if (status === "paid" && !current.paid) {
        patch.paid = true;
        patch.paid_at = current.paid_at || now;
      }

      const { error: updErr } = await supabase
        .from("doc_requests")
        .update(patch)
        .eq("id", requestId);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await insertEvent(supabase, requestId, "status_changed", {
        from: current.status || null,
        to: status,
      });

      const { data: updated } = await supabase
        .from("doc_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      return NextResponse.json({ ok: true, request: updated });
    }

    if (action === "save_quote") {
      const amountCents = Number(body?.amountCents);
      const dueAtRaw = body?.dueAt ? String(body.dueAt) : null;

      if (!Number.isFinite(amountCents) || amountCents < 0) {
        return NextResponse.json({ error: "Invalid amountCents" }, { status: 400 });
      }

      const patch: any = {
        quoted_total_cents: Math.round(amountCents),
        updated_at: now,
      };

      if (dueAtRaw) patch.due_at = dueAtRaw;

      // If still early in flow, move to quoted
      if (
        ["draft", "submitted", "intake_review", "awaiting_quote"].includes(
          String(current.status || "")
        )
      ) {
        patch.status = "quoted";
      }

      const { error: updErr } = await supabase
        .from("doc_requests")
        .update(patch)
        .eq("id", requestId);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await insertEvent(supabase, requestId, "quote_saved", {
        amount_cents: Math.round(amountCents),
        due_at: dueAtRaw,
      });

      const { data: updated } = await supabase
        .from("doc_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      return NextResponse.json({ ok: true, request: updated });
    }

    if (action === "set_paid") {
      const paid = !!body?.paid;

      const patch: any = {
        paid,
        updated_at: now,
      };

      if (paid) {
        patch.paid_at = current.paid_at || now;
        if (
          ["quoted", "awaiting_payment", "submitted", "intake_review", "awaiting_quote"].includes(
            String(current.status || "")
          )
        ) {
          patch.status = "paid";
        }
      }

      const { error: updErr } = await supabase
        .from("doc_requests")
        .update(patch)
        .eq("id", requestId);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await insertEvent(supabase, requestId, paid ? "payment_marked_paid" : "payment_marked_unpaid", {
        paid,
      });

      const { data: updated } = await supabase
        .from("doc_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      return NextResponse.json({ ok: true, request: updated });
    }

    if (action === "set_due_at") {
      const dueAt = body?.dueAt ? String(body.dueAt) : null;

      const { error: updErr } = await supabase
        .from("doc_requests")
        .update({
          due_at: dueAt,
          updated_at: now,
        })
        .eq("id", requestId);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await insertEvent(supabase, requestId, "due_date_updated", { due_at: dueAt });

      const { data: updated } = await supabase
        .from("doc_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      return NextResponse.json({ ok: true, request: updated });
    }

    if (action === "add_note") {
      const note = String(body?.note || "").trim();
      if (!note) {
        return NextResponse.json({ error: "Note is required" }, { status: 400 });
      }

      await insertEvent(supabase, requestId, "admin_note", { note });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
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
