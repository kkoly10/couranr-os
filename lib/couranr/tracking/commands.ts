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
import { generateHandoffCode, handoffCodeDigest } from "@/lib/couranr/driver/codes";

assertServerOnly("lib/couranr/tracking/commands.ts");

/**
 * Named server commands for the customer tracking link.
 *
 * READ-ONLY EXCEPT ONE BOUNDED RECIPIENT ACTION. A recipient-audience token may
 * record the versioned adult attestation required by protected handoff. It can
 * never change a delivery state, address, payment, assignment, proof, price or
 * route. Redemption also stamps `last_used_at` on the token's own row.
 *
 * Every query is service-role and therefore bypasses RLS, so every query
 * re-scopes itself: the token resolves to exactly one request id and one
 * delivery id, and nothing here is ever fetched by anything else.
 */

export const RPC = {
  issueToken: "couranr_issue_delivery_access_token",
  claimConsumerRecipientDelivery: "couranr_claim_consumer_recipient_tracking_delivery",
  claimBusinessRecipientDelivery: "couranr_claim_business_recipient_tracking_delivery",
  markRecipientNotification: "couranr_mark_recipient_tracking_notification",
  markBusinessRecipientNotification: "couranr_mark_business_recipient_tracking_notification",
  failRecipientNotification: "couranr_fail_recipient_tracking_notification",
  attestRecipientAdult: "couranr_attest_recipient_adult",
  issueRecipientDropoffCode: "couranr_issue_recipient_dropoff_code",
  redeemToken: "couranr_redeem_delivery_access_token",
  revokeTokens: "couranr_revoke_delivery_access_tokens",
} as const;

export const COURANR_RECIPIENT_ATTESTATION_VERSION =
  "couranr-recipient-adult-attestation-2026-09";

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

export type ConsumerRecipientDeliveryClaim =
  | { outcome: "issued"; token: string; expiresAt: string }
  | { outcome: "sent" | "in_progress" };

/**
 * Claim the one recipient-email delivery attempt for a confirmed direct
 * consumer request. The database serializes claims on the request. A fresh
 * in-progress claim is never replaced; a crashed claim becomes replaceable
 * after its two-minute lease. The raw token exists only on the `issued` arm.
 */
export async function claimConsumerRecipientTrackingDelivery(params: {
  requestId: string;
}): Promise<TrackingResult<ConsumerRecipientDeliveryClaim>> {
  const op = "claimConsumerRecipientTrackingDelivery";
  const token = generateTrackingToken();
  const r = await callRpc<any[] | any>(op, RPC.claimConsumerRecipientDelivery, {
    p_request_id: params.requestId,
    p_token_hash: hashTrackingToken(token),
    p_ttl_days: TRACKING_TOKEN_TTL_DAYS,
  });
  if (isTrackingFailure(r)) return r;
  const row = Array.isArray(r.value) ? r.value[0] : r.value;
  if (row?.outcome === "sent" || row?.outcome === "in_progress") {
    return { ok: true, value: { outcome: row.outcome } };
  }
  if (row?.outcome !== "issued" || typeof row.expires_at !== "string") {
    return fail({ operation: op, code: "conflict", detail: { reason: "invalid claim result" } });
  }
  return {
    ok: true,
    value: { outcome: "issued", token, expiresAt: String(row.expires_at) },
  };
}

export type BusinessRecipientDeliveryClaim =
  | { outcome: "issued"; token: string; expiresAt: string }
  | { outcome: "sent" | "in_progress" | "existing_unclaimed" };

export async function claimBusinessRecipientTrackingDelivery(params: {
  requestId: string;
}): Promise<TrackingResult<BusinessRecipientDeliveryClaim>> {
  const op = "claimBusinessRecipientTrackingDelivery";
  const token = generateTrackingToken();
  const r = await callRpc<any[] | any>(op, RPC.claimBusinessRecipientDelivery, {
    p_request_id: params.requestId,
    p_token_hash: hashTrackingToken(token),
    p_ttl_days: TRACKING_TOKEN_TTL_DAYS,
  });
  if (isTrackingFailure(r)) return r;
  const row = Array.isArray(r.value) ? r.value[0] : r.value;
  if (row?.outcome === "sent" || row?.outcome === "in_progress" || row?.outcome === "existing_unclaimed") {
    return { ok: true, value: { outcome: row.outcome } };
  }
  if (row?.outcome !== "issued" || typeof row.expires_at !== "string") {
    return fail({ operation: op, code: "conflict", detail: { reason: "invalid claim result" } });
  }
  return { ok: true, value: { outcome: "issued", token, expiresAt: String(row.expires_at) } };
}

