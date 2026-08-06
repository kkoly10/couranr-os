import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  assignDelivery,
  getDispatchPanel,
  isDispatchFailure,
  replaceDeliveryAssignment,
} from "@/lib/couranr/dispatch/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — everything OPS-003 needs to draw the assignment panel.
 *
 * Operations only. The roster and the delivery are returned together so the
 * selector and the eligibility rule come from one read; fetching them
 * separately is how a screen ends up offering a driver who became busy between
 * two requests.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await getDispatchPanel({ actor: actor.actor, deliveryId: params.id });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}

/**
 * POST — assign a driver and a vehicle to a scheduled delivery.
 *
 * The body carries exactly two identifiers and a version. It cannot carry a
 * fulfillment state: `scheduled -> assigned` is hard-coded inside
 * `couranr_assign_delivery`, so there is no path by which a browser names where
 * a delivery lands. It cannot carry a capability either — whether the vehicle
 * can do the job is read from the vehicle row against the plan's immutable
 * requirement.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const driverId = String(body?.driverId ?? "");
  const vehicleId = String(body?.vehicleId ?? "");
  if (!UUID_RE.test(driverId)) return routeFailure("invalid_input", "Select a driver.");
  if (!UUID_RE.test(vehicleId)) return routeFailure("invalid_input", "Select a vehicle.");
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current delivery version is required.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await assignDelivery({
    actor: actor.actor,
    deliveryId: params.id,
    expectedVersion,
    driverId,
    vehicleId,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json({ assignment: r.value.assignment });
}

/**
 * PUT — replace the assignment before pickup.
 *
 * Separate verb rather than a flag on POST: replacing is a different command
 * with a different precondition (`assigned`, not `scheduled`) and a different
 * audit record. Collapsing them would let a caller reach one by mistyping the
 * other.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const driverId = String(body?.driverId ?? "");
  const vehicleId = String(body?.vehicleId ?? "");
  const replacedAssignmentId = String(body?.replacedAssignmentId ?? "");
  if (!UUID_RE.test(driverId)) return routeFailure("invalid_input", "Select a driver.");
  if (!UUID_RE.test(vehicleId)) return routeFailure("invalid_input", "Select a vehicle.");
  if (!UUID_RE.test(replacedAssignmentId)) {
    return routeFailure("invalid_input", "The assignment being replaced is required.");
  }
  const expectedAssignmentVersion = Number(body?.expectedAssignmentVersion);
  if (!Number.isInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 1) {
    return routeFailure("invalid_input", "A current assignment version is required.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await replaceDeliveryAssignment({
    actor: actor.actor,
    deliveryId: params.id,
    replacedAssignmentId,
    expectedAssignmentVersion,
    driverId,
    vehicleId,
    reason: typeof body?.reason === "string" ? body.reason : null,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json({ assignment: r.value.assignment });
}
