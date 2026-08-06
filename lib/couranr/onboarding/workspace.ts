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

/**
 * Verbatim from the Master Package merchant category registry. Category
 * controls initial recommendations, not eligibility.
 *
 * The database enforces the same list in `couranr_mw_category_chk`; the two
 * are compared directly by `tests/couranr-workspace.test.ts`, so they cannot
 * drift into a runtime insert failure.
 */
export const BUSINESS_CATEGORIES = [
  { value: "dry_cleaning_laundry_tailoring", label: "Dry cleaning, laundry, tailoring" },
  { value: "printing_signage_promotional", label: "Printing, signage, promotional products" },
  { value: "boutique_clothing_shoes_accessories", label: "Boutique, clothing, shoes, accessories" },
  { value: "florists_gifts_specialty_retail", label: "Florists, gifts, specialty retail" },
  { value: "repair_and_electronics", label: "Repair and electronics" },
  { value: "auto_parts_and_accessories", label: "Auto parts and accessories" },
  { value: "furniture_and_home_goods", label: "Furniture and home goods" },
  { value: "event_rentals_and_supplies", label: "Event rentals and supplies" },
  { value: "bakeries_prepared_food_catering", label: "Bakeries, prepared food, catering" },
  { value: "books_cards_collectibles_hobby", label: "Books, cards, collectibles, hobby" },
  { value: "general_local_business", label: "General local business" },
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]["value"];

const CATEGORY_VALUES: readonly string[] = BUSINESS_CATEGORIES.map((c) => c.value);

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

  const rawAddr = r.pickupAddress;
  let pickupAddress: WorkspaceAddress | null = null;
  if (rawAddr === null || typeof rawAddr !== "object" || Array.isArray(rawAddr)) {
    errors.push({ code: "invalid_pickup_address", field: "pickupAddress" });
  } else {
    const a = rawAddr as Record<string, unknown>;
    const line1 = str(a.line1);
    const city = str(a.city);
    const region = str(a.region);
    const postalCode = str(a.postalCode ?? a.postal_code);
    if (!line1 || !city || !region || !postalCode) {
      errors.push({ code: "invalid_pickup_address", field: "pickupAddress" });
    } else {
      pickupAddress = {
        line1,
        line2: str(a.line2),
        city,
        region,
        postalCode,
        instructions: str(a.instructions),
      };
    }
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
