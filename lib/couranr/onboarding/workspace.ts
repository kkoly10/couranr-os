/**
 * Merchant workspace onboarding (PUB-003 / MER-002).
 *
 * Pure input handling. The command that writes lives in `commands.ts`; this
 * module is separated so the whole normalization and slug surface is testable
 * without a database.
 *
 * Deliberately lightweight: name, category, pickup address, phone, payer
 * default and policy acceptance. No Stripe setup, no logo, no team invitations
 * — those are activation steps, not signup, and putting them here is how a
 * merchant never finishes onboarding.
 */

import {
  BUSINESS_CATEGORIES as CATEGORY_REGISTRY,
  CATEGORY_LABELS,
  type BusinessCategory,
} from "@/lib/couranr/categories/registry";

/**
 * The category list, in the {value,label} shape the two `Select`s render.
 *
 * DERIVED, not declared. ACP-024 made `lib/couranr/categories/registry.ts` the
 * single source — it is the one that carries the Master Package citation, the
 * versioning and the drift guard against the database CHECK. This file used to
 * hold its own copy of the same eleven pairs, which meant three lists that had
 * to agree: this one, the registry, and the SQL. Two of them silently, because
 * nothing compared them.
 */
export const BUSINESS_CATEGORIES = CATEGORY_REGISTRY.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export type { BusinessCategory };

const CATEGORY_VALUES: readonly string[] = CATEGORY_REGISTRY;

/**
 * The policy text a merchant accepts. Bumping this string is the deliberate act
 * that marks previously-accepted policies as stale — it is recorded on the row
 * so which version was accepted is never a guess.
 */
export const POLICIES_VERSION = "couranr-policies-2026-07";

export type WorkspaceAddress = {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  instructions: string | null;
};

export type WorkspaceDraft = {
  name: string;
  slugBase: string;
  businessCategory: BusinessCategory;
  pickupAddress: WorkspaceAddress;
  contactPhone: string;
  payerDefault: "merchant" | "customer";
  policiesVersion: string;
};

export type WorkspaceErrorCode =
  | "not_an_object"
  | "client_supplied_amount"
  | "name_required"
  | "name_too_long"
  | "unknown_business_category"
  | "invalid_pickup_address"
  | "contact_phone_required"
  | "contact_phone_invalid"
  | "unknown_payer_default"
  | "policies_not_accepted";

export type WorkspaceError = { code: WorkspaceErrorCode; field?: string };

export type WorkspaceOk = { ok: true; value: WorkspaceDraft };
export type WorkspaceFailed = { ok: false; errors: WorkspaceError[] };
export type WorkspaceResult = WorkspaceOk | WorkspaceFailed;

/** `tsconfig` sets `"strict": false`; a bare `!r.ok` does not narrow. */
export function isWorkspaceFailure(r: WorkspaceResult): r is WorkspaceFailed {
  return r.ok === false;
}

/**
 * Slug base. Lowercased, non-alphanumerics collapsed to a single hyphen,
 * trimmed and bounded.
 *
 * The database re-derives this from the same input rather than trusting it, so
 * this is a convenience, not a security control. Uniqueness is settled by the
 * unique index, not here.
 */
