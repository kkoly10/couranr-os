import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { ActorMembership } from "@/lib/couranr/settings/commands";
import {
  ACKNOWLEDGEMENT_KINDS,
  ACKNOWLEDGEMENT_VERSIONS,
  activationRequirements,
  blockReasonMessage,
  canRequestActivation,
  type AcknowledgementKind,
} from "@/lib/couranr/activation/states";

assertServerOnly("lib/couranr/activation/commands.ts");

/**
 * MER-003 command layer.
 *
 * The acknowledgement VERSIONS are read from the governed module here and
 * passed to the SQL — never accepted from a request body. A merchant cannot
 * claim to have accepted a version they were not shown, and the database
 * re-checks the same versions inside `couranr_request_activation`, so the two
 * cannot drift into a gate that passes on a document nobody read.
 */

export type ActivationFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type ActivationResult<T> = { ok: true; value: T } | ActivationFailure;

export function isActivationFailure(r: { ok: boolean }): r is ActivationFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): ActivationFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: ActivationFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<ActivationResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

export type ActivationView = {
  businessAccountId: string;
  state: string;
  /** Merchant-safe copy derived from a code. The code itself never ships. */
  blockedReason: string | null;
  contactVerifiedAt: string | null;
  contactVerificationRequestedAt: string | null;
  operationsContactPhone: string | null;
  testDeliveryRequestId: string | null;
  requestedAt: string | null;
  acknowledgements: Record<string, string>;
  requirements: { id: string; label: string; met: boolean; detail: string }[];
  canRequest: boolean;
  /** The versions currently being collected, so the UI records what it showed. */
  currentVersions: Record<string, string>;
};

/**
 * Read the activation state.
 *
 * The activation row may not exist — every workspace created before MER-003
 * has none — and its absence means `not_started`, not an error. The SQL
 * creates it on first WRITE; this read does not, so opening the page is not a
 * mutation.
 */
export async function getActivation(params: {
  businessAccountId: string;
}): Promise<ActivationResult<ActivationView>> {
  const op = "getActivation";

  const row = await supabaseAdmin
    .from("couranr_workspace_activations")
    .select(
      "activation_state,blocked_reason_code,contact_verified_at,contact_verification_requested_at,test_delivery_request_id,requested_at"
    )
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();

  if (row.error) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_workspace_activations", error: row.error },
    });
  }

  const acks = await supabaseAdmin
    .from("couranr_activation_acknowledgements")
    .select("ack_kind,ack_version,accepted_at")
    .eq("business_account_id", params.businessAccountId)
    .order("accepted_at", { ascending: false });

  if (acks.error || !Array.isArray(acks.data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_activation_acknowledgements" },
    });
  }

  const workspace = await supabaseAdmin
    .from("couranr_merchant_workspaces")
    .select("contact_phone")
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();

  if (workspace.error) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_merchant_workspaces", error: workspace.error },
    });
  }

  // Newest acceptance per kind wins; the query is already newest-first.
  const accepted: Record<string, string> = {};
  for (const a of acks.data as any[]) {
    if (!(a.ack_kind in accepted)) accepted[String(a.ack_kind)] = String(a.ack_version);
  }

  const facts = {
    state: row.data ? String(row.data.activation_state) : "not_started",
    acknowledgements: accepted,
    contactVerifiedAt: row.data?.contact_verified_at ?? null,
    testDeliveryRequestId: row.data?.test_delivery_request_id ?? null,
  };

  return {
    ok: true,
    value: {
      businessAccountId: params.businessAccountId,
      state: facts.state,
      // A CODE is stored; the merchant reads a derived sentence. An operator's
      // internal note is never what a merchant sees.
      blockedReason:
        facts.state === "blocked" ? blockReasonMessage(row.data?.blocked_reason_code) : null,
      contactVerifiedAt: facts.contactVerifiedAt,
      contactVerificationRequestedAt: row.data?.contact_verification_requested_at ?? null,
      operationsContactPhone: workspace.data?.contact_phone ?? null,
      testDeliveryRequestId: facts.testDeliveryRequestId,
      requestedAt: row.data?.requested_at ?? null,
      acknowledgements: accepted,
      requirements: activationRequirements(facts),
      canRequest: canRequestActivation(facts),
      currentVersions: { ...ACKNOWLEDGEMENT_VERSIONS },
    },
  };
}

