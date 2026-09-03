import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  cancelDeliveryWithRecovery,
  isCancellationReason,
} from "@/lib/couranr/fulfillment/cancellation";
import { isFulfillmentFailure } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bounded so a paste cannot put an essay into an audit row. */
const NOTE_MAX = 500;

/**
 * POST — cancel a delivery under CAN-001, with its governed money recovery.
 *
 * The body carries a REASON from a closed vocabulary and a NOTE — never an
 * amount, never a fee, never a target state. Which money command runs
 * (release, $8-retained refund, $15 failed-pickup refund, $0 Couranr-caused)
 * is derived server-side from the STORED delivery stage and the reason;
 * every figure lives in `couranr_begin_payment_refund`'s own retention table.
 *
 * Safe to retry: both closure commands replay idempotently and the refund
 * converges on the same persisted attempt under one provider idempotency
 * key, so a second click can neither cancel twice nor refund twice.
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
    return routeFailure("invalid_input", "Say why this delivery is being cancelled.");
  }

  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!isCancellationReason(reason)) {
    return routeFailure("invalid_input", "Pick a governed cancellation reason.");
  }
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note) return routeFailure("invalid_input", "Say why this delivery is being cancelled.");
  if (note.length > NOTE_MAX) return routeFailure("invalid_input", "That note is too long.");
  const deliveryId = typeof body?.deliveryId === "string" ? body.deliveryId : null;
  if (deliveryId !== null && !UUID_RE.test(deliveryId)) {
    return routeFailure("invalid_input", "That delivery reference is not valid.");
  }

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await cancelDeliveryWithRecovery({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    deliveryId,
    reason,
    note,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ cancellation: result.value });
}
