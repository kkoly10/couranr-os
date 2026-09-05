import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  isHostedFailure,
  validateHostedRequestByMerchant,
  validateMerchantHostedConfirmation,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const expectedVersion = Number(body?.expectedVersion);
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A request version is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind !== "member") {
    return routeFailure("not_permitted", "Only the host business can validate this request.");
  }

  const validated = validateMerchantHostedConfirmation(body);
  if (validated.ok === false) {
    return routeFailure("invalid_input", "Confirm the payer, shipment weight and safety details.");
  }

  const result = await validateHostedRequestByMerchant({
    requestId: id,
    hostBusinessAccountId: businessAccountId,
    expectedVersion,
    actorUserId: actor.actor.userId,
    input: validated.value,
  });
  if (isHostedFailure(result)) return failureResponse(result);

  // Normal lane: service review may advance to awaiting payer approval. This
  // never captures money here; planning remains blocked until payer approval
  // and merchant readiness are both real.
  await advanceAutomaticFulfillment(id);

  return NextResponse.json({
    request: toDeliveryRequestView(result.value.request),
  });
}
