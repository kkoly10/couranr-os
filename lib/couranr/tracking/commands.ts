import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { buildTrackingProjection, type TrackingProjection } from "./projection";
import { isTrackingRefusal, type TrackingRefusal } from "./states";
import { generateTrackingToken, hashTrackingToken, TRACKING_TOKEN_TTL_DAYS } from "./tokens";

assertServerOnly("lib/couranr/tracking/commands.ts");

/**
 * Named server commands for the customer tracking link.
 *
 * READ-ONLY BY CONSTRUCTION. There is exactly one mutation reachable from a
 * customer-held token — the `last_used_at` stamp that
 * `couranr_redeem_delivery_access_token` writes on the token's own row. No
 * function in this module changes a delivery, a request, a payment, an
 * assignment or a proof, and `tests/couranr-tracking.test.ts` asserts the
 * absence of the strings that would.
 *
 * Every query is service-role and therefore bypasses RLS, so every query
 * re-scopes itself: the token resolves to exactly one request id and one
 * delivery id, and nothing here is ever fetched by anything else.
 */

export const RPC = {
  issueToken: "couranr_issue_delivery_access_token",
  redeemToken: "couranr_redeem_delivery_access_token",
  revokeTokens: "couranr_revoke_delivery_access_tokens",
} as const;

export type TrackingFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type TrackingResult<T> = { ok: true; value: T } | TrackingFailure;

/** `tsconfig` has `strict: false`, so `.ok` does not narrow without this. */
export function isTrackingFailure(r: { ok: boolean }): r is TrackingFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): TrackingFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: TrackingFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<TrackingResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  return { ok: true, value: data as T };
}

/* ------------------------------------------------------------ issue --- */

/**
 * Issue the tracking link for a confirmed request.
 *
 * Returns the RAW token exactly once. It is never stored, never logged and
 * never recoverable — the caller puts it in a URL and that is the end of it.
 * The database gets a SHA-256 hash and a CHECK that refuses anything else.
 *
 * NO ACTOR CHECK HERE, deliberately: this is called by the server paths that
 * have ALREADY established who is acting — Couranr Operations confirming a
 * request, or the confirmation notification being sent — and those callers own
 * the permission decision. It is not reachable from any customer-held token,
 * because nothing a customer can call imports it.
 */
export async function issueTrackingLink(params: {
  requestId: string;
}): Promise<TrackingResult<{ token: string; expiresAt: string }>> {
  const op = "issueTrackingLink";
  const token = generateTrackingToken();

  const r = await callRpc<any>(op, RPC.issueToken, {
    p_request_id: params.requestId,
    p_token_hash: hashTrackingToken(token),
    p_ttl_days: TRACKING_TOKEN_TTL_DAYS,
  });
  if (isTrackingFailure(r)) return r;
  if (!r.value) {
    return fail({ operation: op, code: "conflict", detail: { reason: "no row returned" } });
  }

  // The only moment the raw token exists outside the customer's URL.
  return { ok: true, value: { token, expiresAt: String(r.value.expires_at) } };
}

/* ----------------------------------------------------------- revoke --- */

export async function revokeTrackingLinks(params: {
  requestId: string;
  reason: string;
}): Promise<TrackingResult<{ revoked: number }>> {
  const op = "revokeTrackingLinks";
  const r = await callRpc<number>(op, RPC.revokeTokens, {
    p_request_id: params.requestId,
    p_reason: params.reason,
  });
  if (isTrackingFailure(r)) return r;
  return { ok: true, value: { revoked: Number(r.value ?? 0) } };
}

/* ----------------------------------------------------------- redeem --- */

export type RedeemedTrackingLink = {
  valid: boolean;
  reason: TrackingRefusal | null;
  request_id: string | null;
  delivery_id: string | null;
  business_account_id: string | null;
  request_state: string | null;
};

/** Resolves a raw token. The raw value never leaves this function. */
export async function redeemTrackingLink(params: {
  rawToken: string;
}): Promise<TrackingResult<RedeemedTrackingLink>> {
  const op = "redeemTrackingLink";
  const r = await callRpc<RedeemedTrackingLink[] | RedeemedTrackingLink>(op, RPC.redeemToken, {
    p_token_hash: hashTrackingToken(params.rawToken),
  });
  if (isTrackingFailure(r)) return r;

  // A `returns table` function comes back as an array through PostgREST.
  const row = Array.isArray(r.value) ? r.value[0] : r.value;
  if (!row) {
    return {
      ok: true,
      value: {
        valid: false,
        reason: "not_found",
        request_id: null,
        delivery_id: null,
        business_account_id: null,
        request_state: null,
      },
    };
  }
  const reason = isTrackingRefusal(row.reason) ? row.reason : null;
  return { ok: true, value: { ...row, reason } };
}

/* ------------------------------------------------------------- view --- */

export type TrackingView =
  | { resolved: false; reason: TrackingRefusal }
  | { resolved: true; projection: TrackingProjection };

/**
 * The whole customer read, in one call: redeem, then load exactly the rows the
 * projection needs and nothing else.
 *
 * A REFUSAL IS ALWAYS `not_found`, whatever the SQL said. The SQL distinguishes
 * `revoked` from `expired` from `not_found` because the operator log should be
 * able to; the CALLER never learns which, because PHO-001's acceptance
 * criterion is that an unauthorized caller receives the same response as for a
 * missing delivery, and "expired" would confirm that a delivery exists.
 *
 * Every select below names its columns. `select("*")` would hand the projection
 * a row containing the payment obligation id and the pricing policy version and
 * leave the allow-list as the only thing standing between them and a URL that
 * forwards; naming the columns means the sensitive ones are never read into the
 * process at all.
 */
