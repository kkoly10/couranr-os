import type Stripe from "stripe";
import { stripe } from "@/lib/stripeClient";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { AUTHORIZING_INTENT_STATUS } from "./states";

assertServerOnly("lib/couranr/payments/stripe.ts");

/**
 * PaymentIntent creation for Couranr delivery authorization.
 *
 * MANUAL CAPTURE, ALWAYS. `capture_method: "manual"` is what makes this an
 * authorization: a successful confirmation leaves the intent at
 * `requires_capture` with the funds HELD, not taken. This slice never calls
 * `.capture()` — there is no wrapper for it here, and a test asserts the
 * string never appears in the payment modules.
 *
 * THE AMOUNT COMES FROM THE OBLIGATION. This function takes an obligation, not
 * an amount, so there is no parameter a caller could use to name a price.
 */

export type ObligationForIntent = {
  id: string;
  request_id: string;
  business_account_id: string;
  payer_type: string;
  amount_cents: number;
  currency: string;
  pricing_policy_version: string;
  request_version: number;
};

/**
 * Metadata Couranr writes on every PaymentIntent, and checks again on the way
 * back in. The webhook re-reads these and refuses an event whose ids do not
 * match the stored obligation, so metadata is a verification input rather than
 * decoration.
 *
 * Nothing here is a secret, a token or anything a customer typed. Stripe
 * metadata is readable in the dashboard and returned on every event.
 */
export function intentMetadata(ob: ObligationForIntent): Record<string, string> {
  return {
    couranrRequestId: String(ob.request_id),
    businessAccountId: String(ob.business_account_id),
    paymentObligationId: String(ob.id),
    payerType: String(ob.payer_type),
    pricingPolicyVersion: String(ob.pricing_policy_version),
    requestVersion: String(ob.request_version),
  };
}

/**
 * One idempotency key per obligation and version.
 *
 * Two clicks on "Authorize" reach Stripe with the same key and produce ONE
 * PaymentIntent. A re-priced quote is a different obligation with a different
 * id, so it correctly gets a different key rather than colliding with the
 * superseded one's.
 */
export function intentIdempotencyKey(ob: ObligationForIntent, version: number): string {
  return `couranr:obligation:${ob.id}:v${version}`;
}

export async function createManualCapturePaymentIntent(params: {
  obligation: ObligationForIntent;
  obligationVersion: number;
}): Promise<Stripe.PaymentIntent> {
  const { obligation: ob } = params;

  return stripe.paymentIntents.create(
    {
      // Straight off the obligation row. No caller-supplied amount exists.
      amount: ob.amount_cents,
      currency: ob.currency,
      // The whole point of this slice.
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
      metadata: intentMetadata(ob),
      description: `Couranr delivery ${ob.request_id}`,
    },
    { idempotencyKey: intentIdempotencyKey(ob, params.obligationVersion) }
  );
}

/** Re-reads an intent from Stripe. Used to verify rather than to trust. */
export async function retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.retrieve(id);
}

/**
 * Does this PaymentIntent actually hold the full amount?
 *
 * `requires_capture` alone is not enough — `amount_capturable` must equal what
 * is owed, or a partial authorization would be recorded as a whole one. The
 * database re-checks both; this is the same rule stated where the intent is
 * read, so neither side has to trust the other.
 */
export function isFullyAuthorized(
  pi: Pick<Stripe.PaymentIntent, "status" | "amount_capturable">,
  amountCents: number
): boolean {
  return pi.status === AUTHORIZING_INTENT_STATUS && pi.amount_capturable === amountCents;
}

/**
 * A stable event id for a state Couranr observed by RETRIEVING an intent
 * rather than by receiving a webhook.
 *
 * Deterministic on purpose: polling the same intent twice produces the same id
 * and therefore collides on the events table's unique index, so a retrieve is
 * exactly as idempotent as a webhook delivery and the two cannot double-apply
 * the same fact between them.
 */
export function syntheticEventId(pi: {
  id: string;
  status: string;
  amount_capturable?: number | null;
}): string {
  return `couranr:retrieve:${pi.id}:${pi.status}:${pi.amount_capturable ?? 0}`;
}
