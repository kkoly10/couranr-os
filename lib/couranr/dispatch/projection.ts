/**
 * The sanitized assigned-driver projection.
 *
 * This is the security boundary of the dispatch slice, so it is built as a
 * strict ALLOW-LIST: every field is named and copied out one at a time. A
 * deny-list would be wrong in the one direction that matters — a column added
 * to `couranr_deliveries` next month would silently start reaching drivers.
 * Here, a new column reaches nobody until someone adds a line.
 *
 * Pure and dependency-free on purpose: it takes plain rows and returns a plain
 * object, so it can be unit-tested without a database and without a browser.
 *
 * WHAT A DRIVER NEVER RECEIVES, even though the row carries it:
 *   payment_obligation_id, captured_amount_cents, currency, pricing_policy_version
 *     — money is not a driver's business, and the obligation id is the handle
 *       to the Stripe records
 *   request_id, request_version, business_account_id, service_plan_id
 *     — the audit and tenant handles; a driver has no reason to hold them
 *   recipient.email
 *     — a physical handoff needs a name and a phone. Email is not "minimum
 *       necessary", and the registry requires minimum necessary.
 */

import { requirementsFor } from "@/lib/couranr/consumer/protection";
import { resolveLargeLoadPackageCount } from "@/lib/couranr/driver/states";

export type AssignedDeliveryProjection = {
  deliveryId: string;
  /**
   * The delivery's OWN optimistic-concurrency token — not `request_version`,
   * which stays withheld above.
   *
   * Deliberately driver-visible, and load-bearing: every driver command is a
   * compare-and-set that must send the version it believes current. Without it
   * in the projection the first command of a delivery has nothing to send, so
   * DRV-002 rendered a permanently disabled "Start route to pickup" under
   * "Couranr could not confirm this delivery's current version" — the entire
   * execution flow was unreachable in a browser while typecheck and 956 unit
   * tests stayed green. Only driving the page caught it.
   *
   * This discloses nothing new: every command response already returns
   * `delivery.version` to this same driver. Null rather than a fake 0 when the
   * row somehow lacks one, matching `shipment` below — a wrong version is
   * rejected by the database, but a fabricated one would be a lie the client
   * then acts on.
   */
  version: number | null;
  fulfillmentState: string;
  serviceLevel: string;

  scheduledPickupStart: string;
  scheduledPickupEnd: string;
  timezone: string;

  pickup: { line1: string; line2: string; city: string; region: string; postalCode: string; instructions: string };
  dropoff: { line1: string; line2: string; city: string; region: string; postalCode: string; instructions: string };

  /** Pickup coordination contact; the legacy `merchant` key is kept for clients. */
  merchant: { name: string; phone: string };
  /** Who to hand off TO. Name and phone only. */
  recipient: { name: string; phone: string };

  shipment: {
    /** Frozen sender expectation copied into the delivery before assignment. */
    description: string | null;
    packageCount: number | null;
    orderReference: string | null;
    handlingNotes: string | null;
    declaredWeightLb: number | null;
    additionalStops: number | null;
  };

  proof: { method: string; signatureRequired: boolean };
  vehicleRequirement: { vehicleClass: string | null; maxPayloadLb: number | null };

  /**
   * What custody ceremony this shipment requires.
   *
   * THE LEVEL TRAVELS; THE DECLARED VALUE NEVER DOES. A driver needs to know
   * that an item must be photographed before packing and sealed — they do not
   * need to know it is worth $480, and telling them would turn the manifest
   * into a shopping list. `declared_value_cents` and `declaredValueCents` are in
   * PROJECTION_FORBIDDEN_SUBSTRINGS so that decision is enforced rather than
   * merely intended.
   *
   * `level` is null for every ungoverned delivery — every business delivery and
   * every consumer delivery predating this policy — and the flags are then all
   * false, so the driver flow is byte-identical to what shipped.
   */
  protection: {
    level: string | null;
    requiresPrepackPhoto: boolean;
    requiresSealedPackagePhoto: boolean;
    requiresSecuritySeal: boolean;
    credentialAfterDocumentation: boolean;
    requiresSealCheckAtDropoff: boolean;
  };

  assignment: {
    assignmentId: string;
    assignedAt: string;
    vehicle: { id: string; name: string; vehicleClass: string } | null;
  };
};

