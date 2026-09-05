import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
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
import type { ReadinessState } from "@/lib/couranr/requests/states";
import { issueTrackingLink, isTrackingFailure } from "@/lib/couranr/tracking/commands";

assertServerOnly("lib/couranr/hosted/commands.ts");

export const HOSTED_REQUEST_HEADER = "x-couranr-hosted-request";
export const HOSTED_REQUEST_TTL_MINUTES = 1440;

const RPC = {
  resolveMerchant: "couranr_resolve_hosted_request_merchant",
  createIntake: "couranr_create_hosted_request_intake",
  redeemIntake: "couranr_redeem_hosted_request_intake",
  createRequest: "couranr_create_hosted_delivery_request",
  validateRequest: "couranr_validate_hosted_delivery_request",
  beginPreparation: "couranr_begin_hosted_delivery_preparation",
  markReady: "couranr_mark_hosted_delivery_ready",
  markNotReady: "couranr_mark_hosted_delivery_not_ready",
  markUnavailable: "couranr_mark_hosted_delivery_unavailable",
} as const;

export type HostedFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type HostedResult<T> = { ok: true; value: T } | HostedFailure;

export function isHostedFailure(r: { ok: boolean }): r is HostedFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): HostedFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: HostedFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<HostedResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as {
    data: any;
    error: any;
  };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({
      operation,
      code: "conflict",
      detail: { fn, reason: "no result returned" },
    });
  }
  return { ok: true, value: data as T };
}

function one<T = any>(value: any): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return value ? (value as T) : null;
}

function cleanSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  return slug;
}

export type HostedMerchant = {
  businessAccountId: string;
  name: string;
  slug: string;
};

export async function resolveHostedMerchant(
  rawSlug: unknown
): Promise<HostedResult<HostedMerchant>> {
  const op = "resolveHostedMerchant";
  const slug = cleanSlug(rawSlug);
  if (!slug) {
    return fail({ operation: op, code: "not_found", detail: { reason: "slug" } });
  }
  const r = await callRpc<any>(op, RPC.resolveMerchant, { p_slug: slug });
  if (isHostedFailure(r)) return r;
  const row = one<any>(r.value);
  if (!row?.business_account_id) {
    return fail({ operation: op, code: "not_found", detail: { slug } });
  }
  return {
    ok: true,
    value: {
      businessAccountId: String(row.business_account_id),
      name: String(row.business_name ?? "Business"),
      slug: String(row.slug ?? slug),
    },
  };
}

export type HostedSession = {
  id: string;
  hostBusinessAccountId: string;
  slug: string;
  requestId: string | null;
  expiresAt: string;
};

function sessionFromRow(row: any): HostedSession {
  return {
    id: String(row.id),
    hostBusinessAccountId: String(row.host_business_account_id),
    slug: String(row.host_slug_snapshot),
    requestId: row.request_id ? String(row.request_id) : null,
    expiresAt: String(row.expires_at),
  };
}

export async function createHostedSession(
  rawSlug: unknown
): Promise<HostedResult<{ token: string; expiresAt: string }>> {
  const op = "createHostedSession";
  const slug = cleanSlug(rawSlug);
  if (!slug) return fail({ operation: op, code: "not_found" });

  const token = generateAccessToken();
  const r = await callRpc<any>(op, RPC.createIntake, {
    p_slug: slug,
    p_token_hash: hashAccessToken(token),
    p_ttl_minutes: HOSTED_REQUEST_TTL_MINUTES,
  });
  if (isHostedFailure(r)) return r;
  const row = one<any>(r.value);
  if (!row?.id) return fail({ operation: op, code: "conflict" });
  return {
    ok: true,
    value: { token, expiresAt: String(row.expires_at) },
  };
}

