import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripeClient";
import {
  applyVerifiedIntentState,
  getObligationByIntentId,
  isPaymentFailure,
} from "@/lib/couranr/payments/commands";
import {
  isFulfillmentFailure,
  reconcileCapture,
} from "@/lib/couranr/fulfillment/commands";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
// The signature is computed over the exact bytes Stripe sent. Any framework
// body parsing would change them and every verification would fail.
export const runtime = "nodejs";

/**
 * POST /api/couranr/stripe/webhook — the CANONICAL Couranr payment webhook.
 *
 * Deliberately separate from `/api/stripe/webhook`, which is the legacy
 * multi-product endpoint that handles auto, docs and delivery checkout
 * sessions with per-table JSON `.contains()` reads and a 20-pass
 * `resilientUpdateById`. Nothing here shares a line with it, and this endpoint
 * uses its OWN signing secret so rotating one cannot silently break the other.
 *
 * ORDER OF OPERATIONS, and why it is this one:
 *
 *   1. read the RAW body — not `req.json()`, which would re-serialize and
 *      invalidate the signature
 *   2. verify the signature with STRIPE_COURANR_WEBHOOK_SECRET
 *   3. only then look at what the payload says
 *
 * An unsigned or wrongly-signed request is refused before its contents are
 * parsed, so a forged body never reaches a query.
 *
 * Everything after that is the database's problem: `applyVerifiedIntentState`
 * re-checks amount, currency, PaymentIntent id and all three metadata ids
 * against the stored obligation, and the unique event id makes a replay a
 * no-op. This route decides nothing about money.
 */

/** 200 with a body Stripe ignores, so a handled event is never re-delivered. */
function ack(outcome: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, outcome, ...extra }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return routeFailure("invalid_input", "Missing signature.");
  }

  const secret = process.env.STRIPE_COURANR_WEBHOOK_SECRET;
  if (!secret) {
    const correlationId = newCorrelationId();
    logServerFailure({
      operation: "couranrStripeWebhook",
      correlationId,
      code: "internal",
      // The NAME only. A secret's value never enters a log line.
      detail: "STRIPE_COURANR_WEBHOOK_SECRET is not configured",
    });
    // 500, not 200: Stripe must retry once this is configured rather than
    // treating an unverifiable event as handled.
    return routeFailure("internal", "Webhook not configured.");
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (e: any) {
    const correlationId = newCorrelationId();
    logServerFailure({
      operation: "couranrStripeWebhook.verify",
      correlationId,
      code: "not_permitted",
      detail: { message: e?.message },
    });
    // 400 so Stripe stops retrying a body it cannot sign for.
    return routeFailure("invalid_input", "Signature verification failed.");
  }

  const object: any = (event.data as any)?.object ?? {};
  if (object?.object !== "payment_intent") {
    // Recorded nowhere and acted on not at all — this endpoint is only for
    // PaymentIntents. Acked so Stripe does not retry forever.
    return ack("not_a_payment_intent");
  }

  /*
   * CAPTURE RECONCILIATION IS AUTHORITATIVE ONCE THE OBLIGATION IS
   * capture_pending.
   *
   * The authorization state machine has no concept of an in-flight capture. An
   * `amount_capturable_updated` applied there would move capture_pending back
   * to `authorized` and re-arm Capture over money that may already have moved;
   * a `payment_failed` or `canceled` would settle the state without clearing
   * capture_requested_at, revoking live payment links or cancelling the
   * service plan that referenced the dead obligation.
   *
   * So a capture_pending obligation goes through the SAME closed mapping the
   * Operations reconcile route uses — literally the same function — and
   * `couranr_apply_payment_intent_state` refuses it as a second line of
   * defence if this check is ever bypassed.
   *
   * AND THE PAYLOAD IS NOT THE EVIDENCE. This calls `reconcileCapture`, which
   * RETRIEVES the intent, rather than mapping `event.data.object` directly.
   * Stripe is explicit that it "doesn't guarantee the delivery of events in
   * the order that they're generated" and tells you to "use the API to
   * retrieve any missing objects" (https://docs.stripe.com/webhooks). An
   * `amount_capturable_updated` generated at authorization time can therefore
   * be delivered AFTER the capture request — and applied from its own payload
   * it says `requires_capture`, releases the hold and re-arms Capture over a
   * capture that is genuinely still running. That is precisely the hazard the
   * paragraph above describes, and mapping the snapshot reintroduced it.
   *
   * A live retrieve costs one API call on an event that is rare by
   * construction, and it makes the webhook and the operator's "Check with the
   * payment provider" read the same fact from the same place.
   */
  const known = await getObligationByIntentId({ intentId: String(object.id ?? "") });
  if (isPaymentFailure(known)) return failureResponse(known);

  const inFlight = known.value.obligation;
  if (inFlight && inFlight.payment_state === "capture_pending") {
    // No actor: this is the provider talking, not an operator. `reconcileCapture`
    // only enforces the operations check when an actor is supplied.
    const resolved = await reconcileCapture({
      requestId: String(inFlight.request_id),
      obligationId: String(inFlight.id),
      obligationVersion: Number(inFlight.version),
      paymentIntentId: String(inFlight.provider_payment_intent_id ?? object.id ?? ""),
    });
    if (isFulfillmentFailure(resolved)) return failureResponse(resolved);
    return ack(resolved.value.outcome, {
      paymentState: resolved.value.paymentState,
      deliveryId: resolved.value.deliveryId,
      via: "capture_reconciliation",
    });
  }

  const result = await applyVerifiedIntentState({
    providerEventId: event.id,
    eventType: event.type,
    intentId: String(object.id ?? ""),
    intentStatus: String(object.status ?? ""),
    amount: Number(object.amount ?? 0),
    amountCapturable: Number(object.amount_capturable ?? 0),
    currency: String(object.currency ?? ""),
    metadata: (object.metadata as Record<string, string>) ?? {},
    /*
     * QVL-001. The signature-verified event carries WHEN Stripe recorded this,
     * which is when the payer approved. Passing it means a 3DS challenge, a
     * retry or a delivery backlog cannot expire an approval that was obtained
     * inside the window.
     */
    authorizedAtUnixSeconds: typeof event.created === "number" ? event.created : null,
  });

  if (isPaymentFailure(result)) {
    /*
     * A failure here is Couranr's, not Stripe's. 500 makes Stripe retry, which
     * is what we want: the event is real and has not been applied. The reply
     * carries a correlation id and nothing else — never the driver message.
     */
    return failureResponse(result);
  }

  /*
   * `duplicate` is a SUCCESS. The event was already applied, so re-delivering
   * it must not look like a failure or Stripe will keep retrying forever.
   * `rejected` is also a 200: the event is genuinely Stripe's, we have decided
   * it does not match our records, and retrying will never change that. It is
   * recorded in couranr_payment_events with its reason.
   */
  return ack(result.value.outcome, {
    paymentState: result.value.payment_state,
    requestState: result.value.request_state,
  });
}
