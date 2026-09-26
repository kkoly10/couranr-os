import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId, type PublicErrorCode } from "@/lib/couranr/errors";
import type { CommandFailure, CommandResult } from "@/lib/couranr/requests/commands";
import { isRouteRunId, type RouteDraftInput } from "./draft";

assertServerOnly("lib/couranr/routeRuns/commands.ts");

export type RouteDraftView = {
  routeRunId: string;
  businessAccountId: string;
  state: "draft";
  version: number;
  currentVersion: number;
  title: string;
  draftOnly: true;
  bookingAvailable: false;
  stopCount: number;
  referenceQuoteTotalCents: number;
  quoteBasis: "independent_delivery_quotes_not_a_route_offer";
  stops: Array<{
    sequence: number;
    requestId: string;
    quoteVersionId: string;
    requestVersion: number;
    pickupManifestVersion: number;
    stale: boolean;
  }>;
};

// Both the reason and public category are OUR constants. A database error is
// never a presentation model, including when it resembles a JavaScript key.
const REFUSALS: Record<string, { code: PublicErrorCode; message: string }> = {
  route_business_access_denied: { code: "not_permitted", message: "You do not have access to this business action." },
  route_draft_not_found: { code: "not_found", message: "Route draft not found." },
  route_draft_input_invalid: { code: "invalid_input", message: "Check the route draft details." },
  route_draft_stops_invalid: { code: "invalid_input", message: "Choose two to five different delivery drafts." },
  route_child_not_available: { code: "not_found", message: "A delivery draft is not available to this business." },
  route_child_not_eligible: { code: "conflict", message: "Use unsubmitted, merchant-paid, single-destination delivery drafts." },
  route_child_quote_required: { code: "conflict", message: "Calculate each delivery's quote before grouping it." },
  route_common_pickup_required: { code: "conflict", message: "Every delivery in this route must have the same pickup." },
  route_version_conflict: { code: "version_conflict", message: "This route draft changed. Reload before saving." },
  route_idempotency_conflict: { code: "conflict", message: "This save was already used for different route details. Reload before saving." },
  route_draft_limit_reached: { code: "conflict", message: "The route-draft limit for this business has been reached. Contact Couranr." },
  route_quote_total_out_of_range: { code: "invalid_input", message: "The combined reference quotes are outside the supported range." },
};

function failure(operation: string, reason?: unknown): CommandFailure {
  const known = typeof reason === "string" && Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : null;
  const correlationId = newCorrelationId();
  const code = known?.code ?? "internal";
  // Do not put tokens, free-form SQL error detail or private snapshots in logs.
  logServerFailure({ operation, correlationId, code, detail: { reason: known ? reason : "route_storage_unavailable" } });
  return { ok: false, correlationId, code,
    message: known?.message ?? "Couranr could not load or save this route draft." };
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max = 2147483647): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

/** Explicit safe response projection. Extra RPC fields never go to the client. */
export function decodeRouteDraft(value: unknown): RouteDraftView | null {
  if (!record(value) || !isRouteRunId(value.routeRunId) || !isRouteRunId(value.businessAccountId) ||
      value.state !== "draft" || value.draftOnly !== true || value.bookingAvailable !== false ||
      !integer(value.version, 1) || !integer(value.currentVersion, value.version) ||
      typeof value.title !== "string" || value.title.length < 1 || value.title.length > 100 ||
      !integer(value.stopCount, 2, 5) || !integer(value.referenceQuoteTotalCents, 0) ||
      value.quoteBasis !== "independent_delivery_quotes_not_a_route_offer" ||
      !Array.isArray(value.stops) || value.stops.length !== value.stopCount) return null;
  const stops: RouteDraftView["stops"] = [];
  for (const [index, stop] of value.stops.entries()) {
    if (!record(stop) || stop.sequence !== index + 1 || !isRouteRunId(stop.requestId) ||
        !isRouteRunId(stop.quoteVersionId) || !integer(stop.requestVersion, 1) ||
        !integer(stop.pickupManifestVersion, 0) || typeof stop.stale !== "boolean") return null;
    stops.push({ sequence: index + 1, requestId: stop.requestId, quoteVersionId: stop.quoteVersionId,
      requestVersion: stop.requestVersion, pickupManifestVersion: stop.pickupManifestVersion, stale: stop.stale });
  }
  if (new Set(stops.map((s) => s.requestId.toLowerCase())).size !== stops.length) return null;
  return { routeRunId: value.routeRunId, businessAccountId: value.businessAccountId, state: "draft",
    version: value.version, currentVersion: value.currentVersion, title: value.title,
    draftOnly: true, bookingAvailable: false, stopCount: value.stopCount,
    referenceQuoteTotalCents: value.referenceQuoteTotalCents,
    quoteBasis: "independent_delivery_quotes_not_a_route_offer", stops };
}

async function runDraftCommand(fn: string, args: Record<string, unknown>): Promise<CommandResult<RouteDraftView>> {
  try {
    const result = await supabaseAdmin.rpc(fn, args);
    if (result.error) return failure(fn, result.error.message);
    const value = decodeRouteDraft(result.data);
    // A malformed or incorrectly scoped success is a failure, never an empty draft.
    if (!value || value.routeRunId !== args.p_route_run_id || value.businessAccountId !== args.p_business_account_id) {
      return failure(fn);
    }
    return { ok: true, value };
  } catch {
    return failure(fn);
  }
}

export function readRouteDraft(params: { businessAccountId: string; actorUserId: string; routeRunId: string }) {
  return runDraftCommand("couranr_read_route_run_draft", {
    p_business_account_id: params.businessAccountId.toLowerCase(), p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId.toLowerCase(),
  });
}

export function saveRouteDraft(params: { businessAccountId: string; actorUserId: string; input: RouteDraftInput }) {
  const { input } = params;
  return runDraftCommand("couranr_save_route_run_draft", {
    p_business_account_id: params.businessAccountId.toLowerCase(), p_actor_user_id: params.actorUserId,
    p_route_run_id: input.routeRunId, p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey, p_title: input.title, p_request_ids: input.requestIds,
  });
}