export async function redeemHostedSession(
  rawToken: unknown,
  rawSlug: unknown
): Promise<HostedResult<HostedSession>> {
  const op = "redeemHostedSession";
  const slug = cleanSlug(rawSlug);
  if (!slug || !isWellFormedAccessToken(rawToken)) {
    return fail({ operation: op, code: "not_found", detail: { reason: "shape" } });
  }
  const r = await callRpc<any>(op, RPC.redeemIntake, {
    p_token_hash: hashAccessToken(rawToken),
    p_slug: slug,
  });
  if (isHostedFailure(r)) return { ...r, code: "not_found" };
  const row = one<any>(r.value);
  if (!row?.id) return fail({ operation: op, code: "not_found" });
  return { ok: true, value: sessionFromRow(row) };
}

export async function redeemHostedSessionToken(
  req: NextRequest,
  slug: string
): Promise<HostedResult<HostedSession>> {
  return redeemHostedSession(req.headers.get(HOSTED_REQUEST_HEADER), slug);
}

/* ---------------------------------------------------------------- input */

const FORBIDDEN_KEYS = [
  "businessaccountid",
  "hostbusinessaccountid",
  "pickupplaceid",
  "pickupaddress",
  "payertype",
  "price",
  "pricecents",
  "amount",
  "amountcents",
  "total",
  "totalcents",
  "subtotal",
  "subtotalcents",
  "deliverysubtotalcents",
  "paymentduecents",
  "quotelineitems",
  "quotestatus",
  "pricingpolicyversion",
  "policyversion",
  "requeststate",
  "reviewstate",
  "paymentstate",
  "targetstate",
  "loadedmiles",
  "billableloadedmiles",
  "distancemeters",
  "routedistancemeters",
  "durationseconds",
  "trafficdelayseconds",
  "latitude",
  "longitude",
] as const;

function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

export function findForbiddenHostedKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenHostedKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_KEYS as readonly string[]).includes(canonicalKey(key))) return key;
    const hit = findForbiddenHostedKey(child, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type HostedSubmitBody = {
  orderReference: string | null;
  requestedPayer: "merchant" | "customer";
  destinationPlaceId: string;
  destinationLabel: string;
  recipient: { name: string; phone: string | null; email: string | null };
  shipment: {
    description: string | null;
    weightLb: number | null;
    weightBand: WeightBand | null;
    restrictedClass: RestrictedClassDeclaration;
    signatureRequired: boolean;
  };
};

export type HostedBodyResult =
  | { ok: true; value: HostedSubmitBody }
  | { ok: false; reason: string };

export function isHostedBodyFailure(
  r: HostedBodyResult
): r is { ok: false; reason: string } {
  return r.ok === false;
}

export function validateHostedSubmitBody(raw: unknown): HostedBodyResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  if (findForbiddenHostedKey(raw)) return { ok: false, reason: "forbidden_field" };

  const body = raw as Record<string, unknown>;
  const destinationPlaceId = str(body.destinationPlaceId, 300);
  const destinationLabel = str(body.destinationLabel, 500);
  if (!destinationPlaceId || !destinationLabel) {
    return { ok: false, reason: "destination_required" };
  }

  const requestedPayer =
    body.requestedPayer === "merchant" || body.requestedPayer === "customer"
      ? body.requestedPayer
      : null;
  if (!requestedPayer) return { ok: false, reason: "requested_payer_invalid" };

  const recipientRaw =
    body.recipient && typeof body.recipient === "object" && !Array.isArray(body.recipient)
      ? (body.recipient as Record<string, unknown>)
      : {};
  const name = str(recipientRaw.name, 200);
  const phone = str(recipientRaw.phone, 100);
  const email = str(recipientRaw.email, 320);
  if (!name || (!phone && !email)) return { ok: false, reason: "recipient_contact_required" };
  if (email && !EMAIL_RE.test(email)) return { ok: false, reason: "recipient_email_invalid" };

  const shipmentRaw =
    body.shipment && typeof body.shipment === "object" && !Array.isArray(body.shipment)
      ? (body.shipment as Record<string, unknown>)
      : {};

  let weightLb: number | null = null;
  if (
    shipmentRaw.weightLb !== undefined &&
    shipmentRaw.weightLb !== null &&
    shipmentRaw.weightLb !== ""
  ) {
    const parsed = Number(shipmentRaw.weightLb);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, reason: "weight_invalid" };
    }
    weightLb = parsed;
  }

  let weightBand: WeightBand | null = null;
  if (
    shipmentRaw.weightBand !== undefined &&
    shipmentRaw.weightBand !== null &&
    shipmentRaw.weightBand !== ""
  ) {
    if (!isWeightBand(shipmentRaw.weightBand)) {
      return { ok: false, reason: "weight_band_invalid" };
    }
    weightBand = shipmentRaw.weightBand;
  }
  if (weightLb === null && weightBand === null) {
    return { ok: false, reason: "weight_required" };
  }

  let restrictedClass: RestrictedClassDeclaration = "unknown";
  if (
    shipmentRaw.restrictedClass !== undefined &&
    shipmentRaw.restrictedClass !== null &&
    shipmentRaw.restrictedClass !== ""
  ) {
    if (!isRestrictedClassDeclaration(shipmentRaw.restrictedClass)) {
      return { ok: false, reason: "restricted_class_invalid" };
    }
    restrictedClass = shipmentRaw.restrictedClass;
  }

  return {
    ok: true,
    value: {
      orderReference: str(body.orderReference, 120),
      requestedPayer,
      destinationPlaceId,
      destinationLabel,
      recipient: { name, phone, email },
      shipment: {
        description: str(shipmentRaw.description, 2000),
        weightLb,
        weightBand,
        restrictedClass,
        signatureRequired: shipmentRaw.signatureRequired === true,
      },
    },
  };
}

