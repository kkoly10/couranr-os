import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "@/lib/couranr/requests/permissions";
import {
  convergeRefundAttemptWithProvider,
  isFulfillmentFailure,
  type RefundGateway,
} from "@/lib/couranr/fulfillment/commands";

assertServerOnly("lib/couranr/operations/refunds.ts");

/**
 * OPS-011 — Refund management.
 *
 * WHAT THIS SURFACE IS, exactly, per `ui_screen_registry.json` OPS-011:
 * "Review delivery-charge refund requests with evidence, policy, Stripe, and
 * ledger effects", actions "Approve full/partial; deny; message
 * merchant/customer; view incident", under the constraint "Merchant controls
 * product refund; Couranr controls delivery-service refund. No on-time
 * guarantee policy."
 *
 * WHAT IT IS NOT, and the two lines nothing here may cross:
 *
 *   * **Couranr refunds its own DELIVERY CHARGE and nothing else** (REF-002).
 *     The refundable figure is derived, in SQL, from the delivery payment
 *     obligation's captured amount. There is no input, no column and no code
 *     path on this surface through which a merchandise price could be
 *     refunded, and `REFUND_REQUEST_REASONS` names no merchandise.
 *   * **Couranr promises no delivery time** (TRM-001, whose `never_claim` list
 *     contains "on-time guarantee"). No reason code names lateness, an ETA or
 *     a delivery window, so no structured record here can quietly become a
 *     late-delivery compensation policy. Operations discretion exists and is
 *     recorded honestly, as `operations_adjustment` with a written note.
 *
 * THIS MODULE ADDS NO SECOND REFUND PATH. P6-004 already shipped the money
 * machinery and it is reused whole:
 *
 *   * the attempt row lives in `couranr_payment_refunds`, as before
 *   * the provider is reached through `convergeRefundAttemptWithProvider`,
 *     the ONE convergence path — list first, converge on a provider match,
 *     create only when a fully-read list proves absence, and never write
 *     after an unknown read
 *   * the balanced ledger posts from the SAME trigger on that table, so a
 *     reviewed refund is Dr refund_expense / Cr stripe_clearing like any other
 *
 * What is new is the REVIEW record in `couranr_refund_requests` and the
 * partial figure, neither of which existed.
 */

/* ------------------------------------------------------------ results --- */

export type RefundReviewFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type RefundReviewResult<T> = { ok: true; value: T } | RefundReviewFailure;

export function isRefundReviewFailure(r: { ok: boolean }): r is RefundReviewFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): RefundReviewFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: p.operation,
    code: p.code,
    detail: p.detail,
  });
  return { ok: false, code: p.code, correlationId, message: p.message };
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<RefundReviewResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, dbCode: error.code, dbMessage: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/* ------------------------------------------------------- vocabulary ----- */

/**
 * The CLOSED structured-reason vocabulary REF-001 requires ("requires:
 * structured reason, evidence, …"). It is duplicated as a CHECK constraint in
 * the migration; `tests/couranr-operations-refunds.test.ts` compares the two
 * so they can never drift.
 *
 * Every value names something about the DELIVERY SERVICE Couranr sold. None
 * names merchandise (REF-002) and none names time (TRM-001).
 */
export const REFUND_REQUEST_REASONS = [
  /** Couranr was paid for a delivery it did not perform. */
  "service_not_performed",
  /** The delivery failed for a reason attributable to Couranr. */
  "couranr_caused_failure",
  /** The same delivery charge was collected more than once. */
  "duplicate_delivery_charge",
  /** The delivery charge collected was not the charge that was quoted. */
  "incorrect_delivery_charge",
  /** Operations discretion, recorded with a written note. */
  "operations_adjustment",
] as const;
export type RefundRequestReason = (typeof REFUND_REQUEST_REASONS)[number];

export function isRefundRequestReason(v: unknown): v is RefundRequestReason {
  return typeof v === "string" && (REFUND_REQUEST_REASONS as readonly string[]).includes(v);
}

/** Who the refund was asked for on behalf of. Not an authority: only Couranr
    Operations ever decides (REF-001 "No refund path exists outside Operations"). */
export const REFUND_REQUESTERS = ["merchant", "customer", "operations"] as const;
export type RefundRequester = (typeof REFUND_REQUESTERS)[number];

