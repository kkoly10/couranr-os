import { NextRequest, NextResponse } from "next/server";
import {
  ensurePaymentIntent,
  getObligationForRequest,
  isPaymentFailure,
  redeemPaymentLink,
} from "@/lib/couranr/payments/commands";
import { isWellFormedToken } from "@/lib/couranr/payments/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * The customer payment link (PUB-005 / CUS-005).
 *
 * UNAUTHENTICATED BY DESIGN: the token IS the authorization, which is why it
 * carries 256 bits of entropy, is stored only as a SHA-256 hash, is scoped to
 * one request and one action, expires within 7 days, and is revoked the moment
 * the quote changes or the payment authorizes.
 *
 * A refused link returns a REASON, not a record. `not_found`, `revoked` and
 * `expired` carry no request data at all, so probing a link tells an attacker
 * nothing about whether a delivery exists.
 */

function refusal(reason: string, status = 404) {
  return NextResponse.json({ valid: false, reason }, { status });
}

/** GET — what this link is for: the quote the customer is being asked to approve. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!isWellFormedToken(params.token)) return refusal("not_found");

  const r = await redeemPaymentLink({ rawToken: params.token });
  if (isPaymentFailure(r)) return failureResponse(r);
  const link = r.value;
  if (!link.valid) return refusal(link.reason ?? "not_found", 410);

  const ob = await getObligationForRequest({
    requestId: String(link.request_id),
    businessAccountId: null,
  });
  if (isPaymentFailure(ob) || !ob.value.obligation) return refusal("no_obligation", 410);

  return NextResponse.json({
    valid: true,
    // Deliberately narrow. A payment page needs the amount and what it is for;
    // it does not need the merchant's account, the recipient's details or the
    // request's history.
    amountCents: ob.value.obligation.amount_cents,
    currency: ob.value.obligation.currency,
    payerType: link.payer_type,
    paymentState: ob.value.obligation.payment_state,
    requestState: link.request_state,
    // A revised quote is labelled as one; CUS-005 renders it differently.
    isRevisedQuote: link.request_state === "quote_revision_required",
  });
}

/** POST — set up the PaymentIntent for this link and return its client secret. */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!isWellFormedToken(params.token)) return refusal("not_found");

  const r = await redeemPaymentLink({ rawToken: params.token });
  if (isPaymentFailure(r)) return failureResponse(r);
  if (!r.value.valid) return refusal(r.value.reason ?? "not_found", 410);

  const ob = await getObligationForRequest({
    requestId: String(r.value.request_id),
    businessAccountId: null,
  });
  if (isPaymentFailure(ob) || !ob.value.obligation) return refusal("no_obligation", 410);

  const intent = await ensurePaymentIntent({ obligation: ob.value.obligation });
  if (isPaymentFailure(intent)) return failureResponse(intent);

  return NextResponse.json({
    valid: true,
    amountCents: intent.value.obligation.amount_cents,
    currency: intent.value.obligation.currency,
    clientSecret: intent.value.clientSecret,
  });
}