/** Reads one string field out of an untyped jsonb blob without throwing. */
function str(o: any, k: string): string {
  const v = o && typeof o === "object" ? o[k] : undefined;
  return typeof v === "string" ? v : "";
}

function num(o: any, k: string): number | null {
  const v = o && typeof o === "object" ? o[k] : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Stored as text in some rows; accept a clean numeric string, nothing else.
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function address(o: any) {
  return {
    line1: str(o, "line1"),
    line2: str(o, "line2"),
    city: str(o, "city"),
    region: str(o, "region"),
    postalCode: str(o, "postalCode"),
    // The merchant's own pickup note. Permitted: it is written FOR the person
    // collecting. Operations' internal notes live on the request and are not
    // read by any path that feeds this.
    instructions: str(o, "instructions"),
  };
}

/**
 * An assigned driver needs a contact to coordinate a direct Consumer pickup
 * even though there is no merchant tenancy. This is the REQUESTER, not a claim
 * that they will physically be at pickup. The request-time snapshot is
 * immutable; only name and phone cross this allow-list, never sender email.
 */
export function pickupContactForDriver(input: {
  businessAccountId: string | null;
  businessContact: { name: string | null; phone: string | null };
  request: { requester_kind?: string; consumer_contact_snapshot?: unknown };
}): { name: string | null; phone: string | null } {
  if (input.businessAccountId) return input.businessContact;
  if (input.request.requester_kind !== "consumer") return { name: null, phone: null };
  const snapshot = input.request.consumer_contact_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { name: null, phone: null };
  }
  const contact = snapshot as Record<string, unknown>;
  const name = typeof contact.name === "string" ? contact.name.trim() : "";
  const phone = typeof contact.phone === "string" ? contact.phone.trim() : "";
  return { name: name || null, phone: phone || null };
}

export function buildAssignedDeliveryProjection(input: {
  delivery: Record<string, any>;
  assignment: Record<string, any>;
  vehicle: Record<string, any> | null;
  merchant: { name?: string | null; phone?: string | null } | null;
  /** The governed protection level from the REQUEST, or null when ungoverned. */
  protectionLevel?: string | null;
}): AssignedDeliveryProjection {
  const d = input.delivery ?? {};
  const req = d.vehicle_requirement ?? {};
  const shipment = d.shipment && typeof d.shipment === "object" ? d.shipment : {};
  const manifest =
    shipment.pickupManifest && typeof shipment.pickupManifest === "object"
      ? shipment.pickupManifest
      : {};

  return {
    deliveryId: String(d.id ?? ""),
    // Strict: a non-integer or a nonsensical version is absent, not coerced.
    version:
      typeof d.version === "number" && Number.isInteger(d.version) && d.version >= 1
        ? d.version
        : null,
    fulfillmentState: String(d.fulfillment_state ?? ""),
    serviceLevel: String(d.service_level ?? ""),

    scheduledPickupStart: String(d.scheduled_pickup_start ?? ""),
    scheduledPickupEnd: String(d.scheduled_pickup_end ?? ""),
    timezone: String(d.timezone ?? ""),

    pickup: address(d.pickup_address),
    dropoff: address(d.dropoff_address),

    merchant: {
      name: String(input.merchant?.name ?? ""),
      phone: String(input.merchant?.phone ?? ""),
    },
    recipient: {
      name: str(d.recipient, "name"),
      phone: str(d.recipient, "phone"),
    },

    shipment: {
      description:
        str(manifest, "description") || null,
      /* The SAME resolution couranr_complete_pickup_v2 performs, from the same
         two jsonb slots, via the one function that owns the rule. The old
         `num(manifest) ?? num(shipment)` coerced a STRING manifest count, which
         the database's `jsonb_typeof(...)='number'` test refuses — so the two
         sides could read different counts, and the driver was the one who found
         out, at `securement_photo_required`, after pressing Confirm pickup. */
      packageCount: resolveLargeLoadPackageCount(
        (manifest as Record<string, unknown> | null)?.packageCount,
        (shipment as Record<string, unknown> | null)?.packageCount
      ),
      orderReference:
        str(manifest, "orderReference") || null,
      handlingNotes:
        str(manifest, "handlingNotes") || null,
      declaredWeightLb: num(shipment, "weightLb"),
      additionalStops: num(shipment, "additionalStops"),
    },

    proof: {
      method: String(d.proof_method ?? ""),
      signatureRequired: d.signature_required === true,
    },
    vehicleRequirement: {
      vehicleClass: typeof req?.vehicleClass === "string" ? req.vehicleClass : null,
      maxPayloadLb: num(req, "maxPayloadLb"),
    },

    /* Derived through requirementsFor, the same table the /send disclosure and
       the database trigger read. A second list here would be a second answer,
       and the one a driver is shown is the one they will be held to. */
    protection: (() => {
      const level = input.protectionLevel;
      if (level !== "secure_pickup" && level !== "protected_handoff" && level !== "standard") {
        return {
          level: null,
          requiresPrepackPhoto: false,
          requiresSealedPackagePhoto: false,
          requiresSecuritySeal: false,
          credentialAfterDocumentation: false,
          requiresSealCheckAtDropoff: false,
        };
      }
      const r = requirementsFor(level);
      return {
        level: r.level,
        requiresPrepackPhoto: r.requiresPrepackPhoto,
        requiresSealedPackagePhoto: r.requiresSealedPackagePhoto,
        requiresSecuritySeal: r.requiresSecuritySeal,
        credentialAfterDocumentation: r.credentialAfterDocumentation,
        requiresSealCheckAtDropoff: r.requiresSealCheckAtDropoff,
      };
    })(),

    assignment: {
      assignmentId: String(input.assignment?.id ?? ""),
      assignedAt: String(input.assignment?.assigned_at ?? ""),
      vehicle: input.vehicle
        ? {
            id: String(input.vehicle.id ?? ""),
            name: String(input.vehicle.name ?? ""),
            vehicleClass: String(input.vehicle.vehicle_class ?? ""),
          }
        : null,
    },
  };
}

