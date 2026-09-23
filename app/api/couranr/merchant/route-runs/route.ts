import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";
import { isRouteRunId, validateRouteDraft } from "@/lib/couranr/routeRuns/draft";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  route_business_access_denied: "You do not have access to this business action.",
  route_draft_not_found: "Route draft not found.",
  route_draft_input_invalid: "Check the route draft details.",
  route_draft_stops_invalid: "Choose two to five different delivery drafts.",
  route_child_not_available: "A delivery draft is not available to this business.",
  route_child_not_eligible: "Use unsubmitted, merchant-paid, single-destination delivery drafts.",
  route_child_quote_required: "Calculate each delivery's quote before grouping it.",
  route_common_pickup_required: "Every delivery in this route must have the same pickup.",
  route_version_conflict: "This route draft changed. Reload before saving.",
  route_idempotency_conflict: "This save was already used for different route details. Reload before saving.",
  route_draft_limit_reached: "The route-draft limit for this business has been reached. Contact Couranr.",
  route_quote_total_out_of_range: "The combined reference quotes are outside the supported range.",
};

function respond(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  if (result.error) {
    const message = MESSAGES[result.error.message ?? ""];
    if (message) {
      const code = result.error.code === "CR403" ? "not_permitted"
        : result.error.code === "CR404" ? "not_found"
        : result.error.code === "CR422" ? "invalid_input" : "conflict";
      return routeFailure(code, message);
    }
    // Never send a provider/database error (which may contain PII) to callers.
    return routeInternalFailure({ operation: "routeRunDraft", detail: { code: result.error.code },
      message: "Couranr could not load or save this route draft." });
  }
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !("draftOnly" in data) || data.draftOnly !== true ||
      !("bookingAvailable" in data) || data.bookingAvailable !== false) {
    return routeInternalFailure({ operation: "routeRunDraft.response", detail: "invalid_draft_response",
      message: "Couranr could not load or save this route draft." });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

/** Read only a merchant's current draft. No recipient/driver access. */
export async function GET(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  const route = req.nextUrl.searchParams.get("routeRunId");
  if (!isRouteRunId(business) || !isRouteRunId(route)) return routeFailure("invalid_input", "A business and route draft are required.");
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  return respond(await supabaseAdmin.rpc("couranr_read_route_run_draft", {
    p_business_account_id: business, p_actor_user_id: actor.userId, p_route_run_id: route,
  }));
}

/** Save an immutable draft revision. This is not a booking/dispatch endpoint.
 * SQL rechecks active membership and role, so an Operations profile without
 * membership cannot silently impersonate the business. */
export async function POST(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  if (!isRouteRunId(business)) return routeFailure("invalid_input", "A business is required.");
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  let raw: unknown;
  try {
    const body = await req.text();
    if (body.length > 4096) return routeFailure("invalid_input", "The route draft is too large.");
    raw = JSON.parse(body);
  } catch { return routeFailure("invalid_input", "Send route draft details as JSON."); }
  const parsed = validateRouteDraft(raw);
  if ("reason" in parsed) return routeFailure("invalid_input", "Use a title and two to five different delivery draft IDs. Do not include prices or delivery states.");
  const input = parsed.value;
  return respond(await supabaseAdmin.rpc("couranr_save_route_run_draft", {
    p_business_account_id: business, p_actor_user_id: actor.userId,
    p_route_run_id: input.routeRunId, p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey, p_title: input.title, p_request_ids: input.requestIds,
  }));
}
