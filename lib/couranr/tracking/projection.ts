import {
  stageForFulfillmentState,
  stageForRequest,
  type ProofState,
  type TrackingStage,
} from "./states";

/**
 * The sanitized recipient projection.
 *
 * This is the security boundary of the customer surface, and it is the widest
 * one Couranr has: a payment link is held by a payer who is already party to
 * the money, but a TRACKING link travels by SMS and email and ends up in group
 * chats, screenshots and forwarded threads. Whoever holds the URL sees exactly
 * what this function returns and nothing else.
 *
 * So it is a strict ALLOW-LIST — every field named and copied out one at a
 * time. A deny-list would be wrong in the one direction that matters: a column
 * added to `couranr_deliveries` next month would silently start reaching
 * anyone with a forwarded link. Here a new column reaches nobody until someone
 * adds a line, and `tests/couranr-tracking.test.ts` fails if the serialized
 * output ever grows a key that is not on the list.
 *
 * Pure and dependency-free: plain rows in, plain object out, unit-testable
 * without a database and without a browser.
 *
 * WHAT A RECIPIENT NEVER RECEIVES, even though the rows carry it:
 *
 *   deliveryId, requestId, businessAccountId, payment_obligation_id,
 *   service_plan_id, assignment ids
 *     — every internal handle. The token is the only identifier the customer
 *       surface needs, and an id in a page a stranger can hold is an id that
 *       gets tried against other routes.
 *
 *   captured_amount_cents, currency, pricing_policy_version
 *     — the delivery charge is between Couranr and the PAYER, who may be the
 *       merchant. A recipient who never agreed to pay must not be shown a
 *       price, and REF-002 forbids implying Couranr handles merchandise money
 *       at all.
 *
 *   pickup address
 *     — the merchant's street address is the merchant's, not the recipient's.
 *       The business NAME is returned so the page can say who is sending;
 *       nothing else about the sender is.
 *
 *   dropoff `instructions`
 *     — CUS-008: "Gate codes and sensitive instructions must be protected and
 *       shown only to assigned driver/Couranr." The stored instruction is the
 *       merchant's snapshot and may contain a gate code, so it is withheld
 *       from a link that travels. When CUS-008's edit surface lands it will
 *       show the customer their OWN saved instruction through a write path
 *       that authenticates the save, which is a different question from
 *       echoing the dispatch snapshot to whoever opens the URL.
 *
 *   recipient phone and email
 *     — the recipient already knows their own contact details, so returning
 *       them buys the page nothing and hands a forwarded link a phone number.
 *
 *   driver identity of any kind — name, phone, photo, vehicle plate
 *     — the registry's PUB-006 entry does not ask for it, and it is a real
 *       person's PII behind a URL that forwards. `driverAssigned` carries the
 *       only fact the stage rail needs. PUB-006's mandatory correction already
 *       forbids unrestricted call or customer–driver chat; not shipping the
 *       identity is the same instinct one step earlier.
 *
 *   proof storage paths and any signed URL
 *     — PHO-001: proof media is reachable only through a short-lived signed
 *       URL, `persist_signed_urls: false`. A proof here is an id, a type and a
 *       timestamp; the bytes are fetched from a separate endpoint that
 *       re-authorizes and mints a 600-second URL each time.
 *
 *   proof capture coordinates
 *     — where a driver was standing is operational evidence, not something a
 *       forwarded link should carry.
 */

export type TrackingProofItem = {
  /** Opaque to the customer surface; only usable against the token's own proof endpoint. */
  proofId: string;
  proofType: string;
  capturedAt: string;
  /** False for a PIN record, which is proof without an image. */
  hasImage: boolean;
};

export type TrackingTimelineEntry = {
  stage: TrackingStage;
  at: string;
};

export type TrackingProjection = {
  stage: TrackingStage;
  /** The stored state this stage was derived from, for the page's own tests. */
  sourceState: string | null;

  senderName: string;

  /** Street-level, because it is the recipient's own address. No instructions. */
  dropoff: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
  };

  /**
   * ESTIMATES. PUB-006's mandatory correction is "Times are estimates", and
   * these are the scheduled PICKUP window — the moment the driver collects,
   * not the moment the recipient receives. The screen must label them as such
   * and must never render either as a promised arrival.
   */
  scheduledPickupStart: string | null;
  scheduledPickupEnd: string | null;
  timezone: string | null;

  serviceLevel: string | null;
  signatureRequired: boolean;
  /** Whether Couranr was authorized to leave the delivery without a handoff. */
  leaveAtDoorAuthorized: boolean;

  /** The fact, never the person. */
  driverAssigned: boolean;

  proof: {
    state: ProofState;
    items: TrackingProofItem[];
  };

  timeline: TrackingTimelineEntry[];
};