/** EXACTLY the seven states ui_screen_registry.json OPS-011 lists. */
export const REFUND_REQUEST_STATES = [
  "pending",
  "approved",
  "processing",
  "partially_refunded",
  "refunded",
  "denied",
  "failed",
] as const;
export type RefundRequestState = (typeof REFUND_REQUEST_STATES)[number];

/**
 * THE NAMED MINTER.
 *
 * Event-derived: the review record's identity and the version its approval
 * was recorded at. Never the clock, never a random value, and never a
 * template literal typed at a call site — `tests/couranr-lifecycle.test.ts`
 * enforces that shape for capture and this file matches it.
 *
 * It must agree BYTE FOR BYTE with `couranr_begin_approved_refund`, which
 * mints the same string in SQL and stores it as `refund_key`. A test compares
 * this function's output with the migration's expression.
 */
export function refundRequestIdempotencyKey(
  refundRequestId: string,
  approvedAtVersion: number
): string {
  return `couranr:refund-request:${refundRequestId}:v${approvedAtVersion}`;
}

/* ------------------------------------------------------- projection ----- */

export type RefundRequestView = {
  id: string;
  requestId: string;
  reference: string | null;
  obligationId: string;
  incidentId: string | null;
  problemReportId: string | null;
  requestedBy: RefundRequester;
  reasonCode: RefundRequestReason;
  detail: string;
  state: RefundRequestState;
  /** Integer cents. Server-computed; null until a decision is recorded. */
  refundableBaseCents: number | null;
  approvedAmountCents: number | null;
  denialReason: string | null;
  decidedAt: string | null;
  version: number;
  createdAt: string;
  /** What the delivery obligation actually holds, for the reviewer. */
  capturedAmountCents: number | null;
  refundedAmountCents: number;
  /** captured - already refunded. The ceiling any approval is measured against. */
  remainingRefundableCents: number;
  /** The provider attempt this decision produced, when it has one. */
  attempt: {
    state: string;
    amountCents: number;
    retainedCents: number;
    providerSettled: boolean;
  } | null;
};

const REVIEW_COLUMNS =
  "id,request_id,obligation_id,incident_id,problem_report_id,requested_by,reason_code,detail," +
  "request_state,refundable_base_cents,approved_amount_cents,denial_reason,decided_at,version," +
  "created_at,refund_attempt_id";

function projectReview(
  row: any,
  obligation: any,
  attempt: any,
  reference: string | null
): RefundRequestView {
  const captured =
    obligation?.captured_amount_cents === null || obligation?.captured_amount_cents === undefined
      ? null
      : Number(obligation.captured_amount_cents);
  const alreadyRefunded = Number(obligation?.refunded_amount_cents ?? 0);
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    reference,
    obligationId: String(row.obligation_id),
    incidentId: row.incident_id ? String(row.incident_id) : null,
    problemReportId: row.problem_report_id ? String(row.problem_report_id) : null,
    requestedBy: row.requested_by,
    reasonCode: row.reason_code,
    detail: String(row.detail ?? ""),
    state: row.request_state,
    refundableBaseCents:
      row.refundable_base_cents === null || row.refundable_base_cents === undefined
        ? null
        : Number(row.refundable_base_cents),
    approvedAmountCents:
      row.approved_amount_cents === null || row.approved_amount_cents === undefined
        ? null
        : Number(row.approved_amount_cents),
    denialReason: row.denial_reason ? String(row.denial_reason) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    version: Number(row.version),
    createdAt: String(row.created_at),
    capturedAmountCents: captured,
    refundedAmountCents: alreadyRefunded,
    remainingRefundableCents: captured === null ? 0 : Math.max(0, captured - alreadyRefunded),
    attempt: attempt
      ? {
          state: String(attempt.attempt_state),
          amountCents: Number(attempt.amount_cents),
          retainedCents: Number(attempt.retained_cents),
          providerSettled: attempt.attempt_state === "succeeded",
        }
      : null,
  };
}

/* ------------------------------------------------ the amount, parsed ---- */

export type RefundApprovalInput =
  | { ok: true; refundRequestId: string; expectedVersion: number; requestedAmountCents: number }
  | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parse an Operations approval off a request body.
 *
 * The figure that arrives here is a REQUEST, never an authority. It is
 * accepted only as a non-negative safe INTEGER of cents — no float, no string,
 * no scientific notation, no `Infinity` — and it is then handed to
 * `couranr_approve_refund_request`, which recomputes the refundable ceiling
 * under a row lock and REFUSES anything above it rather than clamping. The
 * money that actually moves is always the server's arithmetic.
 *
 * This lives in `lib/` rather than in the route deliberately: canonical routes
 * stay thin, and `tests/couranr-server-only.test.ts` forbids a route from
 * reading an amount off its own body at all.
 */
