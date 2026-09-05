import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { claimPaidApiCall } from "@/lib/couranr/providers/paidApiGuard";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  generateAccessToken,
  hashAccessToken,
  isWellFormedAccessToken,
} from "@/lib/couranr/accessTokens";
import type { QuoteResult } from "@/lib/couranr/pricing";
import {
  deriveCanonicalRouteAndQuote,
  isCanonicalAddressResolutionError,
} from "@/lib/couranr/routing/canonicalRoute";
import { quoteArgs, routeArgs, timingArgs } from "@/lib/couranr/requests/commands";
import { factsFromDraft } from "@/lib/couranr/shipment/draftFacts";
import { evaluateShipmentPolicy } from "@/lib/couranr/shipment/policy";
import { applyShipmentPolicyToQuote } from "@/lib/couranr/shipment/quoteStatus";
import { scanRestrictedSignals } from "@/lib/couranr/shipment/restrictedSignals";
import {
  isRestrictedClassDeclaration,
  isWeightBand,
  type RestrictedClassDeclaration,
  type WeightBand,
} from "@/lib/couranr/shipment/facts";
import {
  ensurePaymentIntent,
  isPaymentFailure,
  reconcilePaymentIntent,
} from "@/lib/couranr/payments/commands";
import { issueTrackingLink, isTrackingFailure } from "@/lib/couranr/tracking/commands";
import { recordConsumerIntakeEvidenceAfterEstimate } from "./intake";
import {
  CODE_SHOWN_ONCE_WARNING,
  generateHandoffCode,
  handoffCodeDigest,
} from "@/lib/couranr/driver/codes";

assertServerOnly("lib/couranr/consumer/send.ts");

/**
 * The consumer /send backend (batch 3 §D).
 *
 * A GUEST SESSION is the whole identity: a 256-bit token minted server-side,
 * stored only as a SHA-256 hash, at most one delivery request per session.
 * Every command below re-verifies the session INSIDE SQL, and the request's
 * idempotency scope is derived from the session id in the database — the
 * browser never chooses a scope, an amount, a state or a target.
 *
 * SHIPMENT AUTHORITY IS SHARED, NOT COPIED. The estimate runs the SAME
 * canonical pipeline the Business portal uses — Place Details via
 * `resolveCanonicalGooglePlace`, route evidence via
 * `deriveCanonicalRouteAndQuote` (Mapbox Directions v5 traffic + the PR #38 market
 * classifier + Pricing V2), the deterministic shipment policy over
 * `factsFromDraft` — so PRC-005 parity (consumer surcharge 0, category has no
 * price effect) holds by construction: there is exactly one engine.
 *
 * CONSUMER AI (INT-002): deterministic STRUCTURED intake is the always-on
 * path — the free-text description is stored as request evidence
 * (normalized_request_payload.consumerDescription) and policy runs on the
 * structured facts only, so a delivery can always be priced and submitted
 * with no model in the loop. Consumer Smart Intake is OPTIONAL enrichment
 * layered on top, behind COURANR_CONSUMER_INTAKE=live and its own abuse
 * controls (lib/couranr/consumer/intake.ts): a guest's description may be
 * interpreted into PROPOSAL-only structured facts that the guest confirms by
 * an explicit form action. Model output never sets price, state, route or a
 * restricted outcome. This module imports intake only through
 * `./intake` — never a provider adapter — and only for that optional
 * evidence hook.
 */

export const RPC = {
  createSession: "couranr_create_consumer_guest_session",
  redeemSession: "couranr_redeem_consumer_guest_session",
  bindSession: "couranr_bind_consumer_guest_request",
  create: "couranr_create_consumer_delivery_request_draft",
  estimate: "couranr_calculate_consumer_delivery_request_estimate",
  submit: "couranr_submit_consumer_delivery_request",
  setReadiness: "couranr_set_consumer_pickup_readiness",
  createObligation: "couranr_create_payment_obligation",
  issueGuestPickupCode: "couranr_issue_guest_pickup_code_cas",
} as const;

/** Sessions live 24 hours; the SQL clamps to [5 min, 3 days] regardless. */
export const GUEST_SESSION_TTL_MINUTES = 1440;

/**
 * One request per session and the scope is the session, so the KEY can be a
 * constant: a replayed create converges on the session's own request, and two
 * sessions can never collide.
 */
export const CONSUMER_SEND_IDEMPOTENCY_KEY = "consumer-send-v0";

/** The header the consumer funnel authenticates with. Raw token, never a hash. */
export const GUEST_HEADER = "x-couranr-guest";

/** Mirrors what couranr_create_payment_obligation accepts. */
export const PAYABLE_REQUEST_STATES = [
  "awaiting_quote_acceptance",
  "confirmed",
  "quote_revision_required",
] as const;

export type ConsumerFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type ConsumerResult<T> = { ok: true; value: T } | ConsumerFailure;

