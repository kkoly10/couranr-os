import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId, type PublicErrorCode } from "@/lib/couranr/errors";
import type { CommandFailure, CommandResult } from "@/lib/couranr/requests/commands";
import { isRouteRunId, type RouteDraftInput } from "./draft";
import type { BusinessDeclaredValueView, RouteRunState, RouteRunView } from "./types";

assertServerOnly("lib/couranr/routeRuns/commands.ts");

export type { BusinessDeclaredValueView, RouteRunState, RouteRunView } from "./types";
/** Backward-compatible type name for RR-001 callers/tests. */
export type RouteDraftView = RouteRunView;

const REFUSALS: Record<string, { code: PublicErrorCode; message: string }> = {
  route_business_access_denied: { code: "not_permitted", message: "You do not have access to this business action." },
  route_draft_not_found: { code: "not_found", message: "Route not found." },
  route_draft_input_invalid: { code: "invalid_input", message: "Check the route draft details." },
  route_draft_stops_invalid: { code: "invalid_input", message: "Choose two to five different delivery drafts." },
  route_child_not_available: { code: "not_found", message: "A delivery draft is not available to this business." },
  route_child_not_eligible: { code: "conflict", message: "Use unsubmitted, merchant-paid, single-destination delivery drafts." },
  route_child_quote_required: { code: "conflict", message: "Calculate each delivery's estimate before grouping it." },
  route_child_quote_expired: { code: "conflict", message: "One or more delivery estimates expired. Recalculate before accepting the route." },
  route_child_stale: { code: "conflict", message: "A delivery changed after this route draft was saved. Refresh the route." },
  route_child_declared_value_required: { code: "conflict", message: "Every stop needs a declared shipment value before the route can be accepted." },
  route_child_restricted_class_not_supported: { code: "conflict", message: "Route Runs currently support only shipments declared as containing no restricted items." },
  route_child_service_level_not_supported: { code: "conflict", message: "Route Runs currently support Standard service only." },
  route_child_weight_not_supported: { code: "conflict", message: "Route Run V1 supports child packages up to 50 lb." },
  route_child_recipient_email_required: { code: "conflict", message: "Every Route Run stop needs a recipient email." },
  route_child_pickup_manifest_required: { code: "conflict", message: "Every stop needs a confirmed pickup description before the Route Run can be accepted." },
  route_common_timing_required: { code: "conflict", message: "Every stop in a Route Run must use the same pickup timing." },
  route_declared_value_exceeded: { code: "conflict", message: "The combined declared value for this Route Run is above the launch limit." },
  declared_value_invalid: { code: "invalid_input", message: "Enter a declared shipment value from $0 through $500." },
  route_child_version_conflict: { code: "version_conflict", message: "That delivery changed. Reload before saving its declared value." },
  route_child_already_claimed: { code: "conflict", message: "A delivery is already committed to another accepted Route Run." },
  route_child_claimed: { code: "conflict", message: "This delivery belongs to an accepted Route Run and cannot be changed independently." },
  route_common_pickup_required: { code: "conflict", message: "Every delivery in this route must have the same pickup." },
  route_version_conflict: { code: "version_conflict", message: "This route changed. Reload before saving." },
  route_idempotency_conflict: { code: "conflict", message: "This save was already used for different route details. Reload before saving." },
  route_draft_limit_reached: { code: "conflict", message: "The route-draft limit for this business has been reached. Archive old drafts first." },
  route_quote_total_out_of_range: { code: "invalid_input", message: "The combined reference estimates are outside the supported range." },
  route_not_editable: { code: "conflict", message: "This route is no longer editable." },
  route_already_accepted: { code: "conflict", message: "This route has already been accepted." },
  route_already_abandoned: { code: "conflict", message: "This route has already been archived." },
  route_accept_input_invalid: { code: "invalid_input", message: "The route acceptance request is invalid." },
  route_abandon_input_invalid: { code: "invalid_input", message: "The route archive request is invalid." },
};