export function parseRefundApproval(raw: unknown, refundRequestId: string): RefundApprovalInput {
  if (!UUID_RE.test(refundRequestId)) {
    return { ok: false, message: "Refund request not found." };
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const version = body["expectedVersion"];
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    return { ok: false, message: "Send the version of the refund request you are deciding on." };
  }

  const figure = body["approvedCents"];
  if (typeof figure !== "number" || !Number.isSafeInteger(figure)) {
    return {
      ok: false,
      message: "A refund approval is a whole number of cents.",
    };
  }
  if (figure <= 0) {
    return { ok: false, message: "A refund approval must be greater than zero." };
  }

  return {
    ok: true,
    refundRequestId,
    expectedVersion: version,
    requestedAmountCents: figure,
  };
}

/* ------------------------------------------------------------ reads ----- */

type OperationsActor = Extract<RequestActor, { kind: "operations" }>;

/**
 * REF-001, in one place: "No refund path exists outside Operations."
 *
 * Returns the NARROWED actor on success rather than a boolean, so every caller
 * reads `userId` off a value the type system knows is an Operations actor. A
 * boolean gate plus a later `actor.userId` is how a gate and its use drift
 * apart.
 */
function operationsOnly(
  actor: RequestActor,
  operation: string
): { ok: true; actor: OperationsActor } | RefundReviewFailure {
  const permission = canActOnDeliveryRequest(actor, "review", null);
  if (!permission.allowed || actor.kind !== "operations") {
    return fail({
      operation,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can review a delivery-charge refund.",
    });
  }
  return { ok: true, actor };
}

/**
 * The OPS-011 queue.
 *
 * Reads are SELECT only — every write goes through a named `couranr_*`
 * command, which is what `scripts/checkCanonicalDmlBoundary.mjs` enforces for
 * `couranr_payment_refunds`, `couranr_payment_obligations` and
 * `couranr_payment_events`.
 *
 * A read that FAILS is reported as a failure. It is never rendered as an empty
 * queue: "no refunds to review" and "Couranr could not read the queue" are
 * different sentences and only one of them is safe to act on.
 */
export async function listRefundRequests(params: {
  actor: RequestActor;
  limit?: number;
}): Promise<RefundReviewResult<{ refundRequests: RefundRequestView[] }>> {
  const op = "listRefundRequests";
  const gate = operationsOnly(params.actor, op);
  if (isRefundReviewFailure(gate)) return gate;

  const limit = Math.min(Math.max(Number(params.limit ?? 100), 1), 200);

  const { data: rows, error } = (await supabaseAdmin
    .from("couranr_refund_requests")
    .select(REVIEW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit)) as { data: any[] | null; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "queue_read", dbMessage: error.message } });
  }
  const list = rows ?? [];
  if (list.length === 0) return { ok: true, value: { refundRequests: [] } };

  const obligationIds = Array.from(new Set(list.map((r) => String(r.obligation_id))));
  const attemptIds = list.map((r) => r.refund_attempt_id).filter(Boolean).map(String);
  const requestIds = Array.from(new Set(list.map((r) => String(r.request_id))));

  const { data: obligations, error: obErr } = (await supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id,captured_amount_cents,refunded_amount_cents,payment_state,version")
    .in("id", obligationIds)) as { data: any[] | null; error: any };
  if (obErr) {
    return fail({ operation: op, code: "internal", detail: { reason: "obligation_read", dbMessage: obErr.message } });
  }

  let attempts: any[] = [];
  if (attemptIds.length > 0) {
    const { data: att, error: attErr } = (await supabaseAdmin
      .from("couranr_payment_refunds")
      .select("id,attempt_state,amount_cents,retained_cents")
      .in("id", attemptIds)) as { data: any[] | null; error: any };
    if (attErr) {
      return fail({ operation: op, code: "internal", detail: { reason: "attempt_read", dbMessage: attErr.message } });
    }
    attempts = att ?? [];
  }

  const { data: requests, error: reqErr } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id,reference")
    .in("id", requestIds)) as { data: any[] | null; error: any };
  if (reqErr) {
    return fail({ operation: op, code: "internal", detail: { reason: "request_read", dbMessage: reqErr.message } });
  }

  const obById = new Map((obligations ?? []).map((o) => [String(o.id), o]));
  const attById = new Map(attempts.map((a) => [String(a.id), a]));
  const refById = new Map((requests ?? []).map((r) => [String(r.id), r.reference ?? null]));

  return {
    ok: true,
    value: {
      refundRequests: list.map((r) =>
        projectReview(
          r,
          obById.get(String(r.obligation_id)),
          r.refund_attempt_id ? attById.get(String(r.refund_attempt_id)) : null,
          refById.get(String(r.request_id)) ?? null
        )
      ),
    },
  };
}

