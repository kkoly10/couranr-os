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
import { scanRestrictedSignals } from "@/lib/couranr/shipment/restrictedSignals";
import { isBusinessCategory } from "@/lib/couranr/categories/registry";
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
  verifySourceEvidence,
} from "./interpret";
import { sanitizeDescriptionForProvider } from "./sanitize";
import { planIntakeFactSync, type IntakeFormStatement } from "./sync";

assertServerOnly("lib/couranr/intake/commands.ts");

const RPC = {
  createSession: "couranr_create_intake_session",
  addRevision: "couranr_add_intake_revision",
  beginRun: "couranr_begin_intake_run",
  completeRun: "couranr_complete_intake_run",
  confirmFact: "couranr_confirm_intake_fact",
  retractFact: "couranr_retract_intake_fact",
  linkSession: "couranr_link_intake_session",
  recordPolicy: "couranr_record_intake_policy",
  /* INT-002 */
  upsertConsumer: "couranr_upsert_consumer_intake_description",
} as const;

export type IntakeFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type IntakeResult<T> = { ok: true; value: T } | IntakeFailure;
export type IntakeRow = Record<string, any>;

/**
 * INT-002: an intake session belongs to EXACTLY one scope — a business account
 * (merchant Smart Intake) or a consumer guest session (/send). Every
 * scope-taking command sends both columns; the SQL refuses a call naming both
 * or neither (CR422 intake_scope_required), and this union makes the same
 * mistake a type error. One substrate, one pipeline, two owners.
 */
export type IntakeScope =
  | { businessAccountId: string; guestSessionId?: undefined }
  | { guestSessionId: string; businessAccountId?: undefined };

function scopeArgs(scope: IntakeScope): {
  p_business_account_id: string | null;
  p_guest_session_id: string | null;
} {
  return {
    p_business_account_id: scope.businessAccountId ?? null,
    p_guest_session_id: scope.guestSessionId ?? null,
  };
}

/** The one column a scoped READ filters on. */
function scopeColumn(scope: IntakeScope): [column: string, value: string] {
  return scope.businessAccountId !== undefined
    ? ["business_account_id", scope.businessAccountId]
    : ["guest_session_id", scope.guestSessionId];
}

/** A clean scope object from any params bag that carries one. */
function pickScope(scope: IntakeScope): IntakeScope {
  return scope.businessAccountId !== undefined
    ? { businessAccountId: scope.businessAccountId }
    : { guestSessionId: scope.guestSessionId };
}

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