/** `tsconfig` has `strict: false` globally, so `.ok` alone does not narrow. */
export function isConsumerFailure(r: { ok: boolean }): r is ConsumerFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): ConsumerFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: ConsumerFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<ConsumerResult<T>> {
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

/* --------------------------------------------------- forbidden body keys -- */

/**
 * Keys a consumer body may NEVER carry: anything stating a price, a state, a
 * target, a policy or route evidence. The server derives every one of those.
 * Matched case-insensitively with separators stripped (same probe shape as
 * `lib/couranr/requests/input.ts`, duplicated here deliberately — that module
 * belongs to the Business slice and this list also bans STATE keys, which the
 * business normalizer legitimately reads).
 */
export const FORBIDDEN_CONSUMER_KEYS = [
  // amounts
  "totalcents",
  "total",
  "amountcents",
  "amount",
  "pricecents",
  "price",
  "subtotal",
  "subtotalcents",
  "deliverysubtotalcents",
  "paymentduecents",
  "paymentdue",
  "quotelineitems",
  "lineitems",
  "cents",
  // states and targets
  "state",
  "requeststate",
  "reviewstate",
  "paymentstate",
  "targetstate",
  "quotestatus",
  // pricing policy and route evidence
  "pricingpolicyversion",
  "policyversion",
  "loadedmiles",
  "billableloadedmiles",
  "distancemeters",
  "routedistancemeters",
  "durationseconds",
  "trafficdelayseconds",
  "payertype",
] as const;

function canonicalKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z]/g, "");
}

/** Recursively looks for a forbidden key anywhere in an untrusted body. */
export function findForbiddenConsumerKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenConsumerKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_CONSUMER_KEYS as readonly string[]).includes(canonicalKey(k))) return k;
    const hit = findForbiddenConsumerKey(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------- guest sessions -- */

export type GuestSession = {
  id: string;
  requestId: string | null;
  expiresAt: string;
};

function sessionFromRow(row: any): GuestSession {
  return {
    id: String(row.id),
    requestId: row.request_id ? String(row.request_id) : null,
    expiresAt: String(row.expires_at),
  };
}

/**
 * Mint a guest session. The RAW token is returned exactly once — it is never
 * persisted, logged or recoverable; the database holds only its SHA-256 hash.
 */
export async function createGuestSession(): Promise<
  ConsumerResult<{ token: string; expiresAt: string }>
> {
  const op = "createGuestSession";
  const token = generateAccessToken();
  const r = await callRpc<any>(op, RPC.createSession, {
    p_token_hash: hashAccessToken(token),
    p_ttl_minutes: GUEST_SESSION_TTL_MINUTES,
  });
  if (isConsumerFailure(r)) return r;
  return { ok: true, value: { token, expiresAt: String(r.value.expires_at) } };
}

/**
 * Resolve a raw guest token. ONE uniform refusal: a malformed, unknown,
 * revoked or expired token is `not_found`, indistinguishably — probing tokens
 * reveals nothing.
 */
export async function redeemGuestSession(rawToken: unknown): Promise<ConsumerResult<GuestSession>> {
  const op = "redeemGuestSession";
  // Shape-checked BEFORE hashing: a hash is never computed over
  // attacker-shaped input and no lookup is attempted for it.
  if (!isWellFormedAccessToken(rawToken)) {
    return fail({ operation: op, code: "not_found", detail: { reason: "malformed token" } });
  }
  const r = await callRpc<any>(op, RPC.redeemSession, {
    p_token_hash: hashAccessToken(rawToken),
  });
  if (isConsumerFailure(r)) {
    // The SQL already refuses uniformly (CR404); collapse everything else too.
    return { ...r, code: "not_found" };
  }
  return { ok: true, value: sessionFromRow(r.value) };
}

/**
 * The route-side gate: redeems the raw guest token from the request header.
 * Shape-check before hashing, then the uniform SQL redemption — the name
 * carries the `redeem…Token` gate marker scripts/checkRoutes.mjs enforces.
 */
export async function redeemGuestSessionToken(
  req: NextRequest
): Promise<ConsumerResult<GuestSession>> {
  return redeemGuestSession(req.headers.get(GUEST_HEADER));
}

/* ------------------------------------------------------ body validation -- */

export type ConsumerSendBody = {
  pickupPlaceId: string;
  dropoffPlaceId: string;
  contact: { name: string | null; phone: string | null; email: string | null };
  shipment: {
    description: string | null;
    weightLb: number | null;
    weightBand: WeightBand | null;
    restrictedClass: RestrictedClassDeclaration;
    signatureRequired: boolean;
    overnightRequested: boolean;
  };
};

// Deliberately permissive: only rejects text that cannot be an address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type ConsumerSendBodyResult =
  | { ok: true; value: ConsumerSendBody }
  | { ok: false; reason: string };

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does.
 */
export function isConsumerSendBodyFailure(
  r: ConsumerSendBodyResult
): r is { ok: false; reason: string } {
  return r.ok === false;
}

export function validateConsumerSendBody(raw: unknown): ConsumerSendBodyResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  // Checked FIRST, over the WHOLE body: a payload carrying a price, a state
  // or route evidence is rejected outright, never partially accepted.
  const forbidden = findForbiddenConsumerKey(raw);
  if (forbidden) return { ok: false, reason: "forbidden_field" };

  const r = raw as Record<string, unknown>;
  const pickupPlaceId = str(r.pickupPlaceId);
  const dropoffPlaceId = str(r.dropoffPlaceId);
  if (!pickupPlaceId || !dropoffPlaceId) return { ok: false, reason: "place_ids_required" };

  const contactRaw =
    r.contact !== null && typeof r.contact === "object" && !Array.isArray(r.contact)
      ? (r.contact as Record<string, unknown>)
      : {};
  const email = str(contactRaw.email);
  if (email && !EMAIL_RE.test(email)) return { ok: false, reason: "contact_email_invalid" };
  const contact = { name: str(contactRaw.name), phone: str(contactRaw.phone), email };

  const shipRaw =
    r.shipment !== null && typeof r.shipment === "object" && !Array.isArray(r.shipment)
      ? (r.shipment as Record<string, unknown>)
      : {};

  // SUR-001 honesty: exact pounds when known, else a governed band. Nothing
  // converts one into the other and nothing invents a number.
  let weightLb: number | null = null;
  if (shipRaw.weightLb !== undefined && shipRaw.weightLb !== null && shipRaw.weightLb !== "") {
    const n = Number(shipRaw.weightLb);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "weight_invalid" };
    weightLb = n;
  }
  let weightBand: WeightBand | null = null;
  if (shipRaw.weightBand !== undefined && shipRaw.weightBand !== null && shipRaw.weightBand !== "") {
    if (!isWeightBand(shipRaw.weightBand)) return { ok: false, reason: "weight_band_invalid" };
    weightBand = shipRaw.weightBand;
  }
  if (weightLb === null && weightBand === null) return { ok: false, reason: "weight_required" };

  // The safety declaration. Absent means "unknown", and unknown means Couranr
  // review — never an automatic quote (the SQL enforces the same rule again).
  let restrictedClass: RestrictedClassDeclaration = "unknown";
  const rc = shipRaw.restrictedClass;
  if (rc !== undefined && rc !== null && rc !== "") {
    if (!isRestrictedClassDeclaration(rc)) return { ok: false, reason: "restricted_class_invalid" };
    restrictedClass = rc;
  }

  const description = str(shipRaw.description);
  return {
    ok: true,
    value: {
      pickupPlaceId,
      dropoffPlaceId,
      contact,
      shipment: {
        description: description ? description.slice(0, 2000) : null,
        weightLb,
        weightBand,
        restrictedClass,
        signatureRequired: shipRaw.signatureRequired === true,
        overnightRequested: shipRaw.overnightRequested === true,
      },
    },
  };
}

