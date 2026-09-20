import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  capturePayment,
  getCanonicalDelivery,
  getServicePlan,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import {
  commitOperationsDispatchAssignment,
  isDispatchFailure,
  releaseOperationsDispatchReservation,
  reserveOperationsDispatchCandidate,
} from "@/lib/couranr/dispatch/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { failureResponse, routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — dispatch an Operations-planned, card-authorized delivery.
 *
 * Ordering is deliberate:
 *   1. reserve a real compatible driver + vehicle
 *   2. capture the existing authorized hold (no browser amount)
 *   3. create/reuse the canonical delivery
 *   4. atomically commit the reserved assignment
 *
 * This closes the old manual-flow gap where Operations captured first and only
 * afterwards discovered whether anyone could actually take the delivery.
 * Automatic plans keep their existing server-worker path, which already uses
 * the same reserve -> settle -> assign ordering.
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

  const plan = await getServicePlan({ requestId: params.id });
  if (isFulfillmentFailure(plan)) return failureResponse(plan);
  if (!plan.value.plan || plan.value.plan.plan_source !== "operations") {
    return routeFailure("conflict", "This delivery is not on an Operations dispatch plan.");
  }

  const reserved = await reserveOperationsDispatchCandidate({
    actor: actor.actor,
    requestId: params.id,
  });
  if (isDispatchFailure(reserved)) return failureResponse(reserved);
  const reservationId = String(reserved.value.reservation.reservationId);

  const captured = await capturePayment({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
  });
  if (isFulfillmentFailure(captured)) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "payment_capture_not_completed",
    });
    return failureResponse(captured);
  }

  const deliveryId = captured.value.deliveryId;
  if (!deliveryId) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "canonical_delivery_missing",
    });
    return routeInternalFailure({
      operation: "operationsDispatch.capture",
      detail: { requestId: params.id },
      message: "Payment settled but the delivery could not be loaded. Do not capture again.",
    });
  }

  const { data: delivery, error: deliveryError } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,version,fulfillment_state")
    .eq("id", deliveryId)
    .maybeSingle()) as { data: any; error: any };

  if (deliveryError || !delivery) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "canonical_delivery_reload_failed",
    });
    return routeInternalFailure({
      operation: "operationsDispatch.reloadDelivery",
      detail: deliveryError?.message ?? null,
      message: "Payment settled but Couranr could not finish driver assignment. Do not capture again.",
    });
  }

  if (delivery.fulfillment_state === "assigned") {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "delivery_already_assigned",
    });
    return NextResponse.json({
      paymentState: captured.value.paymentState,
      deliveryId,
      fulfillmentState: "assigned",
      assignmentState: "active",
    });
  }

  const assigned = await commitOperationsDispatchAssignment({
    actor: actor.actor,
    reservationId,
    deliveryId,
    expectedVersion: Number(delivery.version),
    requestId: params.id,
    servicePlanId: String(plan.value.plan.id),
  });
  if (isDispatchFailure(assigned)) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "assignment_commit_failed",
    });
    return failureResponse({
      ...assigned,
      message:
        "Payment was captured, but driver assignment did not finish. Do not capture again; reload and assign the scheduled delivery.",
    } as any);
  }

  return NextResponse.json({
    paymentState: captured.value.paymentState,
    deliveryId,
    fulfillmentState: "assigned",
    assignmentState: "active",
    assignmentId: assigned.value.assignment.id,
  });
}