/* ---------------------------------------------------------- public write */

export async function submitHostedRequest(params: {
  session: HostedSession;
  body: HostedSubmitBody;
}): Promise<HostedResult<{ requestState: string }>> {
  const op = "submitHostedRequest";
  const r = await callRpc<any>(op, RPC.createRequest, {
    p_intake_id: params.session.id,
    p_order_reference: params.body.orderReference,
    p_requested_payer_type: params.body.requestedPayer,
    p_destination_place_id: params.body.destinationPlaceId,
    p_destination_label: params.body.destinationLabel,
    p_recipient_name: params.body.recipient.name,
    p_recipient_phone: params.body.recipient.phone,
    p_recipient_email: params.body.recipient.email,
    p_weight_lb: params.body.shipment.weightLb,
    p_weight_band: params.body.shipment.weightBand,
    p_customer_restricted_class: params.body.shipment.restrictedClass,
    p_signature_requested: params.body.shipment.signatureRequired,
    p_shipment_description: params.body.shipment.description,
  });
  if (isHostedFailure(r)) return r;
  const row = one<any>(r.value);
  return {
    ok: true,
    value: { requestState: String(row?.request_state ?? "awaiting_merchant_confirmation") },
  };
}

export type HostedPublicRequestView = {
  submitted: boolean;
  requestState: string | null;
  quoteStatus: string | null;
  merchantValidated: boolean;
  paymentPending: boolean;
  terminal: boolean;
  /** Returned only once when the confirmed request gets its first live tracking link. */
  trackingToken?: string;
};