/* ----------------------------------------------------------- estimating -- */

export type ConsumerEstimate = {
  requestId: string;
  quoteStatus: string;
  /** Independent PRF-002 CAS token for expected-pickup edits. */
  pickupManifestVersion: number;
  /** Integer cents when the quote is automatic; null for review/invalid. */
  totalCents: number | null;
  lineItems: unknown[];
  reviewReasons: unknown[];
  quoteVersionId: string | null;
  /** QVL-001: when the 15-minute approval window closes; null when unpriced. */
  expiresAt: string | null;
};

/** Columns every scoped consumer read selects. Never `select("*")`. */
const OWN_REQUEST_COLUMNS =
  "id,version,request_state,quote_status,current_quote_version_id,pickup_manifest_version," +
  "delivery_subtotal_cents,quote_line_items,review_reasons,consumer_contact_snapshot";

/**
 * Load the session's own request — and ONLY it. `service_role` bypasses RLS,
 * so the scope in this query (id + requester_kind + the session-derived
 * idempotency scope) is the boundary, exactly as it is inside the SQL
 * commands.
 */
async function loadOwnRequest(
  operation: string,
  session: GuestSession
): Promise<ConsumerResult<Record<string, any>>> {
  if (!session.requestId) {
    return fail({ operation, code: "not_found", detail: { reason: "session has no request" } });
  }
  const { data, error } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select(OWN_REQUEST_COLUMNS)
    .eq("id", session.requestId)
    .eq("requester_kind", "consumer")
    .eq("idempotency_scope", `consumer:${session.id}`)
    .maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation, code: "internal", detail: { message: error.message } });
  }
  if (!data) {
    return fail({ operation, code: "not_found", detail: { reason: "own request missing" } });
  }
  return { ok: true, value: data };
}

async function quoteWindowExpiresAt(
  quoteVersionId: string | null,
  quoteStatus: string
): Promise<string | null> {
  if (!quoteVersionId || quoteStatus !== "estimated") return null;
  const { data } = (await supabaseAdmin
    .from("couranr_quote_versions")
    .select("created_at")
    .eq("id", quoteVersionId)
    .maybeSingle()) as { data: any; error: any };
  if (!data?.created_at) return null;
  // QVL-001: [0, 15:00) from mint. The database owns the clock; this is a
  // display hint, never the enforcement.
  return new Date(new Date(String(data.created_at)).getTime() + 15 * 60 * 1000).toISOString();
}

