import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDriverProfile,
  isDispatchFailure,
  listDrivers,
  setDriverAvailability,
  setDriverState,
} from "@/lib/couranr/dispatch/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { DRIVER_STATES, SETTABLE_AVAILABILITY } from "@/lib/couranr/dispatch/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — the canonical driver roster. Operations only. */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await listDrivers({ actor: actor.actor });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}

/** POST — create the canonical profile for a driver account. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const userId = String(body?.userId ?? "");
  if (!UUID_RE.test(userId)) return routeFailure("invalid_input", "A driver account is required.");
  const displayName = String(body?.displayName ?? "").trim();
  if (!displayName) return routeFailure("invalid_input", "A display name is required.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await createDriverProfile({
    actor: actor.actor,
    userId,
    displayName,
    contactPhone: typeof body?.contactPhone === "string" ? body.contactPhone : null,
    market: typeof body?.market === "string" ? body.market : null,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}

/**
 * PATCH — activate/suspend a driver, or set their availability.
 *
 * Exactly one of `driverState` or `availabilityState`, each routed to its own
 * named command. `on_delivery` is not accepted from anyone: it is written only
 * by assign/replace, and the SQL refuses it as a second line of defence.
 */
export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const driverId = String(body?.driverId ?? "");
  if (!UUID_RE.test(driverId)) return routeFailure("invalid_input", "A driver is required.");
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current version is required.");
  }

  const driver = body?.driver;
  const availability = body?.availability;
  if ((driver == null) === (availability == null)) {
    return routeFailure("invalid_input", "Set exactly one of driver state or availability.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (driver != null) {
    if (!(DRIVER_STATES as readonly string[]).includes(String(driver))) {
      return routeFailure("invalid_input", "That is not a driver state Couranr can set.");
    }
    const r = await setDriverState({
      actor: actor.actor,
      driverId,
      expectedVersion,
      driverState: String(driver),
    });
    if (isDispatchFailure(r)) return failureResponse(r);
    return NextResponse.json(r.value);
  }

  if (!SETTABLE_AVAILABILITY.includes(String(availability) as any)) {
    return routeFailure("invalid_input", "That is not an availability Couranr can set.");
  }
  const r = await setDriverAvailability({
    actor: actor.actor,
    driverId,
    expectedVersion,
    availabilityState: String(availability),
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}