/** Reads one string field out of an untyped jsonb blob without throwing. */
function str(o: any, k: string): string {
  const v = o && typeof o === "object" ? o[k] : undefined;
  return typeof v === "string" ? v : "";
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Proof rows a RECIPIENT may see.
 *
 * Dropoff stage only. Pickup proof is the shipment and condition photography
 * of the merchant's goods taken at the merchant's premises — it exists so
 * Couranr and the merchant can settle a damage question, and it is not the
 * recipient's to browse. `pickup_discrepancy` evidence is the same in stronger
 * form: it is the record of something being wrong with the merchant's
 * shipment.
 */
export function isCustomerVisibleProof(row: any): boolean {
  return row?.proof_stage === "dropoff";
}

/**
 * The proof state CUS-006 renders.
 *
 * `processing` is the honest answer for a delivery that completed moments ago:
 * the completion command and the proof finalization are separate writes, so
 * there is a real window where the delivery is `delivered` and the proof row
 * is not yet readable. Reporting `unavailable` there would tell a customer
 * their delivery has no proof when it is seconds from having some.
 */
export function proofStateFor(params: {
  stage: TrackingStage;
  visibleProofCount: number;
}): ProofState {
  if (params.visibleProofCount > 0) return "available";
  if (params.stage === "delivered") return "processing";
  return "unavailable";
}

/**
 * Build the projection.
 *
 * `delivery` is null before payment capture — a request is trackable from the
 * moment Couranr confirms it, and the delivery row does not exist yet. That is
 * not an error state and must not render as one.
 */
export function buildTrackingProjection(input: {
  request: any;
  delivery: any | null;
  business: any | null;
  assignmentActive: boolean;
  proofs: any[];
  events: any[];
}): TrackingProjection {
  const d = input.delivery;

  const fulfillmentStage = d ? stageForFulfillmentState(d.fulfillment_state) : null;
  const stage: TrackingStage =
    fulfillmentStage ??
    stageForRequest({
      requestState: input.request?.request_state,
      readinessState: input.request?.readiness_state,
    });

  const visible = (Array.isArray(input.proofs) ? input.proofs : []).filter(isCustomerVisibleProof);

  const dropoff = d?.dropoff_address ?? null;
  const proofMethod = typeof d?.proof_method === "string" ? d.proof_method : null;

  return {
    stage,
    // The stored state, not the stage — so a test can prove the mapping and a
    // support conversation can name the same thing Operations sees.
    sourceState: d ? (typeof d.fulfillment_state === "string" ? d.fulfillment_state : null) : null,

    senderName: typeof input.business?.name === "string" ? input.business.name : "",

    dropoff: {
      line1: str(dropoff, "line1"),
      line2: str(dropoff, "line2"),
      city: str(dropoff, "city"),
      region: str(dropoff, "region"),
      postalCode: str(dropoff, "postalCode"),
    },

    scheduledPickupStart: isoOrNull(d?.scheduled_pickup_start),
    scheduledPickupEnd: isoOrNull(d?.scheduled_pickup_end),
    timezone: typeof d?.timezone === "string" ? d.timezone : null,

    serviceLevel: typeof d?.service_level === "string" ? d.service_level : null,
    signatureRequired: d?.signature_required === true,
    leaveAtDoorAuthorized: proofMethod === "leave_at_door",

    driverAssigned: input.assignmentActive === true,

    proof: {
      state: proofStateFor({ stage, visibleProofCount: visible.length }),
      items: visible.map((p: any) => ({
        proofId: String(p.id),
        proofType: typeof p.proof_type === "string" ? p.proof_type : "",
        capturedAt: String(p.finalized_at ?? p.created_at ?? ""),
        // A recipient PIN record is proof with nothing to look at. Saying so
        // keeps the viewer from rendering a broken image for it.
        hasImage: typeof p.storage_object_path === "string" && p.storage_object_path.length > 0,
      })),
    },

    timeline: buildTimeline(input.events),
  };
}

/**
 * The customer timeline.
 *
 * Built from `to_state` and `created_at` and NOTHING else. The event rows also
 * carry `actor_user_id`, `command` and a free-form `metadata` blob, none of
 * which belongs behind a forwarded URL — `metadata` in particular is written by
 * several different commands and has no schema a projection could rely on.
 *
 * FIRST occurrence wins per stage. Several stored states map to one customer
 * stage, so a delivery that went `assigned -> en_route_to_pickup -> at_pickup`
 * would otherwise render "Driver assigned" three times.
 */
export function buildTimeline(events: any[]): TrackingTimelineEntry[] {
  const rows = Array.isArray(events) ? events : [];
  const seen = new Set<string>();
  const out: TrackingTimelineEntry[] = [];

  for (const e of rows) {
    const stage = stageForFulfillmentState(e?.to_state);
    if (!stage) continue;
    if (seen.has(stage)) continue;
    const at = isoOrNull(e?.created_at);
    if (!at) continue;
    seen.add(stage);
    out.push({ stage, at });
  }

  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

/**
 * The exact top-level keys a serialized projection may have.
 * `tests/couranr-tracking.test.ts` compares this against a real projection, so
 * a field added above without a line here fails the build.
 */
export const TRACKING_PROJECTION_ALLOWED_KEYS: readonly string[] = [
  "stage",
  "sourceState",
  "senderName",
  "dropoff",
  "scheduledPickupStart",
  "scheduledPickupEnd",
  "timezone",
  "serviceLevel",
  "signatureRequired",
  "leaveAtDoorAuthorized",
  "driverAssigned",
  "proof",
  "timeline",
];

/**
 * Strings that must NEVER appear anywhere in a serialized projection, at any
 * depth. Exact column and field names, so the check cannot false-positive on
 * ordinary address text.
 */
export const TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "business_account_id",
  "businessAccountId",
  "payment_obligation_id",
  "captured_amount_cents",
  "pricing_policy_version",
  "service_plan_id",
  "request_id",
  "requestId",
  "deliveryId",
  "delivery_id",
  "assignment_id",
  "assignmentId",
  "actor_user_id",
  "actor_driver_id",
  "storage_object_path",
  "storage_bucket",
  "signedUrl",
  "signed_url",
  "token_hash",
  "captured_latitude",
  "captured_longitude",
  "instructions",
  // NOT the bare word "pickup": `scheduledPickupStart` is a legitimate key and
  // only its capital P kept a lowercase "pickup" entry from failing. A check
  // that passes on a casing accident is not a check.
  "pickup_address",
  "pickupAddress",
  "recipient_phone",
  "recipient_email",
];