export async function markBusinessRecipientTrackingNotification(params: {
  rawToken: string;
  providerId: string;
}): Promise<TrackingResult<{ recorded: true }>> {
  const r = await callRpc("markBusinessRecipientTrackingNotification", RPC.markBusinessRecipientNotification, {
    p_token_hash: hashTrackingToken(params.rawToken),
    p_provider_id: params.providerId,
  });
  if (isTrackingFailure(r)) return r;
  return { ok: true, value: { recorded: true } };
}

export async function recipientTrackingNotificationState(params: {
  requestId: string;
}): Promise<TrackingResult<{ active: boolean; notifiedAt: string | null }>> {
  const op="recipientTrackingNotificationState";
  const { data,error }=(await supabaseAdmin
    .from("couranr_delivery_access_tokens")
    .select("expires_at,recipient_notified_at")
    .eq("request_id",params.requestId)
    .eq("audience","recipient")
    .is("revoked_at",null)
    .gt("expires_at",new Date().toISOString())
    .order("created_at",{ascending:false})
    .limit(1)) as {data:any[]|null;error:any};
  if(error) return fail({operation:op,code:classifyDatabaseError(error),detail:error});
  const row=data?.[0];
  return {ok:true,value:{active:Boolean(row),notifiedAt:row?.recipient_notified_at?String(row.recipient_notified_at):null}};
}

export async function markRecipientTrackingNotification(params: {
  rawToken: string;
  providerId: string;
}): Promise<TrackingResult<{ recorded: true }>> {
  const r = await callRpc(
    "markRecipientTrackingNotification",
    RPC.markRecipientNotification,
    {
      p_token_hash: hashTrackingToken(params.rawToken),
      p_provider_id: params.providerId,
    }
  );
  if (isTrackingFailure(r)) return r;
  return { ok: true, value: { recorded: true } };
}

/** Revoke exactly the token whose provider delivery did not complete. */
export async function failRecipientTrackingNotification(params: {
  rawToken: string;
  reason: string;
}): Promise<TrackingResult<{ revoked: boolean }>> {
  const r = await callRpc<boolean>(
    "failRecipientTrackingNotification",
    RPC.failRecipientNotification,
    {
      p_token_hash: hashTrackingToken(params.rawToken),
      p_reason: params.reason,
    }
  );
  if (isTrackingFailure(r)) return r;
  return { ok: true, value: { revoked: r.value === true } };
}

export async function attestRecipientAdult(params: {
  rawToken: string;
}): Promise<TrackingResult<{ attested: true }>> {
  const r = await callRpc("attestRecipientAdult", RPC.attestRecipientAdult, {
    p_token_hash: hashTrackingToken(params.rawToken),
    p_attestation_version: COURANR_RECIPIENT_ATTESTATION_VERSION,
    p_accept: true,
  });
  if (isTrackingFailure(r)) return r;
  return { ok: true, value: { attested: true } };
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
    .select(
      "id, request_state, readiness_state, protection_level, recipient_adult_attested_at, " +
        "consumer_contact_snapshot, dropoff_address"
    )
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
  let servicePlan: any = null;
  let assignmentActive = false;
  let proofs: any[] = [];
  let events: any[] = [];

  /* A recipient link can exist before capture creates the canonical delivery.
     In that window the confirmed plan is safe customer-facing truth. */
  if (!deliveryId) {
    const planQ = await supabaseAdmin
      .from("couranr_service_plans")
      .select("scheduled_pickup_start, scheduled_pickup_end, timezone")
      .eq("request_id", requestId)
      .eq("plan_state", "confirmed")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planQ.error) {
      return fail({ operation: op, code: classifyDatabaseError(planQ.error), detail: planQ.error });
    }
    servicePlan = planQ.data ?? null;
  }

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
    servicePlan,
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

/* ------------------------------------------ recipient drop-off credential --- */

