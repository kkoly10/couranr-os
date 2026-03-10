import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));

function svc() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false },
    }
  );
}

function getMissingColumnFromError(msg: string): string | null {
  if (!msg) return null;

  let m = msg.match(/Could not find the '([^']+)' column/i);
  if (m?.[1]) return m[1];

  m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (m?.[1]) return m[1];

  return null;
}

async function resilientUpdateById(
  supabase: ReturnType<typeof svc>,
  table: string,
  idField: string,
  id: string,
  payload: Record<string, any>
) {
  const current = { ...payload };

  for (let i = 0; i < 20; i++) {
    if (Object.keys(current).length === 0) {
      return { ok: true as const };
    }

    const { error } = await supabase.from(table).update(current).eq(idField, id);

    if (!error) return { ok: true as const };

    const missingCol = getMissingColumnFromError(error.message || "");
    if (missingCol && missingCol in current) {
      delete current[missingCol];
      continue;
    }

    return { ok: false as const, error };
  }

  return {
    ok: false as const,
    error: { message: `Failed to update ${table}` },
  };
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

async function deliveryEventAlreadyProcessed(
  supabase: ReturnType<typeof svc>,
  deliveryId: string,
  stripeEventId: string
) {
  const { data, error } = await supabase
    .from("delivery_admin_events")
    .select("id")
    .eq("delivery_id", deliveryId)
    .eq("event_type", "stripe_webhook_processed")
    .contains("after_json", { stripe_event_id: stripeEventId })
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function rentalEventAlreadyProcessed(
  supabase: ReturnType<typeof svc>,
  rentalId: string,
  stripeEventId: string
) {
  const { data, error } = await supabase
    .from("rental_events")
    .select("id")
    .eq("rental_id", rentalId)
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

  const alreadyProcessed = await docsEventAlreadyProcessed(
    supabase,
    requestId,
    stripeEventId
  );
  if (alreadyProcessed) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  const { data: row, error: rowErr } = await supabase
    .from("doc_requests")
    .select("id,paid,status,stripe_payment_intent_id")
    .eq("id", requestId)
    .maybeSingle();

  if (rowErr || !row) return;

  const nextStatus = [
    "draft",
    "submitted",
    "quoted",
    "pending_quote",
    "pending",
    "awaiting_payment",
  ].includes(String(row.status || "").toLowerCase())
    ? "paid"
    : row.status;

  if (
    !row.paid ||
    (paymentIntentId && row.stripe_payment_intent_id !== paymentIntentId)
  ) {
    await supabase
      .from("doc_requests")
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        status: nextStatus,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          paymentIntentId ?? row.stripe_payment_intent_id ?? null,
      })
      .eq("id", requestId);
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

async function markDeliveryPaidFromCheckoutSession(
  supabase: ReturnType<typeof svc>,
  session: Stripe.Checkout.Session,
  stripeEventId: string
) {
  const deliveryId = String(
    session.metadata?.deliveryId || session.metadata?.delivery_id || ""
  ).trim();

  if (!deliveryId) return;

  const alreadyProcessed = await deliveryEventAlreadyProcessed(
    supabase,
    deliveryId,
    stripeEventId
  );
  if (alreadyProcessed) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  const { data: deliveryRow, error: deliveryErr } = await supabase
    .from("deliveries")
    .select("id,order_id,status")
    .eq("id", deliveryId)
    .maybeSingle();

  if (deliveryErr || !deliveryRow) return;

  const orderId = String(
    session.metadata?.orderId || deliveryRow.order_id || ""
  ).trim();

  if (orderId) {
    await resilientUpdateById(supabase, "orders", "id", orderId, {
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
    });
  }

  await resilientUpdateById(supabase, "deliveries", "id", deliveryId, {
    status: "pending",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
  });

  await supabase.from("delivery_admin_events").insert([
    {
      delivery_id: deliveryId,
      admin_user_id: null,
      event_type: "payment_completed",
      before_json: null,
      after_json: {
        source: "stripe_webhook",
        stripe_event_id: stripeEventId,
        session_id: session.id,
        payment_intent: paymentIntentId,
        amount_total: session.amount_total,
        currency: session.currency,
      },
    },
    {
      delivery_id: deliveryId,
      admin_user_id: null,
      event_type: "stripe_webhook_processed",
      before_json: null,
      after_json: {
        stripe_event_id: stripeEventId,
        session_id: session.id,
        payment_status: session.payment_status,
        delivery_status_after: "pending",
      },
    },
  ]);
}

async function markRentalPaidFromCheckoutSession(
  supabase: ReturnType<typeof svc>,
  session: Stripe.Checkout.Session,
  stripeEventId: string
) {
  const rentalId = String(
    session.metadata?.rentalId || session.metadata?.rental_id || ""
  ).trim();
  if (!rentalId) return;

  const alreadyProcessed = await rentalEventAlreadyProcessed(
    supabase,
    rentalId,
    stripeEventId
  );
  if (alreadyProcessed) return;

  const { data: rental } = await supabase
    .from("rentals")
    .select(
      "id,verification_status,agreement_signed,docs_complete,lockbox_code_released_at,stripe_payment_intent_id"
    )
    .eq("id", rentalId)
    .maybeSingle();

  const verificationApproved =
    String(rental?.verification_status || "").toLowerCase() === "approved";
  const agreementSigned = !!rental?.agreement_signed;
  const docsComplete = !!rental?.docs_complete;
  const lockboxReleased = !!rental?.lockbox_code_released_at;

  let nextStatus = "paid_pending_review";
  if (verificationApproved && agreementSigned && docsComplete && lockboxReleased) {
    nextStatus = "pickup_ready";
  }

  await supabase
    .from("rentals")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      status: nextStatus,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : rental?.stripe_payment_intent_id ?? null,
    })
    .eq("id", rentalId);

  await supabase.from("rental_events").insert([
    {
      rental_id: rentalId,
      actor_role: "system",
      event_type: "payment_completed",
      event_payload: {
        session_id: session.id,
        stripe_event_id: stripeEventId,
        status_after: nextStatus,
      },
    },
    {
      rental_id: rentalId,
      actor_role: "system",
      event_type: "stripe_webhook_processed",
      event_payload: {
        stripe_event_id: stripeEventId,
        session_id: session.id,
        payment_status: session.payment_status,
        status_after: nextStatus,
      },
    },
  ]);
}

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const rawBody = await req.text();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      env("STRIPE_WEBHOOK_SECRET")
    );

    const supabase = svc();

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;

      await markRentalPaidFromCheckoutSession(supabase, session, event.id);
      await markDocsPaidFromCheckoutSession(supabase, session, event.id);
      await markDeliveryPaidFromCheckoutSession(supabase, session, event.id);
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Webhook error" },
      { status: 400 }
    );
  }
}