async function readOneReview(
  op: string,
  refundRequestId: string
): Promise<RefundReviewResult<RefundRequestView>> {
  const { data: row, error } = (await supabaseAdmin
    .from("couranr_refund_requests")
    .select(REVIEW_COLUMNS)
    .eq("id", refundRequestId)
    .maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "review_read", dbMessage: error.message } });
  }
  if (!row) {
    return fail({ operation: op, code: "not_found", message: "Refund request not found." });
  }

  const { data: ob, error: obErr } = (await supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id,captured_amount_cents,refunded_amount_cents,payment_state,version")
    .eq("id", String(row.obligation_id))
    .maybeSingle()) as { data: any; error: any };
  if (obErr) {
    return fail({ operation: op, code: "internal", detail: { reason: "obligation_read", dbMessage: obErr.message } });
  }

  let attempt: any = null;
  if (row.refund_attempt_id) {
    const { data: att, error: attErr } = (await supabaseAdmin
      .from("couranr_payment_refunds")
      .select("id,attempt_state,amount_cents,retained_cents")
      .eq("id", String(row.refund_attempt_id))
      .maybeSingle()) as { data: any; error: any };
    if (attErr) {
      return fail({ operation: op, code: "internal", detail: { reason: "attempt_read", dbMessage: attErr.message } });
    }
    attempt = att;
  }

  const { data: req, error: reqErr } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id,reference")
    .eq("id", String(row.request_id))
    .maybeSingle()) as { data: any; error: any };
  if (reqErr) {
    return fail({ operation: op, code: "internal", detail: { reason: "request_read", dbMessage: reqErr.message } });
  }

  return { ok: true, value: projectReview(row, ob, attempt, req?.reference ?? null) };
}

export async function getRefundRequest(params: {
  actor: RequestActor;
  refundRequestId: string;
}): Promise<RefundReviewResult<RefundRequestView>> {
  const op = "getRefundRequest";
  const gate = operationsOnly(params.actor, op);
  if (isRefundReviewFailure(gate)) return gate;
  return readOneReview(op, params.refundRequestId);
}

/* ---------------------------------------------------------- commands ---- */

/**
 * Record an inbound delivery-charge refund request for review.
 *
 * `requestedBy` records WHO asked. It is not an authority — only Couranr
 * Operations decides (REF-001).
 */
export async function openRefundRequest(params: {
  actor: RequestActor;
  deliveryRequestId: string;
  requestedBy: RefundRequester;
  reasonCode: RefundRequestReason;
  detail: string;
  incidentId?: string | null;
  problemReportId?: string | null;
}): Promise<RefundReviewResult<RefundRequestView>> {
  const op = "openRefundRequest";
  const gate = operationsOnly(params.actor, op);
  if (isRefundReviewFailure(gate)) return gate;

  if (!isRefundRequestReason(params.reasonCode)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "refund_reason_invalid" },
      message: "That is not a governed delivery-charge refund reason.",
    });
  }
  if (!(REFUND_REQUESTERS as readonly string[]).includes(params.requestedBy)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "requester_invalid" },
      message: "Say who asked for this refund.",
    });
  }

  const created = await callRpc<any>(op, "couranr_open_refund_request", {
    p_request_id: params.deliveryRequestId,
    p_actor_user_id: gate.actor.userId,
    p_requested_by: params.requestedBy,
    p_reason_code: params.reasonCode,
    p_detail: String(params.detail ?? "").slice(0, 4000),
    p_incident_id: params.incidentId ?? null,
    p_problem_report_id: params.problemReportId ?? null,
  });
  if (isRefundReviewFailure(created)) return created;

  return readOneReview(op, String(created.value.id));
}

