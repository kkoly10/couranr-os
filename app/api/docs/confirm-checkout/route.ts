// app/api/docs/confirm-checkout/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/app/lib/auth";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe not configured");
  return new Stripe(key);
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
    const user = await getUserFromRequest(req);
    const supabase = svc();
    const stripe = getStripe();

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    const sessionId = String(body?.sessionId || "");

    if (!requestId || !sessionId) {
      return NextResponse.json({ error: "Missing requestId or sessionId" }, { status: 400 });
    }

    const { data: row, error: rowErr } = await supabase
      .from("doc_requests")
      .select("id,user_id,paid,status")
      .eq("id", requestId)
      .maybeSingle();

    if (rowErr || !row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (row.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (row.paid) {
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not confirmed yet" }, { status: 400 });
    }

    const metaRequestId = String(session.metadata?.docs_request_id || "");
    if (metaRequestId !== requestId) {
      return NextResponse.json({ error: "Session does not match request" }, { status: 400 });
    }

    const nextStatus =
      ["draft", "submitted", "quoted", "pending_quote", "pending"].includes(String(row.status || "").toLowerCase())
        ? "paid"
        : row.status;

    const { error: updErr } = await supabase
      .from("doc_requests")
      .update({
        paid: true,
        status: nextStatus,
      })
      .eq("id", requestId);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await logEvent(supabase, requestId, user.id, "checkout_confirmed", {
      session_id: session.id,
      payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amount_total: session.amount_total,
      currency: session.currency,
    });

    return NextResponse.json({ ok: true, paid: true, status: nextStatus });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = msg === "Stripe not configured" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}