/**
 * INT-002 — Consumer Smart Intake: the guest on /send as the TRUSTED ACTOR for
 * their OWN shipment, on the SAME substrate merchants use.
 *
 * Nothing here is a second pipeline. The description lands in
 * `couranr_intake_sessions` under the guest scope, `runInterpretation` runs
 * the one provider seam with the one prompt/schema, the deterministic policy
 * engine records its verdict, and what comes back to the browser is a list
 * of STRUCTURED proposals the guest must choose — the model's free text never
 * reaches a screen, so injected prose has nowhere to render.
 *
 * The anonymous surface carries its own controls (INT-002):
 *   - the kill switch: `COURANR_CONSUMER_INTAKE` must equal "live"; anything
 *     else is `unavailable` with ZERO provider calls and ZERO writes;
 *   - one paid call per description revision (identical trimmed words add no
 *     revision — enforced in SQL, not here);
 *   - 12 paid calls per guest session per hour and ONE global consumer
 *     allowance of 300 per hour (enforced in SQL under an advisory lock);
 *   - a 4000-character input cap, and a body that may carry NOTHING but the
 *     description.
 *
 * The confirmation trail: at estimate time the guest's FORM statement (weight,
 * band, declaration) becomes the confirmed facts — source `consumer_statement`,
 * no actor — beside the AI proposals. That enrichment must never block the
 * money path: `recordConsumerIntakeEvidenceAfterEstimate` logs and swallows.
 */
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId, publicFailure } from "@/lib/couranr/errors";
import {
  evaluateAndRecordIntakePolicy,
  findConsumerIntakeSession,
  isIntakeFailure,
  linkIntakeSession,
  loadIntakeSession,
  runInterpretation,
  syncFormFactsIntoIntake,
  upsertConsumerIntakeDescription,
  type IntakeRow,
} from "@/lib/couranr/intake/commands";
import type { RestrictedClassDeclaration, WeightBand } from "@/lib/couranr/shipment/facts";
import type { ConsumerResult, GuestSession } from "./send";

assertServerOnly("lib/couranr/consumer/intake.ts");

/* ------------------------------------------------------------- controls -- */

export const CONSUMER_INTAKE_FLAG = "COURANR_CONSUMER_INTAKE";
export const CONSUMER_DESCRIPTION_MAX_CHARS = 4000;

/** The kill switch. Exactly "live" arms it; absence or any other value is off. */
export type EnvLike = Record<string, string | undefined>;

export function consumerIntakeEnabled(env: EnvLike = process.env): boolean {
  return (env[CONSUMER_INTAKE_FLAG] ?? "").trim() === "live";
}

/* ------------------------------------------------------------- the view -- */

/**
 * The fact keys a guest may be shown as suggestions. Material keys (weight,
 * band, restricted class) need an explicit choice on the form; the rest are
 * read-only context. Nothing about price, route, state or payer is a key.
 */
export const CONSUMER_PROPOSAL_KEYS = [
  "item_category",
  "item_subtype",
  "quantity",
  "package_count",
  "weight_lb_exact",
  "weight_band",
  "fragile",
  "handling_requirements",
  "restricted_class",
] as const;
export type ConsumerProposalKey = (typeof CONSUMER_PROPOSAL_KEYS)[number];

export type ConsumerIntakeProposal = {
  key: ConsumerProposalKey;
  value: unknown;
  confidence: number | null;
  requiresConfirmation: boolean;
};

export type ConsumerIntakeStatus =
  | "unavailable"
  | "pending"
  | "interpreted"
  | "manual"
  | "rate_limited";

export type ConsumerIntakeView = {
  status: ConsumerIntakeStatus;
  revision: number | null;
  proposals: ConsumerIntakeProposal[];
  clarification: { question: string } | null;
};

const UNAVAILABLE: ConsumerIntakeView = {
  status: "unavailable",
  revision: null,
  proposals: [],
  clarification: null,
};

export function isConsumerProposalKey(k: unknown): k is ConsumerProposalKey {
  return typeof k === "string" && (CONSUMER_PROPOSAL_KEYS as readonly string[]).includes(k);
}

/** DB rows -> what the browser may see. Proposed facts only, allow-listed keys only. */
export function viewFromIntakeSession(session: IntakeRow, facts: IntakeRow[]): ConsumerIntakeView {
  const s = String(session.interpretation_status ?? "none");
  const status: ConsumerIntakeStatus =
    s === "interpreted"
      ? "interpreted"
      : s === "pending"
        ? "pending"
        : s === "rate_limited"
          ? "rate_limited"
          : s === "manual" || s === "provider_unavailable"
            ? "manual"
            : "unavailable";
  const proposals: ConsumerIntakeProposal[] = [];
  for (const f of facts) {
    if (f.authority !== "proposed" || !isConsumerProposalKey(f.fact_key)) continue;
    proposals.push({
      key: f.fact_key,
      value: f.value,
      confidence: typeof f.confidence === "number" ? f.confidence : null,
      requiresConfirmation: f.requires_confirmation !== false,
    });
  }
  const q = session.current_clarification?.question;
  return {
    status,
    revision: typeof session.current_revision === "number" ? session.current_revision : null,
    proposals,
    clarification: typeof q === "string" && q.trim() !== "" ? { question: q } : null,
  };
}