export function toSlugBase(name: string): string {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return base === "" ? "business" : base;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

/** Same money-key refusal as the delivery-request input. */
const FORBIDDEN_AMOUNT_KEYS = [
  "totalcents",
  "total",
  "amountcents",
  "amount",
  "pricecents",
  "price",
  "subtotal",
  "paymentduecents",
  "cents",
  "balance",
];

function findAmountKey(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findAmountKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AMOUNT_KEYS.includes(k.toLowerCase().replace(/[^a-z]/g, ""))) return k;
    const hit = findAmountKey(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Permissive on format, strict on presence: enough digits to be a phone. */
function looksLikePhone(v: string): boolean {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Normalize a pickup address.
 *
 * EXTRACTED from `normalizeWorkspaceInput` so MER-014's settings edit and
 * onboarding's capture cannot drift apart: an address changed on the settings
 * screen has to end up shaped exactly like one captured at signup, or the
 * pricing and dispatch code that reads it would meet two different objects.
 *
 * The rule is unchanged from the original inline version: line1, city, region
 * and postalCode are all required; line2 and instructions are optional;
 * `postal_code` is accepted as an alias for `postalCode`.
 */
/**
 * `value` is null exactly when `reason` is set. Written as ONE SHAPE rather
 * than a discriminated union because `tsconfig` sets `"strict": false`:
 * without `strictNullChecks` a union does not narrow on `.ok`, so a caller
 * writing `if (!r.ok) return r.reason` fails to compile. Same reasoning, and
 * the same shape, as `NormalizedNext` in lib/couranr/auth/landing.ts.
 */
export type NormalizedAddress = {
  ok: boolean;
  value: WorkspaceAddress | null;
  reason?: string;
};

export function normalizeAddressInput(raw: unknown): NormalizedAddress {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, value: null, reason: "not_an_object" };
  }
  const a = raw as Record<string, unknown>;
  const line1 = str(a.line1);
  const city = str(a.city);
  const region = str(a.region);
  const postalCode = str(a.postalCode ?? a.postal_code);
  if (!line1 || !city || !region || !postalCode) {
    return { ok: false, value: null, reason: "missing_required_field" };
  }
  return {
    ok: true,
    value: {
      line1,
      line2: str(a.line2),
      city,
      region,
      postalCode,
      instructions: str(a.instructions),
    },
  };
}

export function normalizeWorkspaceInput(raw: unknown): WorkspaceResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "not_an_object" }] };
  }

  const amountKey = findAmountKey(raw);
  if (amountKey) {
    return { ok: false, errors: [{ code: "client_supplied_amount", field: amountKey }] };
  }

  const r = raw as Record<string, unknown>;
  const errors: WorkspaceError[] = [];

  const name = str(r.name);
  if (!name) errors.push({ code: "name_required", field: "name" });
  else if (name.length > 120) errors.push({ code: "name_too_long", field: "name" });

  const businessCategory = str(r.businessCategory) ?? "";
  if (!CATEGORY_VALUES.includes(businessCategory)) {
    errors.push({ code: "unknown_business_category", field: "businessCategory" });
  }

  const normalizedAddress = normalizeAddressInput(r.pickupAddress);
  const pickupAddress: WorkspaceAddress | null = normalizedAddress.ok
    ? normalizedAddress.value
    : null;
  if (!normalizedAddress.ok) {
    errors.push({ code: "invalid_pickup_address", field: "pickupAddress" });
  }

  const contactPhone = str(r.contactPhone);
  if (!contactPhone) errors.push({ code: "contact_phone_required", field: "contactPhone" });
  else if (!looksLikePhone(contactPhone)) {
    errors.push({ code: "contact_phone_invalid", field: "contactPhone" });
  }

  const payerDefault = str(r.payerDefault) ?? "merchant";
  if (payerDefault !== "merchant" && payerDefault !== "customer") {
    errors.push({ code: "unknown_payer_default", field: "payerDefault" });
  }

  // Acceptance is an explicit act. There is no default-true path.
  if (!bool(r.policiesAccepted)) {
    errors.push({ code: "policies_not_accepted", field: "policiesAccepted" });
  }

  // `!contactPhone` is semantically redundant (it always pushed an error
  // above) but it is what lets the return site prove contactPhone: string.
  if (errors.length > 0 || !pickupAddress || !name || !contactPhone) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name,
      slugBase: toSlugBase(name),
      businessCategory: businessCategory as BusinessCategory,
      pickupAddress,
      contactPhone,
      payerDefault: payerDefault as "merchant" | "customer",
      // Server-stated, never accepted from the client: a merchant cannot claim
      // to have accepted a version that was never shown to them.
      policiesVersion: POLICIES_VERSION,
    },
  };
}
