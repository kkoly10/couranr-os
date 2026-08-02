import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { finalizeProofUpload } from "@/lib/couranr/driver/proof";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_METADATA_JSON = 2000;

/**
 * A JSON number or a numeric string, and nothing else. `Number(null)` is 0, so
 * a bare coercion would record a device with no fix at the equator instead of
 * recording that it had no fix at all.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Optional coordinates: proof may be finalized without them, but a value that
 *  is present must be a real position rather than a placeholder. */
function coordinates(
  body: any
): { latitude: number | null; longitude: number | null; accuracyM: number | null } | null {
  const hasLat = body?.latitude !== null && body?.latitude !== undefined;
  const hasLng = body?.longitude !== null && body?.longitude !== undefined;
  // Half a position is not a position.
  if (hasLat !== hasLng) return null;

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (hasLat) {
    latitude = toNumber(body.latitude);
    longitude = toNumber(body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  }

  let accuracyM: number | null = null;
  if (body?.accuracyM !== null && body?.accuracyM !== undefined) {
    accuracyM = toNumber(body.accuracyM);
    if (!Number.isFinite(accuracyM) || accuracyM < 0) return null;
  }

  return { latitude, longitude, accuracyM };
}

/**
 * POST — record that an authorized upload actually arrived.
 *
 * The upload id is the whole subject: there is no delivery id, no path and no
 * byte count in this body, because at finalization STORAGE IS THE AUTHORITY.
 * The server lists the object, reads its real size and type, and compares them
 * against what the authorization committed to. A client reporting its own
 * intended size would confirm a file that is not there.
 *
 * The upload row was written before the signed URL existed, so an id the
 * caller did not receive from Couranr finalizes nothing.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const uploadId = String(body?.uploadId ?? "");
  if (!UUID_RE.test(uploadId)) {
    return routeFailure("invalid_input", "That upload is no longer valid.");
  }

  const at = coordinates(body);
  if (!at) {
    return routeFailure("invalid_input", "The reported location is not a valid position.");
  }

  let discrepancyId: string | null = null;
  if (body?.discrepancyId !== null && body?.discrepancyId !== undefined) {
    discrepancyId = String(body.discrepancyId);
    if (!UUID_RE.test(discrepancyId)) {
      return routeFailure("invalid_input", "That issue could not be found.");
    }
  }

  // Capture context only — never an assertion about the object, which the
  // server reads for itself.
  let metadata: Record<string, unknown> | null = null;
  if (body?.metadata !== null && body?.metadata !== undefined) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return routeFailure("invalid_input", "The capture details could not be read.");
    }
    if (JSON.stringify(body.metadata).length > MAX_METADATA_JSON) {
      return routeFailure("invalid_input", "The capture details are too long.");
    }
    metadata = body.metadata as Record<string, unknown>;
  }

  const r = await finalizeProofUpload({
    userId: auth.userId,
    uploadId,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: at.accuracyM,
    discrepancyId,
    metadata,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ proof: r.value });
}