/**
 * Mint the recipient's drop-off PIN into the recipient's own browser.
 *
 * THE RAW PIN IS RETURNED EXACTLY ONCE AND IS NEVER RECOVERABLE. It is not
 * stored, not logged, not put in analytics, and — the point of the whole
 * design — NEVER EMAILED. An emailed PIN is a PIN in the mailbox of anyone else
 * who can read that mailbox, which reduces it to precisely the assurance the
 * tracking link already carries. The link proves control of an address; the PIN
 * is meant to prove presence at the door.
 *
 * THE RETRY LOOP IS NOT DEFENSIVE PADDING. The generation is inside the signed
 * digest (`recipient:v1:<delivery>:<generation>:<code>`) so that regenerating a
 * code cannot yield the same digest for the same six digits. That means the
 * caller must hash BEFORE the database assigns the generation, so it proposes
 * one and the command refuses a stale proposal. A lost race is retried with the
 * fresh number; without this, the stored digest would be signed for generation
 * N against a row numbered N+1 and the recipient's PIN would never verify.
 *
 * Copied in shape from `issueGuestPickupCode` in consumer/send.ts, deliberately
 * — one idiom for handoff credentials, not two.
 */
export async function issueRecipientDropoffCode(params: {
  rawToken: string;
}): Promise<TrackingResult<{ code: string; generation: number; expiresAt: string }>> {
  const op = "issueRecipientDropoffCode";
  const tokenHash = hashTrackingToken(params.rawToken);

  /* Resolve the delivery through the TOKEN, never through anything the caller
     supplied. The command re-resolves it in SQL as well; this read exists only
     to number the generation, and a disagreement between the two is caught by
     the CAS rather than trusted. */
  const { data: token, error: tokenError } = (await supabaseAdmin
    .from("couranr_delivery_access_tokens")
    .select("request_id")
    .eq("token_hash", tokenHash)
    .eq("audience", "recipient")
    .limit(1)) as { data: any; error: any };
  if (tokenError) return fail({ operation: op, code: "internal", detail: tokenError.message });
  const requestId = token?.[0]?.request_id;
  if (!requestId) return fail({ operation: op, code: "not_found", detail: { reason: "token" } });

  const { data: delivery, error: deliveryError } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id")
    .eq("request_id", String(requestId))
    .limit(1)) as { data: any; error: any };
  if (deliveryError) return fail({ operation: op, code: "internal", detail: deliveryError.message });
  const deliveryId = delivery?.[0]?.id;
  if (!deliveryId) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "delivery_not_created" },
      message: "Your code will be available once Couranr schedules the delivery.",
    });
  }

  const MAX_GENERATION_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const { data: current, error: generationError } = (await supabaseAdmin
      .from("couranr_handoff_codes")
      .select("generation")
      .eq("delivery_id", String(deliveryId))
      .eq("code_kind", "recipient_dropoff")
      .order("generation", { ascending: false })
      .limit(1)) as { data: any; error: any };
    if (generationError) {
      return fail({ operation: op, code: "internal", detail: generationError.message });
    }

    const generation = Number(current?.[0]?.generation ?? 0) + 1;
    const code = generateHandoffCode();
    let digest: string;
    try {
      digest = handoffCodeDigest({
        kind: "recipient_dropoff",
        deliveryId: String(deliveryId),
        generation,
        code,
      });
    } catch {
      return fail({
        operation: op,
        code: "internal",
        detail: { reason: "handoff_secret_unavailable" },
      });
    }

    const { data, error } = (await supabaseAdmin.rpc(RPC.issueRecipientDropoffCode, {
      p_token_hash: tokenHash,
      p_expected_generation: generation,
      p_code_digest: digest,
      p_ttl_minutes: 720,
    })) as { data: any; error: any };

    if (error) {
      if (error.code === "CR409" && error.message === "handoff_generation_conflict") continue;
      return fail({
        operation: op,
        code: classifyDatabaseError(error),
        detail: { fn: RPC.issueRecipientDropoffCode, code: error.code, message: error.message },
      });
    }
    if (!data || Number(data.generation) !== generation) {
      return fail({
        operation: op,
        code: "internal",
        detail: { reason: "handoff_generation_mismatch" },
      });
    }

    return {
      ok: true,
      value: {
        code,
        generation,
        expiresAt: String(data.expires_at ?? ""),
      },
    };
  }
  return fail({ operation: op, code: "version_conflict", detail: { reason: "generation_exhausted" } });
}
