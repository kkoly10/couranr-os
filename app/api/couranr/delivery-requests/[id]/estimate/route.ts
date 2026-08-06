import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  calculateDeliveryRequestEstimate,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — recompute the estimate for a draft.
 *
 * The body carries no amount and no target status: only which request, which
 * business, the version the caller believes it is acting on, and optionally an
 * edited shipment. A draft is editable, so re-pricing must price the edit —
 * otherwise the merchant sees an estimate for values they already changed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A request version is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await calculateDeliveryRequestEstimate({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
    expectedVersion,
    // Undefined when the caller only wants a re-price of what is stored.
    rawInput: body?.request,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
