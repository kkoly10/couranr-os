// app/api/docs/create-checkout-session/route.ts
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
      actor_role: "renter", // generic customer role reused; okay if your docs events use "customer"
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
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("doc_requests")
      .select("id,user_id,title,service_type,status,paid,quoted_total_cents,final_total_cents")
      .eq("id", requestId)
      .maybeSingle();

    if (error || !row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (row.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (row.paid) return NextResponse.json({ ok: true, alreadyPaid: true });

    const amountCents = Number(row.final_total_cents ?? row.quoted_total_cents ?? 0);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "No quote available yet" }, { status: 400 });
    }

    const origin = new URL(req.url).origin;
    const title = row.title || "Couranr Docs Request";
    const svcLabel = String(row.service_type || "document service").replace(/_/g, " ");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${origin}/docs/success?requestId=${encodeURIComponent(requestId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/docs/checkout?requestId=${encodeURIComponent(requestId)}&canceled=1`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: title,
              description: `Couranr Docs — ${svcLabel}`,
            },
          },
        },
      ],
      metadata: {
        docs_request_id: requestId,
        user_id: user.id,
      },
    });

    await logEvent(supabase, requestId, user.id, "checkout_session_created", {
      amount_cents: amountCents,
      session_id: session.id,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = msg === "Stripe not configured" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}