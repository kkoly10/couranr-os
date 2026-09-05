import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  validateHostedRequest,
  declineHostedRequest,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Merchant validation boundary for a customer-created hosted request.
 *
 * The browser may choose form facts, but never sends mileage, route evidence,
 * quote line items, price, quote status, or a lifecycle target. Validation
 * re-resolves Google Place identities and derives Mapbox/Pricing V2 server-side
 * before the one CAS SQL command can open payment/review.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) return routeFailure("not_found", "Delivery request not found.");

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

  const action = String(body?.action ?? "");
  if (action === "validate") {
    const validation =
      body?.validation && typeof body.validation === "object" ? body.validation : {};
    /*
     * Deliberately pick the allow-list. Even if a hostile browser posts
     * routeDistanceMeters, subtotalCents or quoteStatus, none reaches the
     * command module.
     */
    const result = await validateHostedRequest({
      actor: actor.actor,
      hostBusinessAccountId: businessAccountId,
      requestId: id,
      expectedVersion,
      rawInput: {
        pickupPlaceId: validation.pickupPlaceId,
        dropoffPlaceId: validation.dropoffPlaceId,
        payerType: validation.payerType,
        weightLb: validation.weightLb,
        weightBand: validation.weightBand,
        restrictedClass: validation.restrictedClass,
        signatureRequired: validation.signatureRequired,
      },
    });
    if (isHostedFailure(result)) return failureResponse(result);
    return NextResponse.json({ request: toDeliveryRequestView(result.value) });
  }

  if (action === "decline") {
    const result = await declineHostedRequest({
      actor: actor.actor,
      hostBusinessAccountId: businessAccountId,
      requestId: id,
      expectedVersion,
      reason: body?.reason,
    });
    if (isHostedFailure(result)) return failureResponse(result);
    return NextResponse.json({ request: toDeliveryRequestView(result.value) });
  }

  return routeFailure("invalid_input", "Choose a hosted-request action.");
}