function estimateFromRow(row: Record<string, any>): Promise<ConsumerEstimate> {
  const quoteStatus = String(row.quote_status ?? "not_quoted");
  const quoteVersionId = row.current_quote_version_id ? String(row.current_quote_version_id) : null;
  return quoteWindowExpiresAt(quoteVersionId, quoteStatus).then((expiresAt) => ({
    requestId: String(row.id),
    quoteStatus,
    pickupManifestVersion: Number(row.pickup_manifest_version ?? 0),
    totalCents:
      quoteStatus === "estimated" && row.delivery_subtotal_cents !== null
        ? Number(row.delivery_subtotal_cents)
        : null,
    lineItems: Array.isArray(row.quote_line_items) ? row.quote_line_items : [],
    reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
    quoteVersionId,
    expiresAt,
  }));
}

/**
 * Price a consumer send. First call creates the session's draft (the SQL
 * binds the session in the same transaction); later calls re-estimate the
 * same request. Everything commercial — route, market, policy, Pricing V2 —
 * is derived server-side through the canonical shared pipeline.
 */
export async function estimateConsumerSend(params: {
  session: GuestSession;
  body: unknown;
}): Promise<ConsumerResult<ConsumerEstimate>> {
  const op = "estimateConsumerSend";

  const parsed = validateConsumerSendBody(params.body);
  if (isConsumerSendBodyFailure(parsed)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: parsed.reason },
      message: "Some delivery details need attention before this can be priced.",
    });
  }
  const body = parsed.value;

  let routed: Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>;
  try {
    routed = await deriveCanonicalRouteAndQuote({
      pickupAddress: { googlePlaceId: body.pickupPlaceId },
      dropoffAddress: { googlePlaceId: body.dropoffPlaceId },
      weightLb: body.shipment.weightLb,
      weightBand: body.shipment.weightBand,
      additionalStops: 0,
      // Fixed by the funnel, never read from the body (M6 / PRC-005 / PRF-001).
      serviceLevel: "standard",
      signatureRequired: body.shipment.signatureRequired,
      overnightRequested: body.shipment.overnightRequested,
      timingIntent: "asap",
      requestedPickupLocal: null,
    });
  } catch (error) {
    if (isCanonicalAddressResolutionError(error)) {
      return fail({
        operation: op,
        code: "invalid_input",
        detail: { field: error.field, reason: error.reason },
        message: "Couranr could not verify one of the selected addresses.",
      });
    }
    return fail({ operation: op, code: "internal", detail: error });
  }

  // DETERMINISTIC STRUCTURED pricing/safety — the SAME policy the business
  // path runs, over the guest's structured statement, and the ALWAYS-ON path
  // that needs no model. The guest's OWN item description runs through the
  // existing deterministic scanRestrictedSignals lexicon (no second scanner).
  // Text signals are ESCALATION ONLY by the policy engine's design: a
  // declaration of 'none' that conflicts with a material signal becomes
  // needs_review (no payable quote), and text alone can never produce
  // 'prohibited' — only a confirmed prohibited declaration does. Consumer
  // Smart Intake (INT-002) is a separate, optional enrichment layer and never
  // reaches this pricing/safety path.
  const textSignals = scanRestrictedSignals(body.shipment.description ?? "");
  const policy = evaluateShipmentPolicy(
    factsFromDraft({
      weightLb: body.shipment.weightLb,
      weightBand: body.shipment.weightBand,
      restrictedClass: body.shipment.restrictedClass,
      serviceLevel: "standard",
      timingIntent: "asap",
      requestedPickupLocal: null,
    }),
    { textSignals }
  );
  const quote: QuoteResult = applyShipmentPolicyToQuote(routed.quote, policy);

  // Input-invalid is refused; a policy-prohibited `invalid` quote (zero
  // validation errors) is PERSISTED — "Couranr cannot carry this" belongs on
  // the record. Same split as the business command layer.
  if (quote.quoteStatus === "invalid" && quote.validationErrors.length > 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: quote.validationErrors,
      message: "These shipment details cannot be priced.",
    });
  }

  const sharedArgs = {
    p_shipment_description: body.shipment.description,
    p_recipient_name: null as string | null,
    p_recipient_phone: null as string | null,
    p_recipient_email: null as string | null,
    p_weight_lb: body.shipment.weightLb,
    p_weight_band: body.shipment.weightBand,
    p_restricted_class: body.shipment.restrictedClass,
    p_additional_stops: 0,
    // Fixed by the funnel: service level 'standard', proof 'photo_or_pin'.
    p_service_level: "standard",
    p_signature_required: body.shipment.signatureRequired,
    p_proof_method: "photo_or_pin",
    p_pickup_address: routed.pickupAddress,
    p_dropoff_address: routed.dropoffAddress,
    p_overnight_requested: body.shipment.overnightRequested,
    ...routeArgs(routed.route),
    ...timingArgs(routed.timing),
    ...quoteArgs(quote),
  };

  let result: ConsumerResult<Record<string, any>>;
  if (params.session.requestId === null) {
    result = await callRpc<Record<string, any>>(op, RPC.create, {
      p_guest_session_id: params.session.id,
      p_idempotency_key: CONSUMER_SEND_IDEMPOTENCY_KEY,
      p_contact: {
        name: body.contact.name,
        phone: body.contact.phone,
        email: body.contact.email,
      },
      ...sharedArgs,
    });
  } else {
    const loaded = await loadOwnRequest(op, params.session);
    if (isConsumerFailure(loaded)) return loaded;
    // Mirrors the SQL gate: re-pricing is the consumer's own recovery seam
    // up to (and including) awaiting payer authorization — never past
    // authorization, never once Couranr review begins.
    if (!["draft", "awaiting_quote_acceptance"].includes(String(loaded.value.request_state))) {
      return fail({
        operation: op,
        code: "wrong_state",
        detail: { from: loaded.value.request_state },
        message: "This delivery has already been submitted and can no longer be re-priced.",
      });
    }
    result = await callRpc<Record<string, any>>(op, RPC.estimate, {
      p_request_id: params.session.requestId,
      p_guest_session_id: params.session.id,
      p_expected_version: Number(loaded.value.version),
      p_update_shipment: true,
      ...sharedArgs,
    });
  }
  if (isConsumerFailure(result)) return result;

  // INT-002: the guest's FORM statement becomes the confirmed intake facts —
  // the trusted-actor trail beside the AI proposals. Enrichment never blocks
  // the money path: the hook logs and swallows its own failures.
  await recordConsumerIntakeEvidenceAfterEstimate({
    session: params.session,
    requestId: String(result.value.id),
    statement: {
      weightLb: body.shipment.weightLb,
      weightBand: body.shipment.weightBand,
      restrictedClass: body.shipment.restrictedClass,
    },
  });

  return { ok: true, value: await estimateFromRow(result.value) };
}

