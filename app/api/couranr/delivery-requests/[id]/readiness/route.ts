import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, setReadiness } from "@/lib/couranr/fulfillment/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { READINESS_STATES, type ReadinessState } from "@/lib/couranr/requests/states";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import {
  isHostedFailure,
  setHostedMerchantReadiness,
} from "@/lib/couranr/hosted/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — pickup readiness (currently asserted by the merchant; MER-007).
 *
 * `readiness` names a DESTINATION, and the command layer maps it to one of
 * four named SQL commands, each of which hard-codes its own target. There is
 * no patch operation here and no way to reach a state the graph does not
 * allow — an unrecognised value is refused before it reaches the database.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

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

  const readiness = String(body?.readiness ?? "");
  if (!(READINESS_STATES as readonly string[]).includes(readiness)) {
    return routeFailure("invalid_input", "That is not a readiness Couranr recognises.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const isHosted =
    loaded.value.request.source === "hosted_request" &&
    loaded.value.request.requester_kind === "consumer" &&
    loaded.value.request.business_account_id === null;

  let nextRequest: Record<string, any>;
  if (isHosted) {
    if (actor.actor.kind !== "member") {
      return routeFailure("not_permitted", "Only the host business can update readiness.");
    }
    const hosted = await setHostedMerchantReadiness({
      requestId: params.id,
      hostBusinessAccountId: businessAccountId,
      expectedVersion,
      actorUserId: actor.actor.userId,
      to: readiness as ReadinessState,
    });
    if (isHostedFailure(hosted)) return failureResponse(hosted);
    nextRequest = hosted.value.request;
  } else {
    const result = await setReadiness({
      actor: actor.actor,
      requestId: params.id,
      businessAccountId,
      expectedVersion,
      to: readiness as ReadinessState,
    });
    if (isFulfillmentFailure(result)) return failureResponse(result);
    nextRequest = result.value.request;
  }

  if (readiness === "ready") {
    await advanceAutomaticFulfillment(params.id);
  }
  return NextResponse.json({ request: toDeliveryRequestView(nextRequest) });
}
