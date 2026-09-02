/**
 * P5-001 — Smart Intake server commands.
 *
 * The same failure discipline as the request/payment command layers: every
 * driver error is classified by SQLSTATE and logged under a correlation id;
 * nothing raw ever reaches a caller. All authority lives in the SQL commands
 * (stale gates, idempotency, confirmed-fact protection, tenancy) — this layer
 * orchestrates and NEVER writes a table directly.
 */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  FACT_SCHEMA_VERSION,
  type FactAuthority,
  type FactKey,
  type FactMap,
  type FactSource,
} from "@/lib/couranr/shipment/facts";
import { evaluateShipmentPolicy } from "@/lib/couranr/shipment/policy";
import { selectClarification } from "@/lib/couranr/shipment/clarification";
import {
  PROMPT_VERSION,
  PROVIDER_TIMEOUT_MS,
  resolveSmartIntakeProvider,
  type SmartIntakeProvider,
} from "./provider";
import {
  PROVIDER_INPUT_DATA_CLASSES,
  minimizeConfirmedFactsForProvider,
  isValidationFailure,
  validateProviderOutput,
} from "./interpret";

assertServerOnly("lib/couranr/intake/commands.ts");

const RPC = {
  createSession: "couranr_create_intake_session",
  addRevision: "couranr_add_intake_revision",
  beginRun: "couranr_begin_intake_run",
  completeRun: "couranr_complete_intake_run",
  confirmFact: "couranr_confirm_intake_fact",
  recordPolicy: "couranr_record_intake_policy",
} as const;

export type IntakeFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type IntakeResult<T> = { ok: true; value: T } | IntakeFailure;
export type IntakeRow = Record<string, any>;

export function isIntakeFailure(r: { ok: boolean }): r is IntakeFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): IntakeFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: IntakeFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

async function callRpc(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<IntakeResult<IntakeRow>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    const code = classifyDatabaseError(error);
    return fail({ operation, code, detail: { fn, code: error.code, message: error.message } });
  }
  if (!data) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data };
}

/* ------------------------------------------------------------- reads ---- */

export async function loadIntakeSession(params: {
  sessionId: string;
  businessAccountId: string;
}): Promise<IntakeResult<{ session: IntakeRow; facts: IntakeRow[]; revisions: IntakeRow[] }>> {
  const op = "loadIntakeSession";
  const { data: session, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select("*")
    .eq("id", params.sessionId)
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();
  if (error) {
    return fail({ operation: op, code: classifyDatabaseError(error), detail: error.message });
  }
  if (!session) {
    return fail({ operation: op, code: "not_found", message: "Intake session not found." });
  }
  const [{ data: facts }, { data: revisions }] = await Promise.all([
    supabaseAdmin
      .from("couranr_intake_facts")
      .select("*")
      .eq("session_id", params.sessionId)
      .order("fact_key"),
    supabaseAdmin
      .from("couranr_intake_description_revisions")
      .select("revision, raw_description, source, created_at")
      .eq("session_id", params.sessionId)
      .order("revision"),
  ]);
  return { ok: true, value: { session, facts: facts ?? [], revisions: revisions ?? [] } };
}

/** DB fact rows -> the policy engine's FactMap. */
export function factMapFromRows(rows: IntakeRow[]): FactMap {
  const map: FactMap = {};
  for (const row of rows) {
    map[row.fact_key as FactKey] = {
      key: row.fact_key as FactKey,
      value: row.value,
      confidence: row.confidence ?? null,
      source: row.source as FactSource,
      sourceEvidence: row.source_evidence ?? null,
      requiresConfirmation: row.requires_confirmation === true,
      authority: row.authority as FactAuthority,
    };
  }
  return map;
}

/**
 * The stored policy snapshot for the estimate path, reconstructed into the
 * engine's result shape. Tenant-scoped; null when the session has no
 * evaluation yet (the manual form path).
 */
export async function loadIntakePolicySnapshot(params: {
  sessionId: string;
  businessAccountId: string;
}): Promise<IntakeResult<import("@/lib/couranr/shipment/policy").ShipmentPolicyResult | null>> {
  const op = "loadIntakePolicySnapshot";
  const { data, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select(
      "policy_disposition, policy_reasons, policy_risk_signals, policy_unresolved, policy_version, operational_capability"
    )
    .eq("id", params.sessionId)
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();
  if (error) {
    return fail({ operation: op, code: classifyDatabaseError(error), detail: error.message });
  }
  if (!data) {
    return fail({ operation: op, code: "not_found", message: "Intake session not found." });
  }
  if (!data.policy_disposition) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      policyVersion: data.policy_version,
      disposition: data.policy_disposition,
      reasons: data.policy_reasons ?? [],
      riskSignals: data.policy_risk_signals ?? [],
      operationalCapability: data.operational_capability ?? "standard_lane",
      unresolvedFacts: data.policy_unresolved ?? [],
    } as import("@/lib/couranr/shipment/policy").ShipmentPolicyResult,
  };
}