/**
 * Re-price the session's OWN request from its STORED canonical facts (final
 * closure pass §5). A resumed page has lost the original form inputs, so a
 * QVL-expired quote cannot be honestly refreshed by re-posting local state —
 * this command rebuilds the estimate entirely from what the request already
 * carries: the stored canonical address snapshots (their Google place
 * identities), the stored weight statement, declaration and description.
 * Nothing is fabricated, no second request is minted, and the same SQL gate
 * applies: draft or awaiting_quote_acceptance only.
 */
export async function refreshConsumerSendQuote(params: {
  session: GuestSession;
}): Promise<ConsumerResult<ConsumerEstimate>> {
  const op = "refreshConsumerSendQuote";
  if (!params.session.requestId) {
    return fail({ operation: op, code: "not_found", detail: { reason: "session has no request" } });
  }
  const { data: row, error } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select(
      OWN_REQUEST_COLUMNS +
        ",pickup_address,dropoff_address,weight_lb,weight_band,restricted_class," +
        "signature_required,additional_stops,normalized_request_payload"
    )
    .eq("id", params.session.requestId)
    .eq("requester_kind", "consumer")
    .eq("idempotency_scope", `consumer:${params.session.id}`)
    .maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { message: error.message } });
  }
  if (!row) {
    return fail({ operation: op, code: "not_found", detail: { reason: "own request missing" } });
  }
  if (!["draft", "awaiting_quote_acceptance"].includes(String(row.request_state))) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: row.request_state },
      message: "This delivery has already been submitted and can no longer be re-priced.",
    });
  }

  const pickupPlaceId = row.pickup_address?.googlePlaceId;
  const dropoffPlaceId = row.dropoff_address?.googlePlaceId;
  if (typeof pickupPlaceId !== "string" || !pickupPlaceId || typeof dropoffPlaceId !== "string" || !dropoffPlaceId) {
    // Missing authoritative inputs are a refusal, never an invention.
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "stored_route_facts_missing" },
      message: "This request's stored addresses cannot be re-priced automatically. Start a fresh estimate.",
    });
  }

  const payload = row.normalized_request_payload ?? {};
  const description =
    typeof payload.consumerDescription === "string" ? payload.consumerDescription : null;
  const overnightRequested = payload.overnightRequested === true;
  const weightLb = row.weight_lb === null || row.weight_lb === undefined ? null : Number(row.weight_lb);
  const weightBand = isWeightBand(row.weight_band) ? row.weight_band : null;
  const restrictedClass = String(row.restricted_class ?? "unknown");
  const signatureRequired = Boolean(row.signature_required);
  const additionalStops = Number(row.additional_stops ?? 0);

  let routed: Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>;
  try {
    routed = await deriveCanonicalRouteAndQuote({
      pickupAddress: row.pickup_address,
      dropoffAddress: row.dropoff_address,
      weightLb,
      weightBand,
      additionalStops,
      serviceLevel: "standard",
      signatureRequired,
      overnightRequested,
      timingIntent: "asap",
      requestedPickupLocal: null,
    });
  } catch (refreshError) {
    if (isCanonicalAddressResolutionError(refreshError)) {
      return fail({
        operation: op,
        code: "conflict",
        detail: { field: refreshError.field, reason: refreshError.reason },
        message: "Couranr could not re-verify this request's stored addresses.",
      });
    }
    return fail({ operation: op, code: "internal", detail: refreshError });
  }

  // The SAME safety parity as a fresh estimate: the stored description runs
  // the deterministic scanner into the policy engine, escalation-only.
  const textSignals = scanRestrictedSignals(description ?? "");
  const policy = evaluateShipmentPolicy(
    factsFromDraft({
      weightLb,
      weightBand,
      restrictedClass,
      serviceLevel: "standard",
      timingIntent: "asap",
      requestedPickupLocal: null,
    } as Parameters<typeof factsFromDraft>[0]),
    { textSignals }
  );
  const quote: QuoteResult = applyShipmentPolicyToQuote(routed.quote, policy);

  const result = await callRpc<Record<string, any>>(op, RPC.estimate, {
    p_request_id: params.session.requestId,
    p_guest_session_id: params.session.id,
    p_expected_version: Number(row.version),
    // Shipment facts are already the stored truth; only the quote refreshes.
    p_update_shipment: false,
    p_shipment_description: description,
    p_recipient_name: null as string | null,
    p_recipient_phone: null as string | null,
    p_recipient_email: null as string | null,
    p_weight_lb: weightLb,
    p_weight_band: weightBand,
    p_restricted_class: restrictedClass,
    p_additional_stops: additionalStops,
    p_service_level: "standard",
    p_signature_required: signatureRequired,
    p_proof_method: "photo_or_pin",
    p_pickup_address: routed.pickupAddress,
    p_dropoff_address: routed.dropoffAddress,
    p_overnight_requested: overnightRequested,
    ...routeArgs(routed.route),
    ...timingArgs(routed.timing),
    ...quoteArgs(quote),
  });
  if (isConsumerFailure(result)) return result;

  return { ok: true, value: await estimateFromRow(result.value) };
}

