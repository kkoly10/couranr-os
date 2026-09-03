import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, reconcileRefund } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — converge a refund attempt whose provider outcome is unknown.
 *
 * The ONLY way out of `pending_unknown` (and a `requested` attempt orphaned
 * by a crash). It never mints a new attempt: the provider is asked what
 * actually happened — list by our own metadata first, then a re-submit under
 * the SAME idempotency key — so a duplicate provider refund is structurally
 * impossible on this path.
 *
 * Takes no amount, no reason and no provider identifier.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await reconcileRefund({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refund: result.value });
}