/* ----------------------------------------------------------- the body ---- */

export type ConsumerIntakeBody =
  | { ok: true; description: string }
  | { ok: false; reason: string };

/**
 * `{ description }` and NOTHING else. Any other key — a price, a state, a
 * hint to the model, anything — is refused before a row is read. The forbidden
 * consumer keys are a superset concern; here the allow-list is one key.
 */
export function parseConsumerIntakeBody(body: unknown): ConsumerIntakeBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "body_not_object" };
  }
  const extra = Object.keys(body).filter((k) => k !== "description");
  if (extra.length > 0) return { ok: false, reason: `unexpected_key:${extra[0]}` };
  const d = (body as { description?: unknown }).description;
  if (typeof d !== "string" || d.trim() === "") return { ok: false, reason: "description_required" };
  if (d.length > CONSUMER_DESCRIPTION_MAX_CHARS) return { ok: false, reason: "description_too_long" };
  return { ok: true, description: d };
}

/* ------------------------------------------------------- interpretation -- */

export async function interpretConsumerDescription(params: {
  session: GuestSession;
  body: unknown;
  env?: EnvLike;
}): Promise<ConsumerResult<ConsumerIntakeView>> {
  const op = "interpretConsumerDescription";
  if (!consumerIntakeEnabled(params.env)) return { ok: true, value: UNAVAILABLE };

  const parsed = parseConsumerIntakeBody(params.body);
  // `strict: false` globally: `!parsed.ok` does not narrow; the explicit test does.
  if (parsed.ok === false) {
    return publicFailure({
      operation: op,
      code: "invalid_input",
      detail: { reason: parsed.reason },
      message: "Describe what is being delivered, in up to 4000 characters.",
    });
  }

  const upserted = await upsertConsumerIntakeDescription({
    guestSessionId: params.session.id,
    description: parsed.description,
  });
  if (isIntakeFailure(upserted)) return upserted;
  const sessionId = String(upserted.value.session.id);
  const revision = Number(upserted.value.session.current_revision);
  const scope = { guestSessionId: params.session.id } as const;

  // Same words -> the SQL converged on the existing run and no provider call
  // is made; changed words -> exactly one caller claims the new run.
  const interpreted = await runInterpretation({ sessionId, ...scope, sourceRevision: revision });
  if (isIntakeFailure(interpreted)) return interpreted;

  const loaded = await loadIntakeSession({ sessionId, ...scope });
  if (isIntakeFailure(loaded)) return loaded;
  return { ok: true, value: viewFromIntakeSession(loaded.value.session, loaded.value.facts) };
}

/* ------------------------------------------- the confirmation trail ----- */

export type ConsumerFormStatement = {
  weightLb: number | null;
  weightBand: WeightBand | null;
  restrictedClass: RestrictedClassDeclaration;
};

/**
 * After an estimate: link the guest's intake session to their request and
 * record the FORM statement as the confirmed facts (source consumer_statement,
 * no actor), then re-evaluate policy over the actual fact state. Evidence
 * only — the estimate has already priced from the request's own stored facts.
 * NEVER throws and NEVER changes the estimate's outcome: a failure here is
 * logged under a correlation id and swallowed.
 */
export async function recordConsumerIntakeEvidenceAfterEstimate(params: {
  session: GuestSession;
  requestId: string;
  statement: ConsumerFormStatement;
  env?: EnvLike;
}): Promise<void> {
  if (!consumerIntakeEnabled(params.env)) return;
  const op = "recordConsumerIntakeEvidenceAfterEstimate";
  try {
    const found = await findConsumerIntakeSession(params.session.id);
    if (isIntakeFailure(found) || !found.value) return;
    const sessionId = String(found.value.id);
    const scope = { guestSessionId: params.session.id } as const;

    const linked = await linkIntakeSession({ sessionId, ...scope, requestId: params.requestId });
    if (isIntakeFailure(linked)) return;
    const synced = await syncFormFactsIntoIntake({
      sessionId,
      ...scope,
      actorUserId: null,
      statement: {
        weightLb: params.statement.weightLb,
        weightBand: params.statement.weightBand,
        restrictedClass: params.statement.restrictedClass,
        serviceLevel: "standard",
        timingIntent: "asap",
        requestedPickupLocal: null,
      },
    });
    if (isIntakeFailure(synced)) return;
    await evaluateAndRecordIntakePolicy({ sessionId, ...scope });
  } catch (e) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: op,
      code: "internal",
      detail: { message: e instanceof Error ? e.message : String(e) },
    });
  }
}