/** One workspace as Couranr Operations sees it in the review list. */
export type ActivationQueueEntry = {
  businessAccountId: string;
  businessName: string;
  state: string;
  requestedAt: string | null;
  contactVerificationRequestedAt: string | null;
  contactVerifiedAt: string | null;
  blockedReason: string | null;
  reviewedAt: string | null;
};

/** One accepted document, with WHO accepted it. */
export type AcknowledgementRecord = {
  kind: string;
  version: string;
  acceptedAt: string;
  acceptedByUserId: string;
  acceptedByEmail: string | null;
  /** False when the merchant accepted a version Couranr no longer collects. */
  isCurrent: boolean;
};

/**
 * Every workspace Couranr Operations has activation work on.
 *
 * THIS EXISTS BECAUSE THE DECIDE ROUTE WAS WRITE-ONLY. An operator could
 * grant or block a workspace but had no way to READ one — not the checklist,
 * not the acknowledgements, not who accepted them — so the decision was made
 * blind and there was no way to find a workspace awaiting review in the first
 * place. Caught reviewing MER-003 rather than by any test, because a
 * write-only surface is perfectly consistent with itself.
 *
 * `pending_couranr_review` first: that is the queue. The rest are readable so
 * a blocked workspace can be revisited and a live one audited.
 */
export async function listActivationsForOperations(params: {
  state?: string;
  contactVerificationPending?: boolean;
}): Promise<ActivationResult<{ entries: ActivationQueueEntry[] }>> {
  const op = "listActivationsForOperations";

  let query = supabaseAdmin
    .from("couranr_workspace_activations")
    .select(
      "business_account_id,activation_state,blocked_reason_code,requested_at,reviewed_at,contact_verification_requested_at,contact_verified_at"
    )
    .order("requested_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (params.state) query = query.eq("activation_state", params.state);
  if (params.contactVerificationPending) {
    query = query
      .not("contact_verification_requested_at", "is", null)
      .is("contact_verified_at", null);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_workspace_activations", error },
    });
  }

  const ids = Array.from(new Set(data.map((r: any) => String(r.business_account_id))));
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const accounts = await supabaseAdmin
      .from("business_accounts")
      .select("id,name")
      .in("id", ids);
    if (accounts.error || !Array.isArray(accounts.data)) {
      return fail({ operation: op, code: "internal", detail: { lookup: "business_accounts" } });
    }
    for (const a of accounts.data as any[]) names[String(a.id)] = String(a.name ?? "");
  }

  return {
    ok: true,
    value: {
      entries: data.map((row: any) => ({
        businessAccountId: String(row.business_account_id),
        // An account whose name could not be read is named as unknown rather
        // than as an empty string an operator would read as "no name".
        businessName: names[String(row.business_account_id)] || "(unnamed business)",
        state: String(row.activation_state),
        requestedAt: row.requested_at ?? null,
        contactVerificationRequestedAt: row.contact_verification_requested_at ?? null,
        contactVerifiedAt: row.contact_verified_at ?? null,
        blockedReason:
          String(row.activation_state) === "blocked"
            ? blockReasonMessage(row.blocked_reason_code)
            : null,
        reviewedAt: row.reviewed_at ?? null,
      })),
    },
  };
}

/**
 * The acknowledgement records behind one workspace.
 *
 * An operator reviewing a request has to be able to see WHAT was accepted, at
 * WHICH version, and by WHOM — a consent record whose acceptor is invisible is
 * not evidence of anything. `isCurrent` is computed against the governed
 * versions, so an operator can tell a stale acceptance from a fresh one.
 */
