import { NextRequest, NextResponse } from "next/server";
import { completePickup, isDriverFailure } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NAME = 200;
const MAX_TEXT = 1000;
const MAX_DIMENSIONS_JSON = 2000;
/** `observed_package_count` is an integer column; anything wider would surface
 *  as a database error instead of as copy the driver can act on. */
const MAX_PACKAGES = 9999;

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

/** Range-checked so a malformed number reads as a location problem, not a state one. */
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
 * Optional free text, trimmed and bounded. Empty becomes null so the SQL's
 * "required" checks see absence rather than whitespace; `undefined` is the
 * single "too long" sentinel, which is the only case worth its own copy.
 */
function optionalText(value: unknown, limit: number): string | null | undefined {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > limit) return undefined;
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * POST — the shipment is in the vehicle (`at_pickup -> picked_up`).
 *
 * The heaviest-guarded transition in the driver flow, and every one of its
 * preconditions lives in SQL: the consumed pickup code, the two required
 * photos, the securement photo for a large load, and the absence of an open
 * discrepancy. This route's job is only to reject shapes the command would
 * have to translate into confusing copy.
 *
 * `confirmedVehicleId` is the vehicle the DRIVER says they are standing at; it
 * is compared against the assignment's vehicle in SQL and can only ever cause
 * a refusal. It never selects a vehicle.
 *
 * `driverAcknowledged` is read as a strict boolean rather than for truthiness —
 * the string "false" is truthy in JavaScript, and this flag is what stands
 * behind a driver's statement that they checked the load.
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

  // Read through `toNumber` for the same reason the coordinates are: 0 is a
  // LEGAL count, so a bare `Number(null)` would record "no packages" as the
  // driver's own observation when the field was simply never filled in.
  const observedPackageCount = toNumber(body?.observedPackageCount);
  if (
    observedPackageCount === null ||
    !Number.isInteger(observedPackageCount) ||
    observedPackageCount < 0 ||
    observedPackageCount > MAX_PACKAGES
  ) {
    return routeFailure("invalid_input", "Enter how many packages you are collecting.");
  }

  const staffFirstName =
    typeof body?.staffFirstName === "string" ? body.staffFirstName.trim() : "";
  if (staffFirstName.length === 0 || staffFirstName.length > MAX_NAME) {
    return routeFailure(
      "invalid_input",
      "Enter the first name of the person handing the shipment over."
    );
  }

  const confirmedVehicleId = String(body?.confirmedVehicleId ?? "");
  if (!UUID_RE.test(confirmedVehicleId)) {
    return routeFailure("invalid_input", "Confirm which vehicle you are loading.");
  }

  const at = coordinates(body);
  if (!at) {
    return routeFailure(
      "invalid_input",
      "Couranr needs your location for this step. Turn on location and try again."
    );
  }

  const loadingParticipants = optionalText(body?.loadingParticipants, MAX_TEXT);
  const loadingEquipment = optionalText(body?.loadingEquipment, MAX_TEXT);
  const existingDamage = optionalText(body?.existingDamage, MAX_TEXT);
  if (
    loadingParticipants === undefined ||
    loadingEquipment === undefined ||
    existingDamage === undefined
  ) {
    return routeFailure("invalid_input", `Keep each loading note under ${MAX_TEXT} characters.`);
  }

  // A measurement record, not a free-form container: bounded and never an
  // array, so nothing large or unexpected reaches a jsonb column.
  let dimensions: Record<string, unknown> | null = null;
  if (body?.dimensions !== null && body?.dimensions !== undefined) {
    if (typeof body.dimensions !== "object" || Array.isArray(body.dimensions)) {
      return routeFailure("invalid_input", "The measurements could not be read.");
    }
    if (JSON.stringify(body.dimensions).length > MAX_DIMENSIONS_JSON) {
      return routeFailure("invalid_input", "The measurements are too long.");
    }
    dimensions = body.dimensions as Record<string, unknown>;
  }

  const driverAcknowledged =
    body?.driverAcknowledged === true ? true : body?.driverAcknowledged === false ? false : null;

  const r = await completePickup({
    userId: auth.userId,
    deliveryId: params.id,
    expectedVersion,
    observedPackageCount,
    staffFirstName,
    confirmedVehicleId,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: at.accuracyM,
    dimensions,
    loadingParticipants,
    loadingEquipment,
    existingDamage,
    driverAcknowledged,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value });
}
