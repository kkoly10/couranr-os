import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));

function svc() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function docsEventAlreadyProcessed(
  supabase: ReturnType<typeof svc>,
  requestId: string,
  stripeEventId: string
) {
  const { data, error } = await supabase
    .from("doc_request_events")
    .select("id")
    .eq("request_id", requestId)
    .eq("event_type", "stripe_webhook_processed")
    .contains("event_payload", { stripe_event_id: stripeEventId })
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function markDocsPaidFromCheckoutSession(
  supabase: ReturnType<typeof svc>,
  session: Stripe.Checkout.Session,
  stripeEventId: string
) {
  const requestId = String(session.metadata?.docs_request_id || "").trim();
  if (!requestId) return;

  const alreadyProcessed = await docsEventAlreadyProcessed(supabase, requestId, stripeEventId);
  if (alreadyProcessed) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  const { data: row, error: rowErr } = await supabase
    .from("doc_requests")
    .select("id,paid,status,stripe_payment_intent_id")
    .eq("id", requestId)
    .maybeSingle();

  if (rowErr || !row) {
    console.error("docs webhook request lookup failed", {
      request_id: requestId,
      stripe_event_id: stripeEventId,
      error: rowErr?.message || "not_found",
    });
    return;
  }

  const nextStatus =
    ["draft", "submitted", "quoted", "pending_quote", "pending", "awaiting_payment"].includes(
      String(row.status || "").toLowerCase()
    )
      ? "paid"
      : row.status;

  if (!row.paid || (paymentIntentId && row.stripe_payment_intent_id !== paymentIntentId)) {
    const { error: updErr } = await supabase
      .from("doc_requests")
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        status: nextStatus,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId ?? row.stripe_payment_intent_id ?? null,
      })
      .eq("id", requestId);

    if (updErr) {
      console.error("docs webhook payment update failed", {
        request_id: requestId,
        stripe_event_id: stripeEventId,
        error: updErr.message,
      });
      return;
    }
  }

  await supabase.from("doc_request_events").insert([
    {
      request_id: requestId,
      actor_user_id: null,
      actor_role: "system",
      event_type: "payment_completed",
      event_payload: {
        source: "stripe_webhook",
        stripe_event_id: stripeEventId,
        session_id: session.id,
        payment_intent: paymentIntentId,
        amount_total: session.amount_total,
        currency: session.currency,
      },
    },
    {
      request_id: requestId,
      actor_user_id: null,
      actor_role: "system",
      event_type: "stripe_webhook_processed",
      event_payload: {
        stripe_event_id: stripeEventId,
        session_id: session.id,
        payment_status: session.payment_status,
      },
    },
  ]);
}

async function markRentalPaidFromCheckoutSession(
  supabase: ReturnType<typeof svc>,
  session: Stripe.Checkout.Session
) {
  const rentalId = String(session.metadata?.rentalId || session.metadata?.rental_id || "");
  if (!rentalId) return;

  await supabase
    .from("rentals")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      status: "active",
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    })
    .eq("id", rentalId);

  await supabase.from("rental_events").insert({
    rental_id: rentalId,
    actor_role: "system",
    event_type: "payment_completed",
    event_payload: { session_id: session.id },
  });
}

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

    const rawBody = await req.text();
    const event = stripe.webhooks.constructEvent(rawBody, sig, env("STRIPE_WEBHOOK_SECRET"));

    const supabase = svc();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await markRentalPaidFromCheckoutSession(supabase, session);
      await markDocsPaidFromCheckoutSession(supabase, session, event.id);
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Webhook error" }, { status: 400 });
  }
}