/* ------------------------------------------------------------- readiness -- */

/**
 * Record the guest's EXPLICIT pickup-readiness declaration on the same
 * canonical readiness_state Business uses (FND-006). This is deliberately
 * allowed before payment/review: readiness describes the package, not money.
 * Commercial settlement still gates planning in the lifecycle/SQL planner.
 *
 * The guest session is the authority boundary. The SQL re-verifies the
 * session/request binding and refuses terminal requests, so no browser can
 * name another request or a target outside the closed ready/not_ready pair.
 */
export async function setConsumerPickupReadiness(params: {
  session: GuestSession;
  readiness: "ready" | "not_ready";
}): Promise<ConsumerResult<{ readinessState: string; requestVersion: number }>> {
  const op = "setConsumerPickupReadiness";
  if (!params.session.requestId) {
    return fail({ operation: op, code: "not_found", detail: { reason: "session has no request" } });
  }
  if (params.readiness !== "ready" && params.readiness !== "not_ready") {
    return fail({ operation: op, code: "invalid_input", detail: { readiness: params.readiness } });
  }

  const r = await callRpc<Record<string, any>>(op, RPC.setReadiness, {
    p_guest_session_id: params.session.id,
    p_readiness: params.readiness,
  });
  if (isConsumerFailure(r)) return r;

  return {
    ok: true,
    value: {
      readinessState: String(r.value.readiness_state),
      requestVersion: Number(r.value.version),
    },
  };
}

/* ------------------------------------------------------------ submitting -- */

export async function submitConsumerSend(params: {
  session: GuestSession;
}): Promise<ConsumerResult<{ state: string }>> {
  const op = "submitConsumerSend";
  const loaded = await loadOwnRequest(op, params.session);
  if (isConsumerFailure(loaded)) return loaded;

  // Field-level pre-check with an actionable message. The SQL refuses the
  // same condition again (CR422 consumer_contact_required) as the backstop —
  // the snapshot is frozen at creation, so a contactless draft needs a fresh
  // session; this cannot be repaired in place.
  const contact = loaded.value.consumer_contact_snapshot ?? {};
  const hasPhone = typeof contact.phone === "string" && contact.phone.trim() !== "";
  const hasEmail = typeof contact.email === "string" && contact.email.trim() !== "";
  if (!hasPhone && !hasEmail) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "consumer_contact_required" },
      message: "Add a phone number or email so Couranr can reach you about this delivery.",
    });
  }

  const r = await callRpc<Record<string, any>>(op, RPC.submit, {
    p_request_id: params.session.requestId,
    p_guest_session_id: params.session.id,
    p_expected_version: Number(loaded.value.version),
  });
  if (isConsumerFailure(r)) return r;
  return { ok: true, value: { state: String(r.value.request_state) } };
}

/* ------------------------------------------------------------ the view --- */