/**
 * Every key a driver may ever see, flattened. `tests/couranr-dispatch.test.ts`
 * asserts the projection emits exactly this set, so adding a field to the type
 * without deciding it is driver-safe fails the build rather than shipping.
 */
export const PROJECTION_ALLOWED_KEYS: readonly string[] = [
  "deliveryId",
  "version",
  "fulfillmentState",
  "serviceLevel",
  "scheduledPickupStart",
  "scheduledPickupEnd",
  "timezone",
  "pickup",
  "dropoff",
  "merchant",
  "recipient",
  "shipment",
  "proof",
  "vehicleRequirement",
  "assignment",
  "protection",
];

/**
 * Column and field names that must NEVER appear in a serialized projection.
 * Exact strings, so the check cannot false-positive on ordinary address text.
 */
export const PROJECTION_FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "payment_obligation_id",
  "captured_amount_cents",
  "pricing_policy_version",
  "business_account_id",
  "service_plan_id",
  "request_version",
  "internalNote",
  "internal_note",
  "obligationId",
  "capturedAmountCents",
  /* The declared value is a THEFT INCENTIVE in a driver's hands and is never
     needed to perform the custody ceremony — the LEVEL says what to do. The
     projection carries the level and must never carry the amount. */
  "declared_value_cents",
  "declaredValueCents",
];

/**
 * Provider identifiers, matched as whole tokens rather than as bare substrings
 * — `pi_` on its own appears in perfectly ordinary text and a test that fails
 * on a street name is a test people learn to ignore.
 */
export const PROVIDER_ID_PATTERN = /\b(pi|cus|seti|ch|sk|pk|whsec)_[A-Za-z0-9]{6,}/;

/**
 * True when a serialized projection leaks something it must not. Used by the
 * unit test AND by browser Group P, so the same rule is enforced against a
 * hand-built object and against what the route really returns.
 */
export function projectionLeaks(serialized: string): string | null {
  for (const s of PROJECTION_FORBIDDEN_SUBSTRINGS) {
    if (serialized.includes(s)) return s;
  }
  const m = serialized.match(PROVIDER_ID_PATTERN);
  return m ? m[0] : null;
}
