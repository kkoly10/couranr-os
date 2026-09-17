import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { stripeRefundGateway } from "@/lib/couranr/fulfillment/commands";
import {
  approveRefundRequest,
  isRefundReviewFailure,
  parseRefundApproval,
} from "@/lib/couranr/operations/refunds";

export const dynamic = "force-dynamic";

/**
 * POST — approve a delivery-charge refund, in full or in part (OPS-011
 * "Approve full/partial").
 *
 * THE FIGURE THAT ARRIVES HERE IS A REQUEST, NOT AN AUTHORITY.
 *
 * `parseRefundApproval` lives in `lib/couranr/operations/refunds.ts`, not in
 * this file, for two reasons and both of them matter. First, canonical routes
 * stay thin and shared logic lives under `lib/`. Second,
 * `tests/couranr-server-only.test.ts` forbids a canonical route from reading a
 * money field off its own request body at all — a rule worth keeping exactly
 * as strict as it is, because the one thing a route must never do is take a
 * browser's number and spend it.
 *
 * What actually decides the money is `couranr_approve_refund_request`: under a
 * row lock on the payment obligation it recomputes
 * `captured_amount_cents - refunded_amount_cents` and REFUSES — never clamps —
 * any figure above it. The parsed value only ever gets to be a ceiling-checked
 * proposal, and a CHECK constraint makes a clamped row unwritable besides.
 *
 * Safe to replay. The approval converges on the decision already recorded, the
 * attempt converges on the one already created, and the provider converges
 * list-first under an idempotency key derived from the review record's
 * identity and version. Two Operations users pressing this at the same moment
 * produce ONE refund.
 *
 * Couranr refunds its own delivery charge here and nothing else: the merchant
 * controls a merchandise refund (REF-002).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send the refund figure you are approving and the version you are deciding on.");
  }

  const parsed = parseRefundApproval(raw, params.id);
  /* `=== false`, not `!parsed.ok`: the root tsconfig sets "strict": false, and
     a bare truthiness test does not narrow a discriminated union under it. */
  if (parsed.ok === false) return routeFailure("invalid_input", parsed.message);

  const result = await approveRefundRequest({
    actor: actor.actor,
    refundRequestId: parsed.refundRequestId,
    expectedVersion: parsed.expectedVersion,
    requestedAmountCents: parsed.requestedAmountCents,
    // The provider seam, named explicitly. It has no default value, so a
    // caller that omits it does not compile.
    gateway: stripeRefundGateway(),
  });
  if (isRefundReviewFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refundRequest: result.value });
}