/* ------------------------------------------------------------ commands -- */

export async function createIntakeSession(params: {
  businessAccountId: string;
  requestId: string | null;
  actorUserId: string;
  description: string;
}): Promise<IntakeResult<IntakeRow>> {
  return callRpc("createIntakeSession", RPC.createSession, {
    p_business_account_id: params.businessAccountId,
    p_request_id: params.requestId,
    p_actor_user_id: params.actorUserId,
    p_description: params.description,
    p_fact_schema_version: FACT_SCHEMA_VERSION,
  });
}

export async function addIntakeRevision(params: {
  sessionId: string;
  businessAccountId: string;
  actorUserId: string;
  description: string;
  expectedRevision: number;
  source: "merchant_statement" | "clarification_response";
}): Promise<IntakeResult<IntakeRow>> {
  return callRpc("addIntakeRevision", RPC.addRevision, {
    p_session_id: params.sessionId,
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_description: params.description,
    p_expected_revision: params.expectedRevision,
    p_source: params.source,
  });
}

export async function confirmIntakeFact(params: {
  sessionId: string;
  businessAccountId: string;
  actorUserId: string;
  factKey: FactKey;
  value: unknown;
  authority: "confirmed" | "overridden";
}): Promise<IntakeResult<IntakeRow>> {
  return callRpc("confirmIntakeFact", RPC.confirmFact, {
    p_session_id: params.sessionId,
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_fact_key: params.factKey,
    p_value: params.value,
    p_authority: params.authority,
  });
}

/**
 * Re-evaluate the deterministic policy over the CURRENT stored facts and
 * persist the result (with the one clarification) on the session. Runs after
 * every interpretation and every confirmation, so what Ops reads is always
 * derived from the actual fact state, never from a captured intermediate.
 */
export async function evaluateAndRecordIntakePolicy(params: {
  sessionId: string;
  businessAccountId: string;
  runId?: string | null;
}): Promise<IntakeResult<IntakeRow>> {
  const loaded = await loadIntakeSession(params);
  if (isIntakeFailure(loaded)) return loaded;
  const facts = factMapFromRows(loaded.value.facts);
  const policy = evaluateShipmentPolicy(facts);
  const clarification = selectClarification(facts, policy);
  return callRpc("recordIntakePolicy", RPC.recordPolicy, {
    p_session_id: params.sessionId,
    p_business_account_id: params.businessAccountId,
    p_policy_disposition: policy.disposition,
    p_policy_reasons: policy.reasons,
    p_policy_risk_signals: policy.riskSignals,
    p_policy_unresolved: policy.unresolvedFacts,
    p_policy_version: policy.policyVersion,
    p_operational_capability: policy.operationalCapability,
    p_clarification: clarification,
    p_run_id: params.runId ?? null,
  });
}

/* ------------------------------------------------------ interpretation -- */

function interpretationIdempotencyKey(params: {
  sessionId: string;
  sourceRevision: number;
  provider: string;
}): string {
  // One logical operation = one key: same words, same prompt, same schema,
  // same provider. A retry of any of it converges in the database.
  return createHash("sha256")
    .update(
      [params.sessionId, params.sourceRevision, PROMPT_VERSION, FACT_SCHEMA_VERSION, params.provider].join("|")
    )
    .digest("hex");
}