export type ConsumerSendView = {
  state: string;
  quoteStatus: string;
  totalCents: number | null;
  paymentState: string | null;
  /** Present EXACTLY ONCE: the first read after confirmation mints the link. */
  trackingToken?: string;
};

/** The live obligation for the session's request. Consumer rows only. */
async function loadOwnObligation(
  operation: string,
  session: GuestSession
): Promise<ConsumerResult<Record<string, any> | null>> {
  // `.is("business_account_id", null)` is the consumer tenant filter — the
  // documented getObligationForRequest(businessAccountId: null) shape SKIPS
  // the filter entirely, which is the known warning this avoids.
  const { data, error } = (await supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id,request_id,payment_state,amount_cents,currency,provider_payment_intent_id,version")
    .eq("request_id", String(session.requestId))
    .is("business_account_id", null)
    .neq("payment_state", "cancelled")
    .maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation, code: "internal", detail: { message: error.message } });
  }
  return { ok: true, value: data ?? null };
}

/**
 * The guest's own-request projection. When the request reaches `confirmed`
 * and no live tracking link exists, ONE is minted here and the raw token is
 * returned this once — it is never recoverable afterwards.
 */
export async function getConsumerSendView(params: {
  session: GuestSession;
}): Promise<ConsumerResult<ConsumerSendView>> {
  const op = "getConsumerSendView";
  const loaded = await loadOwnRequest(op, params.session);
  if (isConsumerFailure(loaded)) return loaded;
  const row = loaded.value;

  const ob = await loadOwnObligation(op, params.session);
  if (isConsumerFailure(ob)) return ob;

  const view: ConsumerSendView = {
    state: String(row.request_state),
    quoteStatus: String(row.quote_status ?? "not_quoted"),
    totalCents:
      row.quote_status === "estimated" && row.delivery_subtotal_cents !== null
        ? Number(row.delivery_subtotal_cents)
        : null,
    paymentState: ob.value ? String(ob.value.payment_state) : null,
  };

  if (row.request_state === "confirmed") {
    const { count, error } = (await supabaseAdmin
      .from("couranr_delivery_access_tokens")
      .select("id", { count: "exact", head: true })
      .eq("request_id", String(row.id))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())) as { count: number | null; error: any };
    if (error) {
      return fail({ operation: op, code: "internal", detail: { message: error.message } });
    }
    if ((count ?? 0) === 0) {
      const issued = await issueTrackingLink({ requestId: String(row.id) });
      if (isTrackingFailure(issued)) return issued;
      view.trackingToken = issued.value.token;
    }
  }

  return { ok: true, value: view };
}

/* ------------------------------------------- sender pickup credential --- */

export type ConsumerPickupCredential = {
  deliveryId: string;
  code: string;
  generation: number;
  expiresAt: string;
  warning: string;
};

/**
 * Sender-held credential for this guest session's one delivery.
 *
 * It is never sent to the assigned driver. The raw six digits exist only in
 * this response and in whatever the sender displays/reads at physical handoff.
 */
export async function issueConsumerPickupCredential(params: {
  session: GuestSession;
}): Promise<ConsumerResult<ConsumerPickupCredential>> {
  const op = "issueConsumerPickupCredential";
  if (!params.session.requestId) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "session_not_bound" },
      message: "Couranr has not created this delivery yet.",
    });
  }

  const { data: delivery, error: deliveryError } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,request_id,fulfillment_state")
    .eq("request_id", params.session.requestId)
    .maybeSingle()) as { data: any; error: any };
  if (deliveryError) {
    return fail({ operation: op, code: "internal", detail: deliveryError.message });
  }
  if (!delivery?.id) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "delivery_not_created" },
      message: "The pickup code will be available after Couranr schedules the delivery.",
    });
  }

  const MAX_GENERATION_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const { data: current, error: generationError } = (await supabaseAdmin
      .from("couranr_handoff_codes")
      .select("generation")
      .eq("delivery_id", String(delivery.id))
      .eq("code_kind", "merchant_pickup")
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
        kind: "merchant_pickup",
        deliveryId: String(delivery.id),
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

    const { data, error } = (await supabaseAdmin.rpc(RPC.issueGuestPickupCode, {
      p_delivery_id: String(delivery.id),
      p_expected_generation: generation,
      p_code_digest: digest,
      p_guest_session_id: params.session.id,
      p_ttl_minutes: 1440,
    })) as { data: any; error: any };

    if (error) {
      if (error.code === "CR409" && error.message === "handoff_generation_conflict") {
        continue;
      }
      return fail({
        operation: op,
        code: classifyDatabaseError(error),
        detail: { code: error.code, message: error.message },
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
        deliveryId: String(delivery.id),
        code,
        generation,
        expiresAt: String(data.expires_at),
        warning: CODE_SHOWN_ONCE_WARNING,
      },
    };
  }

  return fail({
    operation: op,
    code: "conflict",
    detail: { reason: "handoff_generation_contention" },
    message: "The pickup code changed at the same time. Try again.",
  });
}

/* --------------------------------------------------------------- paying --- */

