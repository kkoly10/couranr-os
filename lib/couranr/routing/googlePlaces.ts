import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { claimPaidApiCall } from "@/lib/couranr/providers/paidApiGuard";
import {
  normalizeGooglePlaceSelection,
  type GoogleAddressSnapshot,
  type GooglePlaceLike,
  type GooglePlaceSelection,
} from "./address";

assertServerOnly("lib/couranr/routing/googlePlaces.ts");

const PLACE_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";
const PLACE_DETAILS_FIELD_MASK = "id,formattedAddress,addressComponents,location";

export type GooglePlaceResolutionReason =
  | "google_places_not_configured"
  | "google_places_unavailable"
  | "google_places_cost_guard"
  | "google_places_invalid_response"
  | "google_places_identity_mismatch";

export class GooglePlaceResolutionError extends Error {
  constructor(readonly reason: GooglePlaceResolutionReason) {
    super(reason);
    this.name = "GooglePlaceResolutionError";
  }
}

export function isGooglePlaceResolutionError(
  error: unknown
): error is GooglePlaceResolutionError {
  return error instanceof GooglePlaceResolutionError;
}

export type GoogleProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/**
 * Resolves the browser-selected Place ID into Couranr's canonical address.
 * Browser address components and coordinates never enter this function.
 */
export async function resolveCanonicalGooglePlace(
  selection: GooglePlaceSelection,
  fetchImpl: GoogleProviderFetch = fetch
): Promise<GoogleAddressSnapshot> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    throw new GooglePlaceResolutionError("google_places_not_configured");
  }

  const spend = await claimPaidApiCall("google_places_details", fetchImpl);
  if (!spend.allowed) {
    throw new GooglePlaceResolutionError("google_places_cost_guard");
  }

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(
      `${PLACE_DETAILS_BASE_URL}/${encodeURIComponent(selection.googlePlaceId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      }
    );
  } catch {
    throw new GooglePlaceResolutionError("google_places_unavailable");
  }

  if (!response.ok) {
    throw new GooglePlaceResolutionError("google_places_unavailable");
  }

  let payload: GooglePlaceLike;
  try {
    payload = (await response.json()) as GooglePlaceLike;
  } catch {
    throw new GooglePlaceResolutionError("google_places_invalid_response");
  }
  if (payload.id !== selection.googlePlaceId) {
    throw new GooglePlaceResolutionError("google_places_identity_mismatch");
  }

  const address = normalizeGooglePlaceSelection(payload, selection);
  if (!address) {
    throw new GooglePlaceResolutionError("google_places_invalid_response");
  }
  return address;
}

export const GOOGLE_PLACE_DETAILS_FIELD_MASK = PLACE_DETAILS_FIELD_MASK;
