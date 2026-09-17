import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { COURANR_IDENTITY_POLICY_VERSION } from "./recipientIdentity";
import {
  resolveRecipientIdentityOutcome,
  type IdentityAdapterDeps,
  type IdentityEvaluation,
} from "./stripeIdentity";

assertServerOnly("lib/couranr/identity/commands.ts");

/**
 * The only path from a provider verification to a Couranr custody record.
 *
 * WHY THIS FILE EXISTS. `couranr_record_recipient_identity_verification` was
 * written, applied to production, and then called by nothing — `grep` for its
 * name across `lib/` and `app/` returned zero hits. A command no caller can
 * reach is indistinguishable from a command that does not work, and this
 * repository has already shipped exactly that: a Delivery Help redemption whose
 * foreign key pointed at the wrong table survived 1230 green tests because
 * nothing ever executed it.
 *
 * THE BOOLEANS ARE NOT NEGOTIABLE FROM OUTSIDE. `recordRecipientIdentity` takes
 * an `IdentityEvaluation` produced by the adapter, never three loose booleans
 * from a caller. A route that could pass `adultVerified: true` on its own would
 * make the entire protected-handoff promise a client-supplied claim — the same
 * defect class as accepting a protection level from the browser, which
 * `protection.ts` exists to prevent.
 */

export const IDENTITY_RPC = {
  record: "couranr_record_recipient_identity_verification",
} as const;

export type IdentityFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  /** Non-personal. An enum from the adapter, or a database refusal class. */
  reason?: string;
};
export type IdentityResult<T> = { ok: true; value: T } | IdentityFailure;

/** `tsconfig` has `strict: false`, so `.ok` does not narrow without this. */
export function isIdentityFailure(r: { ok: boolean }): r is IdentityFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  reason?: string;
}): IdentityFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: IdentityFailure = { ok: false, code: params.code, correlationId };
  if (params.reason) out.reason = params.reason;
  return out;
}

/**
 * Persist an evaluated outcome.
 *
 * The evaluation's `reason` and `blockedByConfiguration` are deliberately NOT
 * written to the row: the row's vocabulary is fixed by `couranr_riv_state_chk`
 * and widening it is a schema decision, not something a TypeScript caller gets
 * to do by passing an extra column. They travel back to the caller instead, so
 * an Operations surface can tell "this recipient is not the named adult" apart
 * from "Couranr has no restricted key", which is the distinction the adapter
 * exists to preserve.
 */
export async function recordRecipientIdentity(params: {
  deliveryId: string;
  evaluation: IdentityEvaluation;
}): Promise<IdentityResult<{ state: IdentityEvaluation["state"]; reason: string }>> {
  const op = "recordRecipientIdentity";
  const e = params?.evaluation;
  if (!e || typeof e.state !== "string") {
    return fail({ operation: op, code: "invalid_input", detail: { reason: "evaluation_missing" } });
  }
  if (e.policyVersion !== COURANR_IDENTITY_POLICY_VERSION) {
    /* An evaluation minted under a different policy means the rules that
       produced these booleans are not the rules this build states. Refuse rather
       than record an answer under a version it was not computed for. */
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "policy_version_mismatch", got: e.policyVersion },
    });
  }

  const { data, error } = (await supabaseAdmin.rpc(IDENTITY_RPC.record, {
    p_delivery_id: params.deliveryId,
    p_state: e.state,
    p_provider_reference: e.providerReference,
    p_identity_verified: e.identityVerified,
    p_adult_verified: e.adultVerified,
    p_authorized_recipient_match: e.authorizedRecipientMatch,
    p_policy_version: e.policyVersion,
  })) as { data: any; error: any };

  if (error) {
    return fail({
      operation: op,
      code: classifyDatabaseError(error),
      detail: { fn: IDENTITY_RPC.record, code: error.code, message: error.message },
      reason: e.reason,
    });
  }
  void data;
  return { ok: true, value: { state: e.state, reason: e.reason } };
}

/**
 * Retrieve from the provider, evaluate, record. One call, no PII retained.
 *
 * `deps` is required and has no default, so this function cannot reach Stripe
 * unless a caller hands it a transport and a restricted key — see the header of
 * `stripeIdentity.ts` for why that is structural rather than a flag.
 */
export async function syncRecipientIdentityFromProvider(
  params: { deliveryId: string; providerSessionId: string; designatedRecipientName: unknown },
  deps: IdentityAdapterDeps
): Promise<IdentityResult<{ state: IdentityEvaluation["state"]; reason: string }>> {
  let evaluation: IdentityEvaluation;
  try {
    evaluation = await resolveRecipientIdentityOutcome(
      params.providerSessionId,
      { designatedRecipientName: params.designatedRecipientName },
      deps
    );
  } catch (err: any) {
    /* Only the adapter's own error CODE is recorded. A provider error body can
       quote the values the recipient submitted. */
    return fail({
      operation: "syncRecipientIdentityFromProvider",
      code: "internal",
      detail: { code: err?.code ?? "identity_adapter_error" },
      reason: err?.code ?? "identity_adapter_error",
    });
  }
  return recordRecipientIdentity({ deliveryId: params.deliveryId, evaluation });
}