export async function readHostedRequest(
  session: HostedSession
): Promise<HostedResult<HostedPublicRequestView>> {
  const op = "readHostedRequest";
  if (!session.requestId) {
    return {
      ok: true,
      value: {
        submitted: false,
        requestState: null,
        quoteStatus: null,
        merchantValidated: false,
        paymentPending: false,
        terminal: false,
      },
    };
  }

  const { data, error } = await supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id,request_state,quote_status,source,requester_kind,business_account_id")
    .eq("id", session.requestId)
    .eq("source", "hosted_request")
    .eq("requester_kind", "consumer")
    .is("business_account_id", null)
    .maybeSingle();

  if (error || !data) {
    return fail({
      operation: op,
      code: error ? classifyDatabaseError(error) : "not_found",
      detail: error?.message,
    });
  }

  const state = String((data as any).request_state);
  const value: HostedPublicRequestView = {
    submitted: true,
    requestState: state,
    quoteStatus: String((data as any).quote_status),
    merchantValidated: state !== "awaiting_merchant_confirmation",
    paymentPending:
      state === "awaiting_quote_acceptance" || state === "quote_revision_required",
    terminal: ["declined", "cancelled", "closed"].includes(state),
  };

  /*
   * The hosted session is the customer's authorization to THIS one request,
   * exactly like the /send guest session. Once confirmed, mint one tracking
   * credential if no live one exists. This makes the short-lived hosted intake
   * hand off to the 30-day, one-delivery tracking surface instead of stranding
   * the customer after the 24-hour intake session expires.
   */
  if (state === "confirmed") {
    const { count, error: tokenError } = (await supabaseAdmin
      .from("couranr_delivery_access_tokens")
      .select("id", { count: "exact", head: true })
      .eq("request_id", String((data as any).id))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())) as {
        count: number | null;
        error: any;
      };
    if (tokenError) {
      return fail({ operation: op, code: "internal", detail: tokenError.message });
    }
    if ((count ?? 0) === 0) {
      const issued = await issueTrackingLink({ requestId: String((data as any).id) });
      if (isTrackingFailure(issued)) {
        return fail({
          operation: op,
          code: issued.code,
          detail: { correlationId: issued.correlationId },
          message: issued.message,
        });
      }
      value.trackingToken = issued.value.token;
    }
  }

  return { ok: true, value };
}

/* ------------------------------------------------------ merchant context */

export type HostedMerchantContext = {
  orderReference: string | null;
  requestedPayerType: "merchant" | "customer" | null;
  destinationLabel: string | null;
  shipmentDescription: string | null;
  customerWeightLb: number | null;
  customerWeightBand: WeightBand | null;
  customerRestrictedClass: RestrictedClassDeclaration | null;
  signatureRequested: boolean;
};

export async function getHostedMerchantContext(params: {
  requestId: string;
  hostBusinessAccountId: string;
}): Promise<HostedResult<HostedMerchantContext | null>> {
  const op = "getHostedMerchantContext";
  const { data, error } = await supabaseAdmin
    .from("couranr_hosted_request_intakes")
    .select(
      "order_reference,requested_payer_type,destination_label,shipment_description,customer_weight_lb,customer_weight_band,customer_restricted_class,signature_requested"
    )
    .eq("request_id", params.requestId)
    .eq("host_business_account_id", params.hostBusinessAccountId)
    .maybeSingle();

  if (error) {
    return fail({
      operation: op,
      code: classifyDatabaseError(error),
      detail: error.message,
    });
  }
  if (!data) return { ok: true, value: null };
  const row = data as any;
  return {
    ok: true,
    value: {
      orderReference: row.order_reference ? String(row.order_reference) : null,
      requestedPayerType:
        row.requested_payer_type === "merchant" || row.requested_payer_type === "customer"
          ? row.requested_payer_type
          : null,
      destinationLabel: row.destination_label ? String(row.destination_label) : null,
      shipmentDescription: row.shipment_description ? String(row.shipment_description) : null,
      customerWeightLb:
        row.customer_weight_lb === null || row.customer_weight_lb === undefined
          ? null
          : Number(row.customer_weight_lb),
      customerWeightBand: isWeightBand(row.customer_weight_band)
        ? row.customer_weight_band
        : null,
      customerRestrictedClass: isRestrictedClassDeclaration(row.customer_restricted_class)
        ? row.customer_restricted_class
        : null,
      signatureRequested: row.signature_requested === true,
    },
  };
}

