import { NextRequest, NextResponse } from "next/server";
import { arriveAtPickup, isDriverFailure } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A JSON number or a numeric string, and nothing else.
 *
 * `Number(null)` is 0 and `Number(true)` is 1, so a bare `Number()` would turn a
 * device that never got a fix into a driver standing at the equator — and the
 * SQL's `location_required` check, which tests for null, would never see it.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coordinates as the driver's device reported them.
 *
 * Range-checked here so the SQL's `location_required` never has to stand in
 * for a malformed number: a caller sending `"NaN"` deserves copy about their
 * location, not a conflict about the delivery's state.
 */
function coordinates(
  body: any
): { latitude: number; longitude: number; accuracyM: number | null } | null {
  const latitude = toNumber(body?.latitude);
  const longitude = toNumber(body?.longitude);
  // toNumber returns finite-or-null, so excluding null IS the finiteness
  // check — and unlike Number.isFinite, the null comparison narrows the type.
  if (latitude === null || latitude < -90 || latitude > 90) return null;
  if (longitude === null || longitude < -180 || longitude > 180) return null;

  let accuracyM: number | null = null;
  if (body?.accuracyM !== null && body?.accuracyM !== undefined) {
    accuracyM = toNumber(body.accuracyM);
    if (accuracyM === null || accuracyM < 0) return null;
  }

  return { latitude, longitude, accuracyM };
}

/**
 * POST — the driver is at the sender (`en_route_to_pickup -> at_pickup`).
 *
 * The location is recorded, never trusted as authorization: it is evidence
 * attached to the transition, and the caller's own assignment is what decides
 * whether the transition may happen at all.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current delivery version is required.");
  }

  const at = coordinates(body);
  if (!at) {
    return routeFailure(
      "invalid_input",
      "Couranr needs your location for this step. Turn on location and try again."
    );
  }

  const r = await arriveAtPickup({
    userId: auth.userId,
    deliveryId: params.id,
    expectedVersion,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: at.accuracyM,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value });
}
