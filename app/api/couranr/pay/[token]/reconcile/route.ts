import { NextRequest, NextResponse } from "next/server";
import {
  getObligationForRequest,
  isPaymentFailure,
  reconcilePaymentIntent,
  redeemPaymentLink,
} from "@/lib/couranr/payments/commands";
import { isWellFormedToken } from "@/lib/couranr/payments/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

/**
 * POST — the page says the Payment Element finished. Go and check.
 *
 * A browser redirect and a Payment Element success callback are CLAIMS. This
 * route accepts no state, no amount and no PaymentIntent id from the caller:
 * it resolves the intent from the stored obligation, retrieves it from Stripe,
 * and applies whatever Stripe actually says. A page that lies about success
 * gets `ignored` and the obligation does not move.
 *
 * The webhook does the same job independently. Whichever arrives first wins,
 * and the other collides on the event id — so this is a latency optimisation,
 * never the only path to `authorized`.
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!isWellFormedToken(params.token)) {
    return NextResponse.json({ valid: false, reason: "not_found" }, { status: 404 });
  }

  const link = await redeemPaymentLink({ rawToken: params.token });
  if (isPaymentFailure(link)) return failureResponse(link);

  // `already_authorized` is not an error here — it is the answer the page is
  // waiting for, and it is what a second reconcile of a finished payment says.
  const requestId = link.value.request_id;
  if (!requestId) {
    return NextResponse.json({ valid: false, reason: link.value.reason ?? "not_found" }, { status: 410 });
  }

  const ob = await getObligationForRequest({ requestId: String(requestId), businessAccountId: null });
  if (isPaymentFailure(ob) || !ob.value.obligation) {
    return NextResponse.json({ valid: false, reason: "no_obligation" }, { status: 410 });
  }
  const intentId = ob.value.obligation.provider_payment_intent_id;
  if (!intentId) {
    return NextResponse.json({ valid: false, reason: "no_payment_intent" }, { status: 409 });
  }

  const applied = await reconcilePaymentIntent({
    intentId: String(intentId),
    obligationVersion: Number(ob.value.obligation.version),
  });
  if (isPaymentFailure(applied)) return failureResponse(applied);

  await advanceAutomaticFulfillment(String(requestId));
  return NextResponse.json({
    outcome: applied.value.outcome,
    paymentState: applied.value.payment_state,
    requestState: applied.value.request_state,
  });
}