/**
 * Start payment for the session's request — ONLY while it is in a payable
 * state. Under CAP-001 (review item 2) that is BEFORE Couranr review for an
 * automatic estimated quote: submit lands in `awaiting_quote_acceptance`,
 * the consumer authorizes, and only then does the request enter Couranr
 * review. `quote_revision_required` re-opens payment for the revised price.
 * Amounts come from the stored obligation, never from any caller.
 */
export async function payConsumerSend(params: {
  session: GuestSession;
}): Promise<ConsumerResult<{ clientSecret: string; amountCents: number }>> {
  const op = "payConsumerSend";
  const loaded = await loadOwnRequest(op, params.session);
  if (isConsumerFailure(loaded)) return loaded;
  const state = String(loaded.value.request_state);
  if (!(PAYABLE_REQUEST_STATES as readonly string[]).includes(state)) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: state },
      message:
        state === "pending_couranr_review"
          ? "Couranr is reviewing this delivery. Nothing more is needed from you right now."
          : "This delivery is not ready for payment.",
    });
  }

  // The session binding IS the authorization; the SQL scopes by
  // `business_account_id is not distinct from null` and copies the request's
  // NULL business onto the obligation.
  const obligation = await callRpc<Record<string, any>>(op, RPC.createObligation, {
    p_request_id: params.session.requestId,
    p_business_account_id: null,
    p_idempotency_key: `consumer:${params.session.id}`,
  });
  if (isConsumerFailure(obligation)) return obligation;
  if (obligation.value.business_account_id !== null) {
    // Cannot happen for a consumer request (tenancy CHECK); fail closed.
    return fail({ operation: op, code: "internal", detail: { reason: "tenanted obligation" } });
  }

  const intent = await ensurePaymentIntent({ obligation: obligation.value });
  if (isPaymentFailure(intent)) return intent;

  return {
    ok: true,
    value: {
      clientSecret: intent.value.clientSecret,
      amountCents: Number(intent.value.obligation.amount_cents),
    },
  };
}

/**
 * Discard the browser's claim and ask Stripe what actually happened —
 * the same reconcile the payment-link page runs.
 */
export async function reconcileConsumerPayment(params: {
  session: GuestSession;
}): Promise<ConsumerResult<{ outcome: string; paymentState: string | null }>> {
  const op = "reconcileConsumerPayment";
  const loaded = await loadOwnRequest(op, params.session);
  if (isConsumerFailure(loaded)) return loaded;

  const ob = await loadOwnObligation(op, params.session);
  if (isConsumerFailure(ob)) return ob;
  if (!ob.value || !ob.value.provider_payment_intent_id) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "no intent to reconcile" },
      message: "There is no payment to verify yet.",
    });
  }

  const r = await reconcilePaymentIntent({
    intentId: String(ob.value.provider_payment_intent_id),
    obligationVersion: Number(ob.value.version),
  });
  if (isPaymentFailure(r)) return r;
  return {
    ok: true,
    value: { outcome: r.value.outcome, paymentState: r.value.payment_state },
  };
}

/* --------------------------------------------------- places autocomplete -- */

const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

export type PlaceSuggestion = { placeId: string; text: string };

/**
 * Server-side Places (New) Autocomplete for the guest funnel. The guest gets
 * suggestions and hands back a Place ID; the ID is verified again by Place
 * Details inside the estimate pipeline, so nothing here is authority.
 *
 * Degrades to an EMPTY list on provider trouble (logged under a correlation
 * id) — an autocomplete outage must not 500 the typing experience, and an
 * empty list cannot mint anything.
 */
export async function autocompleteConsumerPlaces(
  rawQuery: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<ConsumerResult<{ suggestions: PlaceSuggestion[] }>> {
  const op = "autocompleteConsumerPlaces";
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (query.length < 3 || query.length > 120) {
    return { ok: true, value: { suggestions: [] } };
  }
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    fail({ operation: op, code: "internal", detail: { reason: "places not configured" } });
    return { ok: true, value: { suggestions: [] } };
  }

  const spend = await claimPaidApiCall("google_places_autocomplete", fetchImpl);
  if (!spend.allowed) {
    return { ok: true, value: { suggestions: [] } };
  }

  let payload: any;
  try {
    const response = await fetchImpl(PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({ input: query, includedRegionCodes: ["US"] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      fail({ operation: op, code: "internal", detail: { status: response.status } });
      return { ok: true, value: { suggestions: [] } };
    }
    payload = await response.json();
  } catch (error) {
    fail({ operation: op, code: "internal", detail: error });
    return { ok: true, value: { suggestions: [] } };
  }

  const raw = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const suggestions: PlaceSuggestion[] = [];
  for (const item of raw.slice(0, 5)) {
    const placeId = item?.placePrediction?.placeId;
    const text = item?.placePrediction?.text?.text;
    if (typeof placeId === "string" && placeId && typeof text === "string" && text) {
      suggestions.push({ placeId, text });
    }
  }
  return { ok: true, value: { suggestions } };
}