function failure(operation: string, reason?: unknown): CommandFailure {
  const known = typeof reason === "string" && Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : null;
  const correlationId = newCorrelationId();
  const code = known?.code ?? "internal";
  logServerFailure({ operation, correlationId, code, detail: { reason: known ? reason : "route_storage_unavailable" } });
  return {
    ok: false,
    correlationId,
    code,
    message: known?.message ?? "Couranr could not load or save this route.",
  };
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max = 2147483647): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const nullableString = (v: unknown): v is string | null => v === null || typeof v === "string";
const state = (v: unknown): v is RouteRunState => v === "draft" || v === "accepted" || v === "abandoned";
/** Explicit safe response projection. Extra RPC fields never reach a browser. */
export function decodeRouteDraft(value: unknown): RouteRunView | null {
  if (
    !record(value) ||
    !isRouteRunId(value.routeRunId) ||
    !isRouteRunId(value.businessAccountId) ||
    !state(value.state) ||
    typeof value.draftOnly !== "boolean" ||
    value.bookingAvailable !== false ||
    value.executionAvailable !== false ||
    !integer(value.version, 1) ||
    !integer(value.currentVersion, value.version) ||
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 100 ||
    !integer(value.stopCount, 2, 5) ||
    !integer(value.referenceQuoteTotalCents, 0) ||
    value.quoteBasis !== "independent_delivery_quotes_not_a_route_offer" ||
    !nullableString(value.acceptedAt) ||
    !nullableString(value.abandonedAt) ||
    !Array.isArray(value.stops) ||
    value.stops.length !== value.stopCount
  ) {
    return null;
  }
  const acceptedVersion =
    value.acceptedVersion === null ? null : integer(value.acceptedVersion, 1) ? value.acceptedVersion : undefined;
  if (acceptedVersion === undefined) return null;
  if (value.state === "draft" && (value.draftOnly !== true || acceptedVersion !== null || value.acceptedAt !== null || value.abandonedAt !== null)) return null;
  if (value.state === "accepted" && (value.draftOnly !== false || acceptedVersion === null || value.acceptedAt === null || value.abandonedAt !== null)) return null;
  if (value.state === "abandoned" && (value.draftOnly !== false || acceptedVersion !== null || value.acceptedAt !== null || value.abandonedAt === null)) return null;

  const stops: RouteRunView["stops"] = [];
  for (const [index, stop] of value.stops.entries()) {
    if (
      !record(stop) ||
      stop.sequence !== index + 1 ||
      !isRouteRunId(stop.requestId) ||
      !isRouteRunId(stop.quoteVersionId) ||
      !integer(stop.requestVersion, 1) ||
      !integer(stop.pickupManifestVersion, 0) ||
      typeof stop.stale !== "boolean" ||
      typeof stop.claimed !== "boolean"
    ) {
      return null;
    }
    stops.push({
      sequence: index + 1,
      requestId: stop.requestId,
      quoteVersionId: stop.quoteVersionId,
      requestVersion: stop.requestVersion,
      pickupManifestVersion: stop.pickupManifestVersion,
      stale: stop.stale,
      claimed: stop.claimed,
    });
  }
  if (new Set(stops.map((s) => s.requestId.toLowerCase())).size !== stops.length) return null;
  if (value.state === "accepted" && stops.some((s) => !s.claimed)) return null;

  return {
    routeRunId: value.routeRunId,
    businessAccountId: value.businessAccountId,
    state: value.state,
    version: value.version,
    currentVersion: value.currentVersion,
    title: value.title,
    draftOnly: value.draftOnly,
    bookingAvailable: false,
    executionAvailable: false,
    stopCount: value.stopCount,
    referenceQuoteTotalCents: value.referenceQuoteTotalCents,
    quoteBasis: "independent_delivery_quotes_not_a_route_offer",
    acceptedVersion,
    acceptedAt: value.acceptedAt,
    abandonedAt: value.abandonedAt,
    stops,
  };
}