/**
 * Operations twin of the host-scoped context read.
 *
 * It is deliberately a different function: merchant callers must name and
 * prove the host business, while Operations has cross-request review authority.
 * The request_id is UNIQUE in the intake table, so this cannot blend evidence
 * from two merchants or two customer sessions.
 */
export type HostedOperationsContext = HostedMerchantContext & {
  hostBusinessAccountId: string;
  hostBusinessName: string | null;
};

export async function getHostedOperationsContext(params: {
  requestId: string;
}): Promise<HostedResult<HostedOperationsContext | null>> {
  const op = "getHostedOperationsContext";
  const { data, error } = await supabaseAdmin
    .from("couranr_hosted_request_intakes")
    .select(
      "host_business_account_id,order_reference,requested_payer_type,destination_label,shipment_description,customer_weight_lb,customer_weight_band,customer_restricted_class,signature_requested"
    )
    .eq("request_id", params.requestId)
    .maybeSingle();

  if (error) {
    return fail({
      operation: op,
      code: classifyDatabaseError(error),
      detail: error.message,
    });
  }
  if (!data) return { ok: true, value: null };
  const row = data as any;
  const hostBusinessAccountId = String(row.host_business_account_id ?? "");
  if (!hostBusinessAccountId) {
    return fail({
      operation: op,
      code: "internal",
      detail: { reason: "host_business_account_missing" },
    });
  }
  const { data: hostAccount, error: hostAccountError } = await supabaseAdmin
    .from("business_accounts")
    .select("name")
    .eq("id", hostBusinessAccountId)
    .maybeSingle();
  if (hostAccountError) {
    return fail({
      operation: op,
      code: "internal",
      detail: hostAccountError.message,
    });
  }
  return {
    ok: true,
    value: {
      hostBusinessAccountId,
      hostBusinessName: (hostAccount as any)?.name
        ? String((hostAccount as any).name)
        : null,
      orderReference: row.order_reference ? String(row.order_reference) : null,
      requestedPayerType:
        row.requested_payer_type === "merchant" || row.requested_payer_type === "customer"
          ? row.requested_payer_type
          : null,
      destinationLabel: row.destination_label ? String(row.destination_label) : null,
      shipmentDescription: row.shipment_description ? String(row.shipment_description) : null,
      customerWeightLb:
        row.customer_weight_lb === null || row.customer_weight_lb === undefined
          ? null
          : Number(row.customer_weight_lb),
      customerWeightBand: isWeightBand(row.customer_weight_band)
        ? row.customer_weight_band
        : null,
      customerRestrictedClass: isRestrictedClassDeclaration(row.customer_restricted_class)
        ? row.customer_restricted_class
        : null,
      signatureRequested: row.signature_requested === true,
    },
  };
}

export type HostedValidationInput = {
  payerType: "merchant" | "customer";
  weightLb: number | null;
  weightBand: WeightBand | null;
  restrictedClass: RestrictedClassDeclaration;
  signatureRequired: boolean;
};

/**
 * Customer safety evidence may become MORE conservative during merchant
 * validation, never less. A specific customer declaration can be confirmed or
 * escalated to unknown; it cannot be erased to none or rewritten to a
 * different specific class.
 */
export function hostedRestrictedClassTransitionAllowed(
  customerDeclaration: RestrictedClassDeclaration | null | undefined,
  merchantDeclaration: RestrictedClassDeclaration
): boolean {
  if (
    !customerDeclaration ||
    customerDeclaration === "none" ||
    customerDeclaration === "unknown"
  ) {
    return true;
  }
  return (
    merchantDeclaration === customerDeclaration ||
    merchantDeclaration === "unknown"
  );
}

