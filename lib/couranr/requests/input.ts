import { SERVICE_LEVEL_CENTS, type ServiceLevel } from "@/lib/couranr/pricing";
import {
  googlePlaceSelectionFromAddress,
  type GooglePlaceSelection,
} from "@/lib/couranr/routing/address";
import type { ReadinessState } from "./states";
import { READINESS_STATES } from "./states";

/**
 * Normalization of UNTRUSTED delivery-request input.
 *
 * Pure and dependency-free. Two rules drive everything here:
 *
 *  1. Amounts are integer cents, computed server-side. This module refuses any
 *     payload that carries a money field at all, rather than quietly ignoring
 *     it — a silently dropped `totalCents` looks identical to a respected one
 *     from the client's side, and `/api/create-checkout-session` is the P0 that
 *     comes from trusting one.
 *  2. Nothing is coerced into a canonical vocabulary. An unrecognised service
 *     level is an error, not a fallback to "standard".
 */

export const PROOF_METHODS = ["photo_or_pin", "signature", "leave_at_door"] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];

export const PAYER_TYPES = ["merchant", "customer"] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const REQUEST_SOURCES = [
  "merchant_portal",
  "consumer_send",
  "hosted_request",
  "operations",
  "api",
  "import",
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export type AddressSelection = GooglePlaceSelection;

export type DeliveryRequestDraft = {
  source: RequestSource;
  pickupAddress: AddressSelection;
  dropoffAddress: AddressSelection;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  weightLb: number;
  additionalStops: number;
  serviceLevel: ServiceLevel;
  signatureRequired: boolean;
  proofMethod: ProofMethod;
  payerType: PayerType;
  readinessState: ReadinessState;
  /**
   * SUR-001: overnight is a decided product that this release does not offer.
   * It is not a column — a request for it is preserved in the normalized
   * payload and drives the quote to manual review.
   */
  overnightRequested: boolean;
};

export type InputErrorCode =
  | "client_supplied_amount"
  | "not_an_object"
  | "missing_pickup_address"
  | "missing_dropoff_address"
  | "invalid_address"
  | "google_place_required"
  | "weight_required"
  | "weight_invalid"
  | "additional_stops_invalid"
  | "additional_stops_unsupported"
  | "unknown_service_level"
  | "unknown_proof_method"
  | "unknown_payer_type"
  | "unknown_readiness_state"
  | "unknown_source"
  | "recipient_email_invalid";

export type InputError = { code: InputErrorCode; field?: string };

export type NormalizeOk = { ok: true; value: DeliveryRequestDraft };
export type NormalizeFailed = { ok: false; errors: InputError[] };
export type NormalizeResult = NormalizeOk | NormalizeFailed;

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does.
 */
export function isNormalizeFailure(r: NormalizeResult): r is NormalizeFailed {
  return r.ok === false;
}

/**
 * Keys that would mean the client is trying to state a price. Matched
 * case-insensitively with separators stripped, so `total_cents`, `totalCents`
 * and `TOTAL-CENTS` all collapse to the same probe.
 */
const FORBIDDEN_AMOUNT_KEYS = [
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
];

function canonicalKey(k: string) {
  return k.toLowerCase().replace(/[^a-z]/g, "");
}

/** Recursively looks for a money-bearing key anywhere in the payload. */
function findAmountKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findAmountKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AMOUNT_KEYS.includes(canonicalKey(k))) return k;
    const hit = findAmountKey(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // A form posts strings. An empty string is absent, not zero.
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

function normalizeAddress(
  raw: unknown,
  errors: InputError[],
  field: string
): AddressSelection | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ code: "invalid_address", field });
    return null;
  }
  const selection = googlePlaceSelectionFromAddress(raw);
  if (!selection) {
    errors.push({ code: "google_place_required", field });
    return null;
  }
  return selection;
}

// Deliberately permissive: this only rejects text that cannot be an address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDeliveryRequestInput(raw: unknown): NormalizeResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "not_an_object" }] };
  }

  // Checked before anything else: a payload carrying a price is rejected
  // outright, never partially accepted.
  const amountKey = findAmountKey(raw);
  if (amountKey) {
    return { ok: false, errors: [{ code: "client_supplied_amount", field: amountKey }] };
  }

  const r = raw as Record<string, unknown>;
  const errors: InputError[] = [];

  if (r.pickupAddress === undefined) errors.push({ code: "missing_pickup_address" });
  if (r.dropoffAddress === undefined) errors.push({ code: "missing_dropoff_address" });

  const pickupAddress =
    r.pickupAddress === undefined
      ? null
      : normalizeAddress(r.pickupAddress, errors, "pickupAddress");
  const dropoffAddress =
    r.dropoffAddress === undefined
      ? null
      : normalizeAddress(r.dropoffAddress, errors, "dropoffAddress");

  // Deliberately do not read loadedMiles, distanceMeters or any equivalent
  // client field. Unknown fields are not copied into the canonical draft; the
  // server Routes call is the only mileage authority.

  const weightLb = num(r.weightLb);
  if (weightLb === null) errors.push({ code: "weight_required", field: "weightLb" });
  else if (weightLb < 0) errors.push({ code: "weight_invalid", field: "weightLb" });

  const rawStops = r.additionalStops;
  let additionalStops = 0;
  if (rawStops !== undefined && rawStops !== null && rawStops !== "") {
    const n = num(rawStops);
    if (n === null || n < 0 || !Number.isInteger(n)) {
      errors.push({ code: "additional_stops_invalid", field: "additionalStops" });
    } else if (n > 0) {
      errors.push({ code: "additional_stops_unsupported", field: "additionalStops" });
    } else {
      additionalStops = n;
    }
  }

  const serviceLevel = (str(r.serviceLevel) ?? "standard") as ServiceLevel;
  if (!Object.prototype.hasOwnProperty.call(SERVICE_LEVEL_CENTS, serviceLevel)) {
    errors.push({ code: "unknown_service_level", field: "serviceLevel" });
  }

  const proofMethod = (str(r.proofMethod) ?? "photo_or_pin") as ProofMethod;
  if (!PROOF_METHODS.includes(proofMethod)) {
    errors.push({ code: "unknown_proof_method", field: "proofMethod" });
  }

  const payerType = (str(r.payerType) ?? "merchant") as PayerType;
  if (!PAYER_TYPES.includes(payerType)) {
    errors.push({ code: "unknown_payer_type", field: "payerType" });
  }

  const readinessState = (str(r.readinessState) ?? "not_confirmed") as ReadinessState;
  if (!READINESS_STATES.includes(readinessState)) {
    errors.push({ code: "unknown_readiness_state", field: "readinessState" });
  }

  const source = (str(r.source) ?? "merchant_portal") as RequestSource;
  if (!REQUEST_SOURCES.includes(source)) {
    errors.push({ code: "unknown_source", field: "source" });
  }

  const recipientEmail = str(r.recipientEmail);
  if (recipientEmail && !EMAIL_RE.test(recipientEmail)) {
    errors.push({ code: "recipient_email_invalid", field: "recipientEmail" });
  }

  if (errors.length > 0 || !pickupAddress || !dropoffAddress) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      source,
      pickupAddress,
      dropoffAddress,
      recipientName: str(r.recipientName),
      recipientPhone: str(r.recipientPhone),
      recipientEmail,
      weightLb: weightLb as number,
      additionalStops,
      serviceLevel,
      signatureRequired: bool(r.signatureRequired),
      proofMethod,
      payerType,
      readinessState,
      overnightRequested: bool(r.overnightRequested),
    },
  };
}
