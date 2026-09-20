import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDeliveryFromPromotionalCredit,
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

/** Dispatch a fully credited Operations plan without creating a card charge. */
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

  const reserved = await reserveOperationsDispatchCandidate({ actor: actor.actor, requestId: params.id });
  if (isDispatchFailure(reserved)) return failureResponse(reserved);
  const reservationId = String(reserved.value.reservation.reservationId);

  const created = await createDeliveryFromPromotionalCredit({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
  });
  if (isFulfillmentFailure(created)) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "credit_delivery_conversion_failed",
    });
    return failureResponse(created);
  }

  const deliveryId = String(created.value.delivery.id);
  const { data: delivery, error } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,version,fulfillment_state")
    .eq("id", deliveryId)
    .maybeSingle()) as { data: any; error: any };
  if (error || !delivery) {
    await releaseOperationsDispatchReservation({
      actor: actor.actor,
      reservationId,
      reason: "canonical_delivery_reload_failed",
    });
    return routeInternalFailure({
      operation: "operationsDispatch.creditReload",
      detail: error?.message ?? null,
      message: "The credited delivery was scheduled but Couranr could not finish driver assignment.",
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
      message: "The credited delivery was scheduled but driver assignment did not finish. Reload and assign it.",
    } as any);
  }

  return NextResponse.json({
    deliveryId,
    fulfillmentState: "assigned",
    settlement: "promotional_credit",
    assignmentState: "active",
    assignmentId: assigned.value.assignment.id,
  });
}
