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

export type AssignedDeliveryProjection = {
  deliveryId: string;
  fulfillmentState: string;
  serviceLevel: string;

  scheduledPickupStart: string;
  scheduledPickupEnd: string;
  timezone: string;

  pickup: { line1: string; line2: string; city: string; region: string; postalCode: string; instructions: string };
  dropoff: { line1: string; line2: string; city: string; region: string; postalCode: string; instructions: string };

  /** Who to hand off WITH at the pickup end. */
  merchant: { name: string; phone: string };
  /** Who to hand off TO. Name and phone only. */
  recipient: { name: string; phone: string };

  shipment: {
    /** Not captured by the request model yet; null rather than a fake zero. */
    packageCount: number | null;
    declaredWeightLb: number | null;
    additionalStops: number | null;
  };

  proof: { method: string; signatureRequired: boolean };
  vehicleRequirement: { vehicleClass: string | null; maxPayloadLb: number | null };

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

export function buildAssignedDeliveryProjection(input: {
  delivery: Record<string, any>;
  assignment: Record<string, any>;
  vehicle: Record<string, any> | null;
  merchant: { name?: string | null; phone?: string | null } | null;
}): AssignedDeliveryProjection {
  const d = input.delivery ?? {};
  const req = d.vehicle_requirement ?? {};

  return {
    deliveryId: String(d.id ?? ""),
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
      packageCount: num(d.shipment, "packageCount"),
      declaredWeightLb: num(d.shipment, "weightLb"),
      additionalStops: num(d.shipment, "additionalStops"),
    },

    proof: {
      method: String(d.proof_method ?? ""),
      signatureRequired: d.signature_required === true,
    },
    vehicleRequirement: {
      vehicleClass: typeof req?.vehicleClass === "string" ? req.vehicleClass : null,
      maxPayloadLb: num(req, "maxPayloadLb"),
    },

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