export async function loadTrackingView(params: {
  rawToken: string;
}): Promise<TrackingResult<TrackingView>> {
  const op = "loadTrackingView";

  const redeemed = await redeemTrackingLink({ rawToken: params.rawToken });
  if (isTrackingFailure(redeemed)) return redeemed;
  if (!redeemed.value.valid || !redeemed.value.request_id) {
    return { ok: true, value: { resolved: false, reason: "not_found" } };
  }

  const requestId = redeemed.value.request_id;
  const deliveryId = redeemed.value.delivery_id;
  const businessAccountId = redeemed.value.business_account_id;

  const reqQ = await supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id, request_state, readiness_state")
    .eq("id", requestId)
    .maybeSingle();
  if (reqQ.error) {
    return fail({ operation: op, code: classifyDatabaseError(reqQ.error), detail: reqQ.error });
  }
  if (!reqQ.data) {
    // The token resolved a moment ago; the request is gone now. Same answer.
    return { ok: true, value: { resolved: false, reason: "not_found" } };
  }

  const bizQ = businessAccountId
    ? await supabaseAdmin
        .from("business_accounts")
        .select("id, name")
        .eq("id", businessAccountId)
        .maybeSingle()
    : { data: null, error: null };
  if (bizQ.error) {
    return fail({ operation: op, code: classifyDatabaseError(bizQ.error), detail: bizQ.error });
  }

  let delivery: any = null;
  let assignmentActive = false;
  let proofs: any[] = [];
  let events: any[] = [];

  if (deliveryId) {
    const dlvQ = await supabaseAdmin
      .from("couranr_deliveries")
      .select(
        "id, fulfillment_state, service_level, signature_required, proof_method, " +
          "scheduled_pickup_start, scheduled_pickup_end, timezone, dropoff_address"
      )
      .eq("id", deliveryId)
      .maybeSingle();
    if (dlvQ.error) {
      return fail({ operation: op, code: classifyDatabaseError(dlvQ.error), detail: dlvQ.error });
    }
    delivery = dlvQ.data ?? null;

    // The COUNT of active assignments, never the driver. `head: true` means the
    // driver row is not read into this process at all.
    const asgQ = await supabaseAdmin
      .from("couranr_delivery_assignments")
      .select("id", { count: "exact", head: true })
      .eq("delivery_id", deliveryId)
      .eq("assignment_state", "active");
    if (asgQ.error) {
      return fail({ operation: op, code: classifyDatabaseError(asgQ.error), detail: asgQ.error });
    }
    assignmentActive = (asgQ.count ?? 0) > 0;

    // Dropoff proof only, filtered in SQL as well as in the projection. Two
    // filters for one rule is deliberate: the projection's is what a unit test
    // can prove, and this one is what keeps pickup evidence out of the process.
    const proofQ = await supabaseAdmin
      .from("couranr_delivery_proofs")
      .select("id, proof_stage, proof_type, storage_object_path, finalized_at, created_at")
      .eq("delivery_id", deliveryId)
      .eq("proof_stage", "dropoff")
      .order("finalized_at", { ascending: true });
    if (proofQ.error) {
      return fail({ operation: op, code: classifyDatabaseError(proofQ.error), detail: proofQ.error });
    }
    proofs = proofQ.data ?? [];

    // `to_state` and `created_at` only — not the actor, the command or the
    // metadata blob.
    const evQ = await supabaseAdmin
      .from("couranr_delivery_events")
      .select("to_state, created_at")
      .eq("delivery_id", deliveryId)
      .order("created_at", { ascending: true });
    if (evQ.error) {
      return fail({ operation: op, code: classifyDatabaseError(evQ.error), detail: evQ.error });
    }
    events = evQ.data ?? [];
  }

  const projection = buildTrackingProjection({
    request: reqQ.data,
    delivery,
    business: bizQ.data,
    assignmentActive,
    proofs,
    events,
  });

  return { ok: true, value: { resolved: true, projection } };
}

/**
 * Confirm that a proof id belongs to THIS token's delivery and is one a
 * recipient may see.
 *
 * The proof-URL endpoint needs this before it mints anything: a proof id is a
 * uuid, and a uuid a customer holds from one delivery's page must not resolve
 * against another's. `signedProofUrl` deliberately does NO scoping — it looks
 * a proof up by id and signs it — so the authorization has to happen here or
 * it does not happen at all.
 *
 * Returns the proof id back, not the storage reference. The bucket and the
 * object path never leave this module: the caller passes the id to the
 * centralized minting function, which is the one place that knows the TTL
 * policy, so there is no second implementation of "sign a proof object" and
 * no path in a response body.
 */
export async function authorizeProofForToken(params: {
  rawToken: string;
  proofId: string;
}): Promise<TrackingResult<{ proofId: string } | null>> {
  const op = "authorizeProofForToken";

  const redeemed = await redeemTrackingLink({ rawToken: params.rawToken });
  if (isTrackingFailure(redeemed)) return redeemed;
  if (!redeemed.value.valid || !redeemed.value.delivery_id) {
    return { ok: true, value: null };
  }

  const q = await supabaseAdmin
    .from("couranr_delivery_proofs")
    .select("id, storage_object_path")
    .eq("id", params.proofId)
    // The scope. Both filters are load-bearing: the delivery is what the token
    // authorizes, and `dropoff` is what a recipient may see of it.
    .eq("delivery_id", redeemed.value.delivery_id)
    .eq("proof_stage", "dropoff")
    .maybeSingle();
  if (q.error) {
    return fail({ operation: op, code: classifyDatabaseError(q.error), detail: q.error });
  }
  // A recipient PIN record is proof with nothing to look at. Not an error and
  // not authorized either — there is no object to sign.
  if (!q.data?.storage_object_path) return { ok: true, value: null };

  return { ok: true, value: { proofId: String(q.data.id) } };
}