export function validateMerchantHostedConfirmation(raw: unknown):
  | { ok: true; value: HostedValidationInput }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  const body = raw as Record<string, unknown>;
  const payerType =
    body.payerType === "merchant" || body.payerType === "customer" ? body.payerType : null;
  if (!payerType) return { ok: false, reason: "payer_invalid" };

  let weightLb: number | null = null;
  if (body.weightLb !== undefined && body.weightLb !== null && body.weightLb !== "") {
    const parsed = Number(body.weightLb);
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, reason: "weight_invalid" };
    weightLb = parsed;
  }
  let weightBand: WeightBand | null = null;
  if (body.weightBand !== undefined && body.weightBand !== null && body.weightBand !== "") {
    if (!isWeightBand(body.weightBand)) return { ok: false, reason: "weight_band_invalid" };
    weightBand = body.weightBand;
  }
  if (weightLb === null && weightBand === null) return { ok: false, reason: "weight_required" };

  if (!isRestrictedClassDeclaration(body.restrictedClass)) {
    return { ok: false, reason: "restricted_class_invalid" };
  }
  return {
    ok: true,
    value: {
      payerType,
      weightLb,
      weightBand,
      restrictedClass: body.restrictedClass,
      signatureRequired: body.signatureRequired === true,
    },
  };
}

