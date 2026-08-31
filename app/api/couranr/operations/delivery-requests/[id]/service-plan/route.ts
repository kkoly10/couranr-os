import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { confirmServicePlan, isFulfillmentFailure } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VEHICLE_CLASSES = ["car", "van", "box_truck", "cargo_bike"];

/**
 * POST — Couranr Operations confirms the service plan (OPS-003).
 *
 * The vehicle is a REQUIREMENT, not a row in `vehicles`: that table is the
 * legacy auto-rental one, holds no capacity field, and is a quarantine target.
 * Whether the requirement can actually carry the shipment is decided in the
 * database against the STORED weight, not here and not by the caller.
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

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A request version is required.");
  }

  const pickupStart = String(body?.pickupStart ?? "");
  const pickupEnd = String(body?.pickupEnd ?? "");
  if (!pickupStart || !pickupEnd || new Date(pickupEnd) <= new Date(pickupStart)) {
    return routeFailure("invalid_input", "Enter a pickup window that ends after it starts.");
  }

  const timezone = String(body?.timezone ?? "");
  if (timezone.trim().length === 0) {
    return routeFailure("invalid_input", "A schedule timezone is required.");
  }

  const vehicleClass = String(body?.vehicleClass ?? "");
  if (!VEHICLE_CLASSES.includes(vehicleClass)) {
    return routeFailure("invalid_input", "Choose a vehicle Couranr supports.");
  }
  const maxPayloadLb = Number(body?.maxPayloadLb);
  if (!Number.isFinite(maxPayloadLb) || maxPayloadLb <= 0) {
    return routeFailure("invalid_input", "Enter the vehicle's payload capacity in pounds.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  // Operations reads across businesses, so the scope comes from the request.
  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await confirmServicePlan({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    expectedVersion,
    pickupStart,
    pickupEnd,
    timezone,
    vehicleId: body?.vehicleId ?? null,
    vehicleRequirement: { vehicleClass, maxPayloadLb },
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  return NextResponse.json({
    plan: {
      id: result.value.plan.id,
      planState: result.value.plan.plan_state,
      scheduledPickupStart: result.value.plan.scheduled_pickup_start,
      scheduledPickupEnd: result.value.plan.scheduled_pickup_end,
      timezone: result.value.plan.timezone,
      vehicleRequirement: result.value.plan.vehicle_requirement,
    },
  });
}