export async function runInterpretation(params: {
  sessionId: string;
  businessAccountId: string;
  sourceRevision: number;
  businessCategory?: string | null;
  /** Test seam only; production resolution goes through the env allowlist. */
  providerOverride?: SmartIntakeProvider | null;
}): Promise<IntakeResult<{ run: IntakeRow; session: IntakeRow | null }>> {
  const op = "runInterpretation";
  const provider =
    params.providerOverride !== undefined
      ? params.providerOverride
      : resolveSmartIntakeProvider();
  const providerName = provider?.name ?? "none";

  const begun = await callRpc(op, RPC.beginRun, {
    p_session_id: params.sessionId,
    p_business_account_id: params.businessAccountId,
    p_source_revision: params.sourceRevision,
    p_prompt_version: PROMPT_VERSION,
    p_fact_schema_version: FACT_SCHEMA_VERSION,
    p_provider: providerName,
    p_idempotency_key: interpretationIdempotencyKey({
      sessionId: params.sessionId,
      sourceRevision: params.sourceRevision,
      provider: providerName,
    }),
    p_input_data_classes: PROVIDER_INPUT_DATA_CLASSES,
  });
  if (isIntakeFailure(begun)) return begun;
  const run = begun.value;

  // Converged onto an already-finished run: idempotent, no second paid call.
  if (run.status !== "pending") {
    return { ok: true, value: { run, session: null } };
  }

  const complete = (status: string, extras: Record<string, unknown> = {}) =>
    callRpc(op, RPC.completeRun, {
      p_run_id: run.id,
      p_business_account_id: params.businessAccountId,
      p_status: status,
      p_proposals: null,
      p_output_hash: null,
      p_latency_ms: null,
      p_clarification: null,
      ...extras,
    });

  if (!provider) {
    const done = await complete("unavailable");
    if (isIntakeFailure(done)) return done;
    return { ok: true, value: { run: done.value, session: null } };
  }

  // Build the MINIMIZED payload: description + category + confirmed non-PII
  // facts. The provider request type has no field for anything else.
  const loaded = await loadIntakeSession(params);
  if (isIntakeFailure(loaded)) return loaded;
  const currentRevision = loaded.value.revisions.find(
    (r) => r.revision === params.sourceRevision
  );
  if (!currentRevision) {
    return fail({ operation: op, code: "conflict", detail: "revision not found" });
  }
  const confirmed: Record<string, { value: unknown; authority: string }> = {};
  for (const f of loaded.value.facts) {
    confirmed[f.fact_key] = { value: f.value, authority: f.authority };
  }

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await provider.interpret(
      {
        promptVersion: PROMPT_VERSION,
        factSchemaVersion: FACT_SCHEMA_VERSION,
        shipmentDescription: currentRevision.raw_description,
        businessCategory: params.businessCategory ?? null,
        confirmedFacts: minimizeConfirmedFactsForProvider(confirmed),
      },
      AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    );
  } catch (e: any) {
    outcome = e?.name === "TimeoutError" ? { outcome: "timeout" as const } : { outcome: "unavailable" as const };
  }
  const latency = Date.now() - startedAt;

  if (outcome.outcome !== "success") {
    const done = await complete(outcome.outcome, { p_latency_ms: latency });
    if (isIntakeFailure(done)) return done;
    return { ok: true, value: { run: done.value, session: null } };
  }

  const validated = validateProviderOutput(outcome.rawJson);
  if (isValidationFailure(validated)) {
    const done = await complete(validated.reason, { p_latency_ms: latency });
    if (isIntakeFailure(done)) return done;
    return { ok: true, value: { run: done.value, session: null } };
  }

  const outputHash = createHash("sha256")
    .update(JSON.stringify(validated.proposals))
    .digest("hex");
  const done = await complete("success", {
    p_proposals: validated.proposals.map((p) => ({
      key: p.key,
      value: p.value,
      confidence: p.confidence,
      source: p.source,
      sourceEvidence: p.sourceEvidence,
      requiresConfirmation: p.requiresConfirmation,
    })),
    p_output_hash: outputHash,
    p_latency_ms: latency,
  });
  if (isIntakeFailure(done)) return done;

  // Policy + the one clarification, derived from the ACTUAL post-merge fact
  // state. If this run was superseded meanwhile, record_intake_policy refuses
  // with the same stale rule and current state stands.
  if (done.value.status === "success") {
    const recorded = await evaluateAndRecordIntakePolicy({
      sessionId: params.sessionId,
      businessAccountId: params.businessAccountId,
      runId: run.id,
    });
    if (!isIntakeFailure(recorded)) {
      return { ok: true, value: { run: done.value, session: recorded.value } };
    }
  }
  return { ok: true, value: { run: done.value, session: null } };
}