export async function validateHostedRequestByMerchant(params: {
  requestId: string;
  hostBusinessAccountId: string;
  expectedVersion: number;
  actorUserId: string;
  input: HostedValidationInput;
}): Promise<HostedResult<{ request: Record<string, any> }>> {
  const op = "validateHostedRequestByMerchant";

  const [{ data: request, error: requestError }, { data: intake, error: intakeError }] =
    await Promise.all([
      supabaseAdmin
        .from("couranr_delivery_requests")
        .select("*")
        .eq("id", params.requestId)
        .eq("source", "hosted_request")
        .eq("requester_kind", "consumer")
        .is("business_account_id", null)
        .maybeSingle(),
      supabaseAdmin
        .from("couranr_hosted_request_intakes")
        .select("*")
        .eq("request_id", params.requestId)
        .eq("host_business_account_id", params.hostBusinessAccountId)
        .maybeSingle(),
    ]);

  if (requestError || intakeError || !request || !intake) {
    return fail({
      operation: op,
      code:
        requestError || intakeError
          ? classifyDatabaseError(requestError ?? intakeError)
          : "not_found",
      detail: requestError?.message ?? intakeError?.message,
    });
  }

  /*
   * PROVIDER-COST PREFLIGHT.
   *
   * Google Place Details and Mapbox are paid calls. The SQL function below is
   * still the final authority under a row lock, but putting all cheap refusal
   * checks BEFORE deriveCanonicalRouteAndQuote means a viewer/billing member,
   * stale tab, duplicate validation, or already-quoted request cannot spend
   * Couranr's provider budget just to be rejected afterwards.
   */
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("business_members")
    .select("role,status")
    .eq("business_account_id", params.hostBusinessAccountId)
    .eq("user_id", params.actorUserId)
    .maybeSingle();

  if (membershipError) {
    return fail({
      operation: op,
      code: "internal",
      detail: membershipError.message,
    });
  }
  if (
    !membership ||
    (membership as any).status !== "active" ||
    !["owner", "manager", "dispatcher"].includes(String((membership as any).role ?? ""))
  ) {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "role_may_not_validate_hosted_request" },
      message: "Your role can view this request but cannot validate it.",
    });
  }

  const requestRow = request as any;
  if (
    Number(requestRow.version) !== params.expectedVersion ||
    requestRow.request_state !== "awaiting_merchant_confirmation" ||
    requestRow.current_quote_version_id !== null ||
    requestRow.quote_status !== "not_quoted"
  ) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "version_or_state_conflict" },
      message: "This request changed before validation. Refresh and try again.",
    });
  }

  /*
   * CUSTOMER SAFETY EVIDENCE IS MONOTONIC.
   *
   * A customer who explicitly declared a governed restricted class created
   * immutable intake evidence. Merchant validation may confirm that same class
   * or choose "unknown" to escalate it for Couranr review; it may not silently
   * erase or rewrite that declaration to "none" or to a different class.
   */
  const customerRestrictedClass = isRestrictedClassDeclaration(
    (intake as any).customer_restricted_class
  )
    ? ((intake as any).customer_restricted_class as RestrictedClassDeclaration)
    : "unknown";
  if (
    !hostedRestrictedClassTransitionAllowed(
      customerRestrictedClass,
      params.input.restrictedClass
    )
  ) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: {
        reason: "customer_restricted_class_cannot_be_downgraded",
        customerRestrictedClass,
      },
      message:
        "The customer reported a restricted item. Keep that declaration or choose Unknown for Couranr review.",
    });
  }

  let routed: Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>;
  try {
    routed = await deriveCanonicalRouteAndQuote({
      pickupAddress: (request as any).pickup_address,
      dropoffAddress: (request as any).dropoff_address,
      weightLb: params.input.weightLb,
      weightBand: params.input.weightBand,
      additionalStops: 0,
      serviceLevel: "standard",
      signatureRequired: params.input.signatureRequired,
      overnightRequested: false,
      timingIntent: "asap",
      requestedPickupLocal: null,
    });
  } catch (error) {
    if (isCanonicalAddressResolutionError(error)) {
      return fail({
        operation: op,
        code: "invalid_input",
        detail: { field: error.field, reason: error.reason },
        message:
          error.field === "dropoffAddress"
            ? "Couranr could not verify the customer-selected destination."
            : "Couranr could not verify the business pickup address.",
      });
    }
    return fail({ operation: op, code: "internal", detail: error });
  }

  const facts = factsFromDraft({
    weightLb: params.input.weightLb,
    weightBand: params.input.weightBand,
    restrictedClass: params.input.restrictedClass,
    serviceLevel: "standard",
    timingIntent: "asap",
    requestedPickupLocal: null,
  });
  const textSignals = scanRestrictedSignals(String((intake as any).shipment_description ?? ""));
  const policy = evaluateShipmentPolicy(facts, { textSignals });
  const quote = applyShipmentPolicyToQuote(routed.quote, policy);

  const r = await callRpc<any>(op, RPC.validateRequest, {
    p_request_id: params.requestId,
    p_host_business_account_id: params.hostBusinessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
    p_payer_type: params.input.payerType,
    p_weight_lb: params.input.weightLb,
    p_weight_band: params.input.weightBand,
    p_restricted_class: params.input.restrictedClass,
    p_signature_required: params.input.signatureRequired,
    p_pickup_address: routed.pickupAddress,
    p_dropoff_address: routed.dropoffAddress,
    ...routeArgs(routed.route),
    ...quoteArgs(quote),
    p_timing_review_reasons: timingArgs(routed.timing).p_timing_review_reasons,
  });
  if (isHostedFailure(r)) return r;
  return { ok: true, value: { request: one<any>(r.value) ?? r.value } };
}

/* ------------------------------------------------------- host readiness */

const READINESS_RPC: Readonly<Record<ReadinessState, string | null>> = {
  not_confirmed: null,
  preparing: RPC.beginPreparation,
  ready: RPC.markReady,
  not_ready: RPC.markNotReady,
  unavailable: RPC.markUnavailable,
};

export async function setHostedMerchantReadiness(params: {
  requestId: string;
  hostBusinessAccountId: string;
  expectedVersion: number;
  actorUserId: string;
  to: ReadinessState;
}): Promise<HostedResult<{ request: Record<string, any> }>> {
  const op = "setHostedMerchantReadiness";
  const fn = READINESS_RPC[params.to];
  if (!fn) {
    return fail({
      operation: op,
      code: "invalid_input",
      message: "That is not a readiness Couranr can set.",
    });
  }
  const r = await callRpc<any>(op, fn, {
    p_request_id: params.requestId,
    p_host_business_account_id: params.hostBusinessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
  });
  if (isHostedFailure(r)) return r;
  return { ok: true, value: { request: one<any>(r.value) ?? r.value } };
}