export async function loadIntakeSession(
  params: { sessionId: string } & IntakeScope
): Promise<IntakeResult<{ session: IntakeRow; facts: IntakeRow[]; revisions: IntakeRow[] }>> {
  const op = "loadIntakeSession";
  const [scopeCol, scopeVal] = scopeColumn(params);
  const { data: session, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select("*")
    .eq("id", params.sessionId)
    .eq(scopeCol, scopeVal)
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

export type IntakePolicySnapshot = {
  /** Null when the session has no evaluation yet (the manual form path). */
  policy: import("@/lib/couranr/shipment/policy").ShipmentPolicyResult | null;
  /** The revision the commit command must be told, so a stale read is refused. */
  currentRevision: number;
  requestId: string | null;
};

/**
 * The stored policy snapshot for the estimate path, reconstructed into the
 * engine's result shape, together with the session's current revision —
 * the CAS value `couranr_commit_intake_to_request` requires. Tenant-scoped.
 */
export async function loadIntakePolicySnapshot(params: {
  sessionId: string;
  businessAccountId: string;
}): Promise<IntakeResult<IntakePolicySnapshot>> {
  const op = "loadIntakePolicySnapshot";
  const { data, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select(
      "policy_disposition, policy_reasons, policy_risk_signals, policy_unresolved, policy_version, operational_capability, current_revision, request_id"
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
  const policy = data.policy_disposition
    ? ({
        policyVersion: data.policy_version,
        disposition: data.policy_disposition,
        reasons: data.policy_reasons ?? [],
        riskSignals: data.policy_risk_signals ?? [],
        operationalCapability: data.operational_capability ?? "standard_lane",
        unresolvedFacts: data.policy_unresolved ?? [],
      } as import("@/lib/couranr/shipment/policy").ShipmentPolicyResult)
    : null;
  return {
    ok: true,
    value: {
      policy,
      currentRevision: Number(data.current_revision),
      requestId: data.request_id ?? null,
    },
  };
}

/**
 * The session already bound to a request, if any — the SERVER's memory of
 * where a request's shipment facts came from. A browser that lost its state
 * (a step remount, a reload) sends no session id; without this lookup its
 * next estimate would silently turn an intake-backed request into an
 * unsynced manual one, leaving Ops with facts that no longer describe the
 * request. `request_id` is UNIQUE on the sessions table, so there is at most
 * one binding to find.
 */
export async function findLinkedIntakeSession(params: {
  requestId: string;
  businessAccountId: string;
}): Promise<IntakeResult<string | null>> {
  const op = "findLinkedIntakeSession";
  const { data, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select("id")
    .eq("request_id", params.requestId)
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();
  if (error) {
    return fail({ operation: op, code: classifyDatabaseError(error), detail: error.message });
  }
  return { ok: true, value: typeof data?.id === "string" ? data.id : null };
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

export async function confirmIntakeFact(
  params: {
    sessionId: string;
    /** null for a guest: the SQL records the source as consumer_statement. */
    actorUserId: string | null;
    factKey: FactKey;
    value: unknown;
    authority: "confirmed" | "overridden";
  } & IntakeScope
): Promise<IntakeResult<IntakeRow>> {
  return callRpc("confirmIntakeFact", RPC.confirmFact, {
    p_session_id: params.sessionId,
    ...scopeArgs(params),
    p_actor_user_id: params.actorUserId,
    p_fact_key: params.factKey,
    p_value: params.value,
    p_authority: params.authority,
  });
}

export async function retractIntakeFact(
  params: { sessionId: string; actorUserId: string | null; factKey: FactKey } & IntakeScope
): Promise<IntakeResult<IntakeRow>> {
  return callRpc("retractIntakeFact", RPC.retractFact, {
    p_session_id: params.sessionId,
    ...scopeArgs(params),
    p_actor_user_id: params.actorUserId,
    p_fact_key: params.factKey,
  });
}

/**
 * Bind a session that started before its request existed to that request.
 * Idempotent for the same request; a session already bound elsewhere is
 * refused (CR409), so evidence can never be re-pointed at another delivery.
 */
export async function linkIntakeSession(
  params: { sessionId: string; requestId: string } & IntakeScope
): Promise<IntakeResult<IntakeRow>> {
  return callRpc("linkIntakeSession", RPC.linkSession, {
    p_session_id: params.sessionId,
    ...scopeArgs(params),
    p_request_id: params.requestId,
  });
}

/**
 * Bring the fact record into agreement with what the structured form states
 * (see sync.ts for the rules). Each step is its own command; the first
 * failure stops the sync and is reported, leaving the record partially
 * updated but always internally valid — every step is a legal fact state.
 */
export async function syncFormFactsIntoIntake(
  params: {
    sessionId: string;
    actorUserId: string | null;
    statement: IntakeFormStatement;
  } & IntakeScope
): Promise<IntakeResult<{ steps: number }>> {
  const loaded = await loadIntakeSession(params);
  if (isIntakeFailure(loaded)) return loaded;
  const scope = pickScope(params);
  const steps = planIntakeFactSync(loaded.value.facts as never, params.statement);
  for (const step of steps) {
    const result =
      step.op === "confirm"
        ? await confirmIntakeFact({
            sessionId: params.sessionId,
            ...scope,
            actorUserId: params.actorUserId,
            factKey: step.factKey,
            value: step.value,
            authority: step.authority,
          })
        : await retractIntakeFact({
            sessionId: params.sessionId,
            ...scope,
            actorUserId: params.actorUserId,
            factKey: step.factKey,
          });
    if (isIntakeFailure(result)) return result;
  }
  return { ok: true, value: { steps: steps.length } };
}

/**
 * Re-evaluate the deterministic policy over the CURRENT stored facts and
 * persist the result (with the one clarification) on the session. Runs after
 * every interpretation and every confirmation, so what Ops reads is always
 * derived from the actual fact state, never from a captured intermediate.
 */
export async function evaluateAndRecordIntakePolicy(
  params: { sessionId: string; runId?: string | null } & IntakeScope
): Promise<IntakeResult<IntakeRow>> {
  const loaded = await loadIntakeSession(params);
  if (isIntakeFailure(loaded)) return loaded;
  const facts = factMapFromRows(loaded.value.facts);
  // The deterministic restricted-item scan of the CURRENT words. Escalation
  // only: it can add risk signals and force review, never prohibit, and it
  // runs whether or not any provider ever answered — so "no AI signal" can
  // never read as "no safety concern".
  const current = loaded.value.revisions[loaded.value.revisions.length - 1];
  const textSignals = current ? scanRestrictedSignals(String(current.raw_description ?? "")) : null;
  const policy = evaluateShipmentPolicy(facts, { textSignals });
  const clarification = selectClarification(facts, policy);
  return callRpc("recordIntakePolicy", RPC.recordPolicy, {
    p_session_id: params.sessionId,
    ...scopeArgs(params),
    p_policy_disposition: policy.disposition,
    p_policy_reasons: policy.reasons,
    p_policy_risk_signals: policy.riskSignals,
    p_policy_unresolved: policy.unresolvedFacts,
    p_policy_version: policy.policyVersion,
    p_operational_capability: policy.operationalCapability,
    p_clarification: clarification,
    p_run_id: params.runId ?? null,
    p_restricted_signals: textSignals,
  });
}

/**
 * The business category the provider may see as CONTEXT, resolved
 * server-side from the authenticated business account's governed workspace
 * record (P4-002). The browser cannot supply it; a value outside the closed
 * registry is null. Context only: it changes no policy, price, route or
 * capability.
 */
export async function resolveProviderBusinessCategory(
  businessAccountId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("couranr_merchant_workspaces")
    .select("business_category")
    .eq("business_account_id", businessAccountId)
    .maybeSingle();
  if (error || !data) return null;
  return isBusinessCategory(data.business_category) ? data.business_category : null;
}

/* -------------------------------------------------- INT-002 consumer -- */

/**
 * The guest's description, upserted onto the ONE intake session bound to
 * their guest session. The SQL adds no revision for identical trimmed words
 * (no second paid call) and appends revision N+1 for changed words.
 */
export async function upsertConsumerIntakeDescription(params: {
  guestSessionId: string;
  description: string;
}): Promise<IntakeResult<{ session: IntakeRow; revisionAdded: boolean }>> {
  const op = "upsertConsumerIntakeDescription";
  const r = await callRpc(op, RPC.upsertConsumer, {
    p_guest_session_id: params.guestSessionId,
    p_description: params.description,
    p_fact_schema_version: FACT_SCHEMA_VERSION,
  });
  if (isIntakeFailure(r)) return r;
  const session = r.value?.session;
  if (!session || typeof session.id !== "string") {
    return fail({ operation: op, code: "conflict", detail: { reason: "upsert returned no session" } });
  }
  return { ok: true, value: { session, revisionAdded: r.value.revisionAdded === true } };
}

/** The consumer intake session bound to a guest session, or null. */
export async function findConsumerIntakeSession(
  guestSessionId: string
): Promise<IntakeResult<IntakeRow | null>> {
  const op = "findConsumerIntakeSession";
  const { data, error } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select("id, current_revision, request_id, interpretation_status")
    .eq("guest_session_id", guestSessionId)
    .maybeSingle();
  if (error) {
    return fail({ operation: op, code: classifyDatabaseError(error), detail: error.message });
  }
  return { ok: true, value: data ?? null };
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

export async function runInterpretation(
  params: { sessionId: string; sourceRevision: number } & IntakeScope
): Promise<IntakeResult<{ run: IntakeRow; session: IntakeRow | null }>> {
  const op = "runInterpretation";
  // Provider resolution has exactly one door (env allowlist, plus the
  // sanctioned test seam that does not exist in production). There is no
  // per-call override: application code cannot hand this function a model.
  const provider: SmartIntakeProvider | null = resolveSmartIntakeProvider();
  const providerName = provider?.name ?? "none";

  const begun = await callRpc(op, RPC.beginRun, {
    p_session_id: params.sessionId,
    ...scopeArgs(params),
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
    p_requested_model: provider?.requestedModel ?? null,
  });
  if (isIntakeFailure(begun)) return begun;
  // The command answers `{ run, claimed }`: exactly ONE caller per
  // (session, idempotency key) is told it claimed the run. Everyone else
  // converged onto that row — finished or still in flight — and must NOT
  // spend a second provider call on it.
  const run: IntakeRow = begun.value.run ?? {};
  const claimed = begun.value.claimed === true;
  if (!run.id) {
    return fail({ operation: op, code: "conflict", detail: { reason: "begin returned no run" } });
  }
  if (!claimed || run.status !== "pending") {
    // Converged on another caller's run, or the server-authoritative budget
    // said no (status `rate_limited`): either way no provider call is made
    // here, and the manual structured flow is untouched.
    return { ok: true, value: { run, session: null } };
  }

  const complete = (status: string, extras: Record<string, unknown> = {}) =>
    callRpc(op, RPC.completeRun, {
      p_run_id: run.id,
      ...scopeArgs(params),
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

  // INT-002: a guest has no business category; the provider sees null, the
  // same value a merchant outside the closed registry gets.
  const businessCategory =
    params.businessAccountId !== undefined
      ? await resolveProviderBusinessCategory(params.businessAccountId)
      : null;

  // §3 — the RAW description stays in the database untouched; what EVERY
  // provider (fake included) is shown is the sanitized text, with obvious
  // email/phone/card patterns replaced by fixed redaction tokens. The
  // Anthropic adapter sanitizes again on its own (idempotent), belt and
  // braces. §5 compares evidence against this same string.
  const providerVisibleText = sanitizeDescriptionForProvider(
    String(currentRevision.raw_description ?? "")
  ).sanitized;

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await provider.interpret(
      {
        promptVersion: PROMPT_VERSION,
        factSchemaVersion: FACT_SCHEMA_VERSION,
        shipmentDescription: providerVisibleText,
        businessCategory,
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

  // Provider audit evidence: the model the provider REPORTED serving and the
  // token counts it supplied, persisted with the run whatever happens next.
  const audit = {
    p_provider_model: outcome.model ?? null,
    p_input_tokens: outcome.usage?.inputTokens ?? null,
    p_output_tokens: outcome.usage?.outputTokens ?? null,
  };

  // §5 — immediately after validation, drop any sourceEvidence that does not
  // occur verbatim in the text the provider was shown. The proposal survives;
  // only the false "this is a quote" claim is nulled.
  const validated = verifySourceEvidence(
    validateProviderOutput(outcome.rawJson),
    providerVisibleText
  );
  if (isValidationFailure(validated)) {
    const done = await complete(validated.reason, { p_latency_ms: latency, ...audit });
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
    ...audit,
  });
  if (isIntakeFailure(done)) return done;

  // Policy + the one clarification, derived from the ACTUAL post-merge fact
  // state. If this run was superseded meanwhile, record_intake_policy refuses
  // with the same stale rule and current state stands.
  if (done.value.status === "success") {
    const recorded = await evaluateAndRecordIntakePolicy({
      sessionId: params.sessionId,
      ...pickScope(params),
      runId: run.id,
    });
    if (!isIntakeFailure(recorded)) {
      return { ok: true, value: { run: done.value, session: recorded.value } };
    }
  }
  return { ok: true, value: { run: done.value, session: null } };
}