/** Deny a refund request. A denial is a recorded decision with a written reason. */
export async function denyRefundRequest(params: {
  actor: RequestActor;
  refundRequestId: string;
  expectedVersion: number;
  denialReason: string;
}): Promise<RefundReviewResult<RefundRequestView>> {
  const op = "denyRefundRequest";
  const gate = operationsOnly(params.actor, op);
  if (isRefundReviewFailure(gate)) return gate;

  if (!String(params.denialReason ?? "").trim()) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "denial_reason_required" },
      message: "Say why this delivery-charge refund is being denied.",
    });
  }

  const done = await callRpc<any>(op, "couranr_deny_refund_request", {
    p_refund_request_id: params.refundRequestId,
    p_actor_user_id: gate.actor.userId,
    p_expected_version: params.expectedVersion,
    p_denial_reason: String(params.denialReason).trim().slice(0, 2000),
  });
  if (isRefundReviewFailure(done)) return done;

  return readOneReview(op, params.refundRequestId);
}

/**
 * APPROVE, then settle. The money path, in three separately replay-safe steps.
 *
 *   1. `couranr_approve_refund_request` recomputes the refundable ceiling
 *      under a row lock, REFUSES a figure above it, and records the decision.
 *      Nothing has been sent to the provider yet, so a crash here leaves a
 *      durable `approved` decision and no ambiguity about money.
 *   2. `couranr_begin_approved_refund` writes the ONE attempt row into
 *      `couranr_payment_refunds` — re-validating the figure against the money
 *      as it stands NOW, because another governed settlement could have landed
 *      in between — and moves the review to `processing`.
 *   3. The attempt is funnelled through the SHARED provider convergence path.
 *      A provider match completes it; a fully-read list proving absence
 *      creates exactly once; a read failure parks it with ZERO provider
 *      writes.
 *
 * Replaying the whole call converges: step 1 returns the recorded decision,
 * step 2 returns the existing attempt, step 3 converges on the same provider
 * operation under the same event-derived key. Two Operations users pressing
 * Approve at the same moment therefore produce ONE refund.
 */
export async function approveRefundRequest(params: {
  actor: RequestActor;
  refundRequestId: string;
  expectedVersion: number;
  requestedAmountCents: number;
  /** REQUIRED. There is no default: omission cannot reach the real provider. */
  gateway: RefundGateway;
}): Promise<RefundReviewResult<RefundRequestView>> {
  const op = "approveRefundRequest";
  const gate = operationsOnly(params.actor, op);
  if (isRefundReviewFailure(gate)) return gate;

  /* Defence in depth. The SQL is the authority on the ceiling and refuses an
     over-large figure by itself; this only stops an obviously malformed value
     from travelling any further. */
  if (!Number.isSafeInteger(params.requestedAmountCents) || params.requestedAmountCents <= 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "refund_amount_invalid" },
      message: "A refund approval is a whole number of cents, greater than zero.",
    });
  }

  const approved = await callRpc<any>(op, "couranr_approve_refund_request", {
    p_refund_request_id: params.refundRequestId,
    p_actor_user_id: gate.actor.userId,
    p_expected_version: params.expectedVersion,
    p_requested_amount_cents: params.requestedAmountCents,
  });
  if (isRefundReviewFailure(approved)) return approved;

  /* A denial cannot be approved, and an approval already settled is not
     re-settled. Both are refused inside the SQL; this is the read of what it
     decided. */
  const begun = await callRpc<any>(op, "couranr_begin_approved_refund", {
    p_refund_request_id: params.refundRequestId,
    p_actor_user_id: gate.actor.userId,
  });
  if (isRefundReviewFailure(begun)) return begun;

  const attempt = begun.value;
  if (attempt.attempt_state !== "succeeded" && attempt.attempt_state !== "settled_no_refund_due") {
    const converged = await convergeRefundAttemptWithProvider(op, attempt, params.gateway);
    if (isFulfillmentFailure(converged)) {
      /*
       * The provider outcome is unknown or the refund failed. Either way the
       * REVIEW RECORD already says so — the trigger mirrored the attempt's
       * state onto it inside the same transaction — so this is a real,
       * readable outcome rather than an exception that vanished. Report the
       * failure with its own correlation id and let Operations reconcile.
       */
      return fail({
        operation: op,
        code: converged.code,
        detail: { reason: "provider_outcome", refundRequestId: params.refundRequestId },
        message: converged.message,
      });
    }
  }

  return readOneReview(op, params.refundRequestId);
}
