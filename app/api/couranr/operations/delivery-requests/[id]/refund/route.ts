import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, refundPayment } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the STANDALONE refund action: FULL REFUND only (correction pass,
 * review item 6).
 *
 * Cancellation retentions ($8 / $15 / Couranr-caused) are derived from the
 * delivery's STORED lifecycle stage by `cancelDeliveryWithRecovery` on the
 * cancel-delivery route — a dropdown here must never SUBSTITUTE a reason for
 * that stored stage, so this route refuses every retention reason outright.
 * The wider `REFUND_REASONS` vocabulary stays for the internal governed
 * orchestration only.
 *
 * There is still NO amount parameter anywhere on this path —
 * `couranr_begin_payment_refund` derives the figure server-side. Safe to
 * retry: the attempt row is persisted before Stripe is called and a replay
 * converges on it LIST-FIRST — a provider match completes the row, and only
 * a fully-read list proving absence permits a create.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "The standalone refund action refunds in full. Send reason 'full_refund'.");
  }

  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (reason !== "full_refund") {
    return routeFailure(
      "invalid_input",
      "The standalone refund action refunds in full only. Cancellation retentions run through the Cancel delivery action, where Couranr derives the stage."
    );
  }

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await refundPayment({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    reason: "full_refund",
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refund: result.value });
}
