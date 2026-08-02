import { NextRequest, NextResponse } from "next/server";
import { completeSignatureDelivery, isDriverFailure } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NAME = 200;

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
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  let accuracyM: number | null = null;
  if (body?.accuracyM !== null && body?.accuracyM !== undefined) {
    accuracyM = toNumber(body.accuracyM);
    if (!Number.isFinite(accuracyM) || accuracyM < 0) return null;
  }

  return { latitude, longitude, accuracyM };
}

/**
 * POST — signed for at the door (`at_dropoff -> delivered`).
 *
 * The signature IMAGE is not in this body. It is finalized beforehand as a
 * drop-off proof through the proof-upload routes, and the SQL refuses this
 * command with `signature_required` until that proof exists — so the evidence
 * cannot be asserted by the same request that claims the delivery is done.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const signerFirstName =
    typeof body?.signerFirstName === "string" ? body.signerFirstName.trim() : "";
  if (signerFirstName.length === 0 || signerFirstName.length > MAX_NAME) {
    return routeFailure("invalid_input", "Enter the signer's first name.");
  }

  const at = coordinates(body);
  if (!at) {
    return routeFailure(
      "invalid_input",
      "Couranr needs your location for this step. Turn on location and try again."
    );
  }

  const r = await completeSignatureDelivery({
    userId: auth.userId,
    deliveryId: params.id,
    expectedVersion,
    signerFirstName,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: at.accuracyM,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value.delivery, receipt: r.value.receipt });
}
