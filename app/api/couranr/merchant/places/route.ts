import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, requireBusinessCapability, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";
import { claimPaidApiCall } from "@/lib/couranr/providers/paidApiGuard";
import {
  isGooglePlaceResolutionError,
  resolveCanonicalGooglePlace,
} from "@/lib/couranr/routing/googlePlaces";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

async function authorize(req: NextRequest, businessAccountId: string) {
  if (!UUID_RE.test(businessAccountId)) {
    return { response: routeFailure("invalid_input", "A business account is required.") } as const;
  }
  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) {
    return { response: routeFailure(resolved.code, resolved.error) } as const;
  }
  // Must be a member of THIS business with delivery-creation authority. The
  // address lookup exists only to draft a delivery (DRP-001 create roles:
  // owner/manager/dispatcher), and it spends against a shared paid Google
  // budget, so a non-member — or a viewer/billing member — must be refused
  // here, BEFORE any claimPaidApiCall / Google fetch. `create` is intentional:
  // Operations uses its own routes and does not call merchant/places.
  const denied = requireBusinessCapability(resolved.actor, "create", businessAccountId);
  if (denied) {
    return { response: routeFailure(denied.code, denied.error) } as const;
  }
  return { actor: resolved.actor } as const;
}

/**
 * Business Places lookup for MER-005.
 *
 * The browser receives suggestion text and a Place ID only. Selecting a result
 * POSTs the Place ID back here; Place Details (New) resolves the canonical
 * address server-side. Browser-provided coordinates/components never become
 * route or pricing authority.
 */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  const auth = await authorize(req, businessAccountId);
  if ("response" in auth) return auth.response;

  const query = (req.nextUrl.searchParams.get("query") ?? "").trim();
  if (query.length < 3 || query.length > 120) {
    return NextResponse.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return routeInternalFailure({
      operation: "merchantPlaces:autocomplete",
      detail: { reason: "google_maps_server_key_missing" },
      message: "Address lookup is unavailable right now.",
    });
  }

  const spend = await claimPaidApiCall("google_places_autocomplete");
  if (!spend.allowed) {
    return NextResponse.json({ suggestions: [] });
  }

  let response: Response;
  try {
    response = await fetch(PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({ input: query, includedRegionCodes: ["US"] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    return routeInternalFailure({
      operation: "merchantPlaces:autocomplete",
      detail: error,
      message: "Address lookup is unavailable right now.",
    });
  }

  if (!response.ok) {
    return routeInternalFailure({
      operation: "merchantPlaces:autocomplete",
      detail: { status: response.status },
      message: "Address lookup is unavailable right now.",
    });
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (error) {
    return routeInternalFailure({
      operation: "merchantPlaces:autocomplete",
      detail: error,
      message: "Address lookup is unavailable right now.",
    });
  }

  const suggestions = (Array.isArray(payload?.suggestions) ? payload.suggestions : [])
    .slice(0, 5)
    .flatMap((item: any) => {
      const placeId = item?.placePrediction?.placeId;
      const text = item?.placePrediction?.text?.text;
      return typeof placeId === "string" && placeId && typeof text === "string" && text
        ? [{ placeId, text }]
        : [];
    });

  return NextResponse.json({ suggestions });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  const auth = await authorize(req, businessAccountId);
  if ("response" in auth) return auth.response;

  const placeId = typeof body?.placeId === "string" ? body.placeId.trim() : "";
  if (!placeId || placeId.length > 300) {
    return routeFailure("invalid_input", "Choose an address from the suggestions.");
  }

  const optional = (value: unknown) => {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text ? text : null;
  };

  try {
    const address = await resolveCanonicalGooglePlace({
      googlePlaceId: placeId,
      line2: optional(body?.line2),
      instructions: optional(body?.instructions),
    });
    return NextResponse.json({ address });
  } catch (error) {
    if (isGooglePlaceResolutionError(error)) {
      if (error.reason === "google_places_invalid_response" || error.reason === "google_places_identity_mismatch") {
        return routeFailure("invalid_input", "Choose a complete street address from the suggestions.");
      }
      return routeInternalFailure({
        operation: "merchantPlaces:resolve",
        detail: { reason: error.reason },
        message: "Address lookup is unavailable right now.",
      });
    }
    return routeInternalFailure({
      operation: "merchantPlaces:resolve",
      detail: error,
      message: "Address lookup is unavailable right now.",
    });
  }
}