async function runRouteCommand(
  fn: string,
  args: Record<string, unknown>,
  routeRunId: string,
  businessAccountId: string,
): Promise<CommandResult<RouteRunView>> {
  try {
    const result = await supabaseAdmin.rpc(fn, args);
    if (result.error) return failure(fn, result.error.message);
    const value = decodeRouteDraft(result.data);
    if (
      !value ||
      value.routeRunId !== routeRunId.toLowerCase() ||
      value.businessAccountId !== businessAccountId.toLowerCase()
    ) {
      return failure(fn);
    }
    return { ok: true, value };
  } catch {
    return failure(fn);
  }
}

export function readRouteDraft(params: { businessAccountId: string; actorUserId: string; routeRunId: string }) {
  return runRouteCommand(
    "couranr_read_route_run_draft",
    {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
      p_route_run_id: params.routeRunId.toLowerCase(),
    },
    params.routeRunId,
    params.businessAccountId,
  );
}

export function saveRouteDraft(params: { businessAccountId: string; actorUserId: string; input: RouteDraftInput }) {
  const { input } = params;
  return runRouteCommand(
    "couranr_save_route_run_draft",
    {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
      p_route_run_id: input.routeRunId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_title: input.title,
      p_request_ids: input.requestIds,
    },
    input.routeRunId,
    params.businessAccountId,
  );
}

export function acceptRouteRun(params: {
  businessAccountId: string;
  actorUserId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  return runRouteCommand(
    "couranr_accept_route_run",
    {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
      p_route_run_id: params.routeRunId.toLowerCase(),
      p_expected_version: params.expectedVersion,
      p_idempotency_key: params.idempotencyKey.toLowerCase(),
    },
    params.routeRunId,
    params.businessAccountId,
  );
}

export function abandonRouteRun(params: {
  businessAccountId: string;
  actorUserId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  return runRouteCommand(
    "couranr_abandon_route_run_draft",
    {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
      p_route_run_id: params.routeRunId.toLowerCase(),
      p_expected_version: params.expectedVersion,
      p_idempotency_key: params.idempotencyKey.toLowerCase(),
    },
    params.routeRunId,
    params.businessAccountId,
  );
}
export async function listRouteRuns(params: {
  businessAccountId: string;
  actorUserId: string;
}): Promise<CommandResult<RouteRunView[]>> {
  const fn = "couranr_list_route_runs";
  try {
    const result = await supabaseAdmin.rpc(fn, {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
    });
    if (result.error) return failure(fn, result.error.message);
    if (!Array.isArray(result.data)) return failure(fn);
    const rows: RouteRunView[] = [];
    for (const raw of result.data) {
      const row = decodeRouteDraft(raw);
      if (!row || row.businessAccountId !== params.businessAccountId.toLowerCase()) return failure(fn);
      rows.push(row);
    }
    return { ok: true, value: rows };
  } catch {
    return failure(fn);
  }
}

export async function recordBusinessDeclaredValue(params: {
  businessAccountId: string;
  actorUserId: string;
  requestId: string;
  expectedVersion: number;
  declaredValueCents: number;
}): Promise<CommandResult<BusinessDeclaredValueView>> {
  const fn = "couranr_record_business_declared_value";
  try {
    const result = await supabaseAdmin.rpc(fn, {
      p_business_account_id: params.businessAccountId.toLowerCase(),
      p_actor_user_id: params.actorUserId,
      p_request_id: params.requestId.toLowerCase(),
      p_expected_version: params.expectedVersion,
      p_declared_value_cents: params.declaredValueCents,
    });
    if (result.error) return failure(fn, result.error.message);
    const value = result.data;
    if (
      !record(value) ||
      value.requestId !== params.requestId.toLowerCase() ||
      !integer(value.version, 1) ||
      !integer(value.declaredValueCents, 0, 50_000) ||
      !["standard", "secure_pickup", "protected_handoff"].includes(String(value.protectionLevel))
    ) {
      return failure(fn);
    }
    return {
      ok: true,
      value: {
        requestId: value.requestId,
        version: value.version,
        declaredValueCents: value.declaredValueCents,
        protectionLevel: value.protectionLevel as BusinessDeclaredValueView["protectionLevel"],
      },
    };
  } catch {
    return failure(fn);
  }
}