export async function getAcknowledgementRecords(params: {
  businessAccountId: string;
}): Promise<ActivationResult<{ acknowledgements: AcknowledgementRecord[] }>> {
  const op = "getAcknowledgementRecords";

  const { data, error } = await supabaseAdmin
    .from("couranr_activation_acknowledgements")
    .select("ack_kind,ack_version,accepted_at,accepted_by")
    .eq("business_account_id", params.businessAccountId)
    .order("accepted_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_activation_acknowledgements", error },
    });
  }

  const userIds = Array.from(new Set(data.map((r: any) => String(r.accepted_by))));
  const emails: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const profiles = await supabaseAdmin.from("profiles").select("id,email").in("id", userIds);
    if (profiles.error || !Array.isArray(profiles.data)) {
      return fail({ operation: op, code: "internal", detail: { lookup: "profiles" } });
    }
    for (const p of profiles.data as any[]) emails[String(p.id)] = p.email ?? null;
  }

  return {
    ok: true,
    value: {
      acknowledgements: data.map((row: any) => ({
        kind: String(row.ack_kind),
        version: String(row.ack_version),
        acceptedAt: String(row.accepted_at),
        acceptedByUserId: String(row.accepted_by),
        acceptedByEmail: emails[String(row.accepted_by)] ?? null,
        isCurrent:
          ACKNOWLEDGEMENT_VERSIONS[row.ack_kind as AcknowledgementKind] ===
          String(row.ack_version),
      })),
    },
  };
}

export async function acceptAcknowledgement(params: {
  actor: ActorMembership;
  businessAccountId: string;
  kind: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "acceptAcknowledgement";

  if (!(ACKNOWLEDGEMENT_KINDS as readonly string[]).includes(params.kind)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { kind: params.kind },
      message: "That is not something Couranr asks you to accept.",
    });
  }

  // The VERSION comes from the governed module, never from the request.
  const version = ACKNOWLEDGEMENT_VERSIONS[params.kind as AcknowledgementKind];

  const r = await callRpc<Record<string, any>>(op, "couranr_accept_activation_ack", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_ack_kind: params.kind,
    p_ack_version: version,
  });
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}

export async function requestContactVerification(params: {
  actor: ActorMembership;
  businessAccountId: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "requestContactVerification";
  const r = await callRpc<Record<string, any>>(
    op,
    "couranr_request_activation_contact_verification",
    {
      p_business_account_id: params.businessAccountId,
      p_actor_user_id: params.actor.userId,
    }
  );
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}

export async function verifyContactForOperations(params: {
  operationsUserId: string;
  businessAccountId: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "verifyContactForOperations";
  const r = await callRpc<Record<string, any>>(
    op,
    "couranr_verify_activation_contact_by_operations",
    {
      p_business_account_id: params.businessAccountId,
      p_actor_user_id: params.operationsUserId,
    }
  );
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}

export async function recordTestDelivery(params: {
  actor: ActorMembership;
  businessAccountId: string;
  requestId: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "recordTestDelivery";
  const r = await callRpc<Record<string, any>>(op, "couranr_record_test_delivery", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_request_id: params.requestId,
  });
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}

/**
 * Ask Couranr to review the workspace.
 *
 * The required versions are sent to the SQL, which re-checks every one against
 * the database under a lock. This layer's own check is a courtesy that
 * produces better copy; the database's is the one that decides.
 */
export async function requestActivation(params: {
  actor: ActorMembership;
  businessAccountId: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "requestActivation";
  const r = await callRpc<Record<string, any>>(op, "couranr_request_activation", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_required_acks: ACKNOWLEDGEMENT_VERSIONS,
  });
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}

/**
 * Grant or block — Couranr Operations only.
 *
 * The actor is NOT a membership: an operator is not a member of the workspace
 * they are reviewing. The SQL checks `profiles.role` itself, so this cannot be
 * reached by a merchant even if a future route forgot to.
 */
export async function decideActivation(params: {
  operationsUserId: string;
  businessAccountId: string;
  grant: boolean;
  blockedReasonCode?: string;
}): Promise<ActivationResult<{ state: string }>> {
  const op = "decideActivation";
  const r = await callRpc<Record<string, any>>(op, "couranr_decide_activation_guarded", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.operationsUserId,
    p_grant: params.grant,
    p_blocked_reason_code: params.grant ? null : (params.blockedReasonCode ?? null),
  });
  if (isActivationFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.activation_state) } };
}
