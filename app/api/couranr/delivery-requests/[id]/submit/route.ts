import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isCommandFailure, submitDeliveryRequest } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — submit a draft for Couranr review.
 *
 * Submitting creates NO order, NO delivery row and NO payment. It moves the
 * request to `pending_couranr_review` and nothing else.
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

  const result = await submitDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
    expectedVersion,
    // MER-006's approval checkbox. `=== true` so a missing field, a string
    // "true", or any other truthy value fails closed — the request still
    // submits, but confirming it will require the payer's approval rather
    // than being confirmed on the strength of a malformed body.
    merchantAcknowledged: body?.merchantAcknowledged === true,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  await advanceAutomaticFulfillment(params.id);
  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
