import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDispatchVehicle,
  isDispatchFailure,
  listVehicles,
} from "@/lib/couranr/dispatch/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { VEHICLE_CLASSES } from "@/lib/couranr/dispatch/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — OPS-008's canonical vehicle list. Operations only. */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await listVehicles({ actor: actor.actor });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}

/**
 * POST — add a canonical dispatch vehicle.
 *
 * Capability fields are stored HERE and read back server-side at assignment
 * time. Nothing a browser says about what a vehicle can carry is ever trusted
 * at the moment of assignment; it is only trusted as the operator's own record
 * of their fleet, which is what this endpoint writes.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const name = String(body?.name ?? "").trim();
  if (!name) return routeFailure("invalid_input", "A vehicle name is required.");
  const vehicleClass = String(body?.vehicleClass ?? "");
  if (!(VEHICLE_CLASSES as readonly string[]).includes(vehicleClass)) {
    return routeFailure("invalid_input", "That is not a Couranr vehicle class.");
  }
  const payloadCapacityLb = Number(body?.payloadCapacityLb);
  if (!Number.isFinite(payloadCapacityLb) || payloadCapacityLb <= 0) {
    return routeFailure("invalid_input", "A payload capacity is required.");
  }
  const assignedDriverId =
    typeof body?.assignedDriverId === "string" && UUID_RE.test(body.assignedDriverId)
      ? body.assignedDriverId
      : null;

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

  const r = await createDispatchVehicle({
    actor: actor.actor,
    name,
    vehicleClass,
    payloadCapacityLb: Math.trunc(payloadCapacityLb),
    assignedDriverId,
    cargoLengthIn: num(body?.cargoLengthIn),
    cargoWidthIn: num(body?.cargoWidthIn),
    cargoHeightIn: num(body?.cargoHeightIn),
    enclosed: body?.enclosed === true,
    hasRamp: body?.hasRamp === true,
    hasDolly: body?.hasDolly === true,
    hasTieDowns: body?.hasTieDowns === true,
    weatherProtection: body?.weatherProtection === true,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}
