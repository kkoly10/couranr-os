/**
 * The canonical fulfillment vocabulary, and the only legal way through it.
 *
 * There was no fulfillment vocabulary in TypeScript before this file. Every
 * renderer did `String(x).replace(/_/g, " ")` and one of them hard-coded a
 * green badge for any state at all, so `at pickup` and `delivered` looked
 * identical. A vocabulary that lives only in a CHECK constraint cannot be
 * rendered, cannot be ordered, and cannot tell a screen what to offer next.
 *
 * PURE ON PURPOSE. No client, no secret, no I/O — so both the driver bundle
 * and the server can import it and cannot drift. The DATABASE remains the
 * authority: every transition here is also hard-coded inside its own SQL
 * command, and this module exists to keep a screen from OFFERING something the
 * command would refuse, never to decide anything on its own.
 */

export const FULFILLMENT_STATES = [
  "scheduled",
  "assigned",
  "en_route_to_pickup",
  "at_pickup",
  "picked_up",
  "in_transit",
  "at_dropoff",
  "return_required",
  "returning",
  "returned",
  "delivered",
  "could_not_deliver",
  "cancelled",
] as const;

export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

/** UI affordance only. The handoff-stage trigger is the issuance authority. */
export function canIssueHandoffCodeAtStage(
  kind: "merchant_pickup" | "recipient_dropoff" | "merchant_return",
  state: string
): boolean {
  if (kind === "merchant_pickup") {
    return ["scheduled", "assigned", "en_route_to_pickup", "at_pickup"].includes(state);
  }
  if (kind === "recipient_dropoff") {
    return ["picked_up", "in_transit", "at_dropoff"].includes(state);
  }
  return state === "return_required" || state === "returning";
}

/**
 * The driver-execution commands, each named for what it DOES rather than for
 * where it lands. A destination is never a parameter: the browser picks a
 * command, and the command hard-codes its own destination in SQL.
 */
export const DRIVER_COMMANDS = [
  "start_route_to_pickup",
  "arrive_at_pickup",
  "complete_pickup",
  "start_route_to_dropoff",
  "arrive_at_dropoff",
  "complete_direct_handoff_delivery",
  "complete_signature_delivery",
  "complete_leave_at_door_delivery",
  "start_return",
  "complete_return",
] as const;

export type DriverCommand = (typeof DRIVER_COMMANDS)[number];

/**
 * from -> to, one entry per command. This table is the readable form of what
 * eight separate SQL functions each assert about themselves; the unit tests
 * check the two against each other so a divergence fails the build rather than
 * a delivery.
 */
export const DRIVER_TRANSITIONS: Record<DriverCommand, { from: FulfillmentState; to: FulfillmentState }> = {
  start_route_to_pickup: { from: "assigned", to: "en_route_to_pickup" },
  arrive_at_pickup: { from: "en_route_to_pickup", to: "at_pickup" },
  complete_pickup: { from: "at_pickup", to: "picked_up" },
  start_route_to_dropoff: { from: "picked_up", to: "in_transit" },
  arrive_at_dropoff: { from: "in_transit", to: "at_dropoff" },
  complete_direct_handoff_delivery: { from: "at_dropoff", to: "delivered" },
  complete_signature_delivery: { from: "at_dropoff", to: "delivered" },
  complete_leave_at_door_delivery: { from: "at_dropoff", to: "delivered" },
  start_return: { from: "return_required", to: "returning" },
  complete_return: { from: "returning", to: "returned" },
};

/** The immutable proof method, as stored on the delivery at capture time. */
export const PROOF_METHODS = ["photo_or_pin", "signature", "leave_at_door"] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];

/**
 * The completion command for a proof method. There is exactly one per method
 * and no fallback: a driver whose delivery says `signature` cannot reach the
 * leave-at-door command, because the map has no other way in.
 *
 * `photo_or_pin` maps to DIRECT HANDOFF. The stored value keeps its historical
 * name — it is an immutable snapshot on live rows — but a photograph is not an
 * alternative to the recipient PIN, and nothing driver-facing says it is.
 */
export const COMPLETION_COMMAND: Record<ProofMethod, DriverCommand> = {
  photo_or_pin: "complete_direct_handoff_delivery",
  signature: "complete_signature_delivery",
  leave_at_door: "complete_leave_at_door_delivery",
};

/** What the driver is told the proof method is. Never "photo or PIN". */
export const PROOF_METHOD_LABELS: Record<ProofMethod, string> = {
  photo_or_pin: "Recipient PIN handoff",
  signature: "Signature",
  leave_at_door: "Leave at door",
};

export const FULFILLMENT_LABELS: Record<FulfillmentState, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  en_route_to_pickup: "On the way to pickup",
  at_pickup: "At pickup",
  picked_up: "Picked up",
  in_transit: "In transit",
  at_dropoff: "At drop-off",
  return_required: "Return required",
  returning: "Returning to sender",
  returned: "Returned to sender",
  delivered: "Delivered",
  could_not_deliver: "Could not deliver",
  cancelled: "Cancelled",
};

/**
 * Tone per state, so a screen never has to invent one.
 *
 * `delivered` is the only success. `at_pickup` and `at_dropoff` are neutral
 * waypoints, not achievements — the previous renderer painted every state
 * green, which told an operator scanning a queue that a delivery sitting at
 * the door was finished.
 */
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";

export const FULFILLMENT_TONES: Record<FulfillmentState, StateTone> = {
  scheduled: "neutral",
  assigned: "info",
  en_route_to_pickup: "info",
  at_pickup: "info",
  picked_up: "info",
  in_transit: "info",
  at_dropoff: "info",
  return_required: "warning",
  returning: "warning",
  returned: "success",
  delivered: "success",
  could_not_deliver: "danger",
  cancelled: "warning",
};

/** Ordering for a timeline. Terminal states share the last rank. */
export const FULFILLMENT_ORDER: Record<FulfillmentState, number> = {
  scheduled: 0,
  assigned: 1,
  en_route_to_pickup: 2,
  at_pickup: 3,
  picked_up: 4,
  in_transit: 5,
  at_dropoff: 6,
  return_required: 7,
  returning: 8,
  returned: 9,
  delivered: 7,
  could_not_deliver: 7,
  cancelled: 7,
};

export function isFulfillmentState(v: unknown): v is FulfillmentState {
  return typeof v === "string" && (FULFILLMENT_STATES as readonly string[]).includes(v);
}

export function isProofMethod(v: unknown): v is ProofMethod {
  return typeof v === "string" && (PROOF_METHODS as readonly string[]).includes(v);
}

export function isDriverCommand(v: unknown): v is DriverCommand {
  return typeof v === "string" && (DRIVER_COMMANDS as readonly string[]).includes(v);
}

/**
 * The ONE command available from a state, or null.
 *
 * Singular by design. A screen that offers two next actions invites a driver
 * to pick the wrong one while moving, and every extra button is a state the
 * server has to refuse. At `at_dropoff` the answer depends on the delivery's
 * immutable proof method, which is why that argument is required rather than
 * optional — omitting it would silently yield null and render a dead end.
 */
export function nextDriverCommand(
  state: FulfillmentState,
  proofMethod: ProofMethod
): DriverCommand | null {
  if (state === "at_dropoff") return COMPLETION_COMMAND[proofMethod] ?? null;
  const found = (DRIVER_COMMANDS as readonly DriverCommand[]).find(
    (c) => DRIVER_TRANSITIONS[c].from === state && DRIVER_TRANSITIONS[c].to !== "delivered"
  );
  return found ?? null;
}

/** Human copy for the single next action. Never a bare state name. */
export const DRIVER_COMMAND_LABELS: Record<DriverCommand, string> = {
  start_route_to_pickup: "Start route to pickup",
  arrive_at_pickup: "I have arrived at pickup",
  complete_pickup: "Complete pickup",
  start_route_to_dropoff: "Start route to drop-off",
  arrive_at_dropoff: "I have arrived at drop-off",
  complete_direct_handoff_delivery: "Complete handoff",
  complete_signature_delivery: "Capture signature",
  complete_leave_at_door_delivery: "Complete leave at door",
  start_return: "Start return to sender",
  complete_return: "Confirm return to sender",
};

/**
 * The two states a driver is MOVING in. Driving Mode is offered here and only
 * here: suppressing the interface while someone is standing still at a loading
 * dock hides the controls they came to use.
 */
export const DRIVING_STATES: readonly FulfillmentState[] = ["en_route_to_pickup", "in_transit"];

export function isDrivingState(state: FulfillmentState): boolean {
  return DRIVING_STATES.includes(state);
}

/** Pre-pickup unassignment is Operations-only and closes at `at_pickup`. */
export const UNASSIGNABLE_STATES: readonly FulfillmentState[] = ["assigned", "en_route_to_pickup"];

export function canUnassignBeforePickup(state: FulfillmentState): boolean {
  return UNASSIGNABLE_STATES.includes(state);
}

/**
 * Whether a proof stage may be recorded from the current state.
 *
 * Finalization checks this too. A photo uploaded while `at_pickup` cannot
 * finalize as drop-off evidence just because the driver got there later.
 */
export const PROOF_STAGES = ["pickup", "dropoff", "pickup_discrepancy", "return"] as const;
export type ProofStage = (typeof PROOF_STAGES)[number];

export function proofStageAllowedFrom(stage: ProofStage, state: FulfillmentState): boolean {
  if (stage === "pickup" || stage === "pickup_discrepancy") return state === "at_pickup";
  if (stage === "dropoff") return state === "at_dropoff";
  return state === "returning";
}

/** Closed outcome vocabulary for a PIN attempt. Never an exception. */
export const PIN_OUTCOMES = ["accepted", "invalid", "locked", "expired"] as const;
export type PinOutcome = (typeof PIN_OUTCOMES)[number];

export const PIN_OUTCOME_MESSAGES: Record<PinOutcome, string> = {
  accepted: "Code accepted.",
  invalid: "That code is not correct. Check it with the sender and try again.",
  locked:
    "Too many incorrect attempts. Ask the sender or Couranr Operations to issue a new code.",
  expired: "That code is no longer valid. Ask for a new one.",
};

export const MAX_PIN_ATTEMPTS = 5;

/** Structured discrepancy reasons. The driver picks one; none of them resolves it. */
export const DISCREPANCY_REASONS = [
  "package_count_mismatch",
  "weight_or_size_mismatch",
  "visible_damage",
  "unsafe_packaging",
  "wrong_item",
  "vehicle_mismatch",
  "prohibited_item_concern",
  "loading_not_available",
  "other",
] as const;

export type DiscrepancyReason = (typeof DISCREPANCY_REASONS)[number];

export const DISCREPANCY_REASON_LABELS: Record<DiscrepancyReason, string> = {
  package_count_mismatch: "The package count does not match",
  weight_or_size_mismatch: "The weight or size does not match",
  visible_damage: "There is visible damage",
  unsafe_packaging: "The packaging is not safe to carry",
  wrong_item: "This is the wrong item",
  vehicle_mismatch: "This will not go in the assigned vehicle",
  prohibited_item_concern: "I think this may be a prohibited item",
  loading_not_available: "Nobody is available to load",
  other: "Something else",
};

export function isDiscrepancyReason(v: unknown): v is DiscrepancyReason {
  return typeof v === "string" && (DISCREPANCY_REASONS as readonly string[]).includes(v);
}

/**
 * §31 — the two DROP-OFF realities the pickup vocabulary had no word for.
 *
 * They live BESIDE `DISCREPANCY_REASONS` rather than inside it, deliberately:
 * that list is pinned one-to-one against the ORIGINAL pickup reason CHECK
 * (20260802030000) by the unit tests, and the database's widened CHECK
 * (20260903040000) is a superset that keeps every original value. A renderer
 * looks these up after `DISCREPANCY_REASON_LABELS` and falls back to the
 * underscore-stripped identifier for anything newer than this build.
 */
export const DROPOFF_EXCEPTION_EXTRA_REASONS = [
  "recipient_unavailable",
  "address_or_access_problem",
  "weather_or_safety",
] as const;

export const DROPOFF_EXCEPTION_REASON_LABELS: Record<string, string> = {
  recipient_unavailable: "The recipient is not available",
  address_or_access_problem: "The address or access is a problem",
  weather_or_safety: "Weather or conditions are not safe",
};

/**
 * THE package count the large-load predicate is allowed to read, resolved the
 * way `couranr_complete_pickup_v2` resolves it and no other way.
 *
 * The SQL is:
 *
 *     case when jsonb_typeof(v_manifest->'packageCount')='number'
 *            then (v_manifest->>'packageCount')::numeric
 *          else nullif(v_dlv.shipment->>'packageCount','')::numeric end
 *
 * Two properties of that are load-bearing and were BOTH missing here:
 *
 *  1. The manifest wins ONLY when its count is a real JSON number.
 *     `jsonb_typeof(...)='number'` is a type test, not a coercion, so a manifest
 *     carrying `"packageCount": "3"` is not a count at all to the database and
 *     it falls through to the shipment root. TypeScript that coerced the string
 *     accepted 3 where the server read 12 — and 12 is over the threshold. The
 *     driver was shown no securement requirement, uploaded nothing, pressed
 *     Confirm pickup, and the RPC answered `securement_photo_required` with the
 *     sender standing in front of them.
 *  2. The fallback is `->>`, which stringifies whatever type is there, so the
 *     shipment ROOT does accept a numeric string. The asymmetry is real and is
 *     reproduced rather than tidied away.
 *
 * `couranr_build_pickup_manifest` takes `p_package_count integer`, so a manifest
 * it wrote can only carry a number or nothing. Nothing constrains the inner
 * types of `pickup_manifest` itself — the column CHECK only requires a jsonb
 * object — so a legacy row, a hand-written manifest or any future writer can
 * still produce the divergent shape.
 */
export function resolveLargeLoadPackageCount(
  manifestPackageCount: unknown,
  shipmentPackageCount: unknown
): number | null {
  // jsonb_typeof(...)='number' — a type test. No string is accepted here.
  if (typeof manifestPackageCount === "number" && Number.isFinite(manifestPackageCount)) {
    return manifestPackageCount;
  }
  // nullif(shipment->>'packageCount','')::numeric — text out of jsonb, so a
  // numeric string IS a count on this side.
  if (typeof shipmentPackageCount === "number" && Number.isFinite(shipmentPackageCount)) {
    return shipmentPackageCount;
  }
  if (typeof shipmentPackageCount === "string" && shipmentPackageCount.trim() !== "") {
    const n = Number(shipmentPackageCount);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Whether the stored shipment triggers the large-or-unusual pickup
 * requirements.
 *
 * Derived from the SERVER'S OWN stored request and service-plan data — the
 * vehicle class the plan committed to and the declared weight — never from a
 * browser boolean. A driver who could assert "this is not unusual" could skip
 * the securement photo on exactly the load that most needs it.
 *
 * `packageCount` is the SHIPMENT-ROOT value and `manifestPackageCount` the
 * frozen pickup manifest's, kept apart on purpose: collapsing them before this
 * function is what let the two sides disagree. A caller holding only an
 * already-resolved count may still pass it as `packageCount` alone — that is
 * exactly the `else` branch of the SQL.
 */
export function requiresLargeShipmentProof(input: {
  vehicleClass?: string | null;
  declaredWeightLb?: number | null;
  packageCount?: number | null;
  manifestPackageCount?: unknown;
}): boolean {
  const heavyClass = input.vehicleClass === "box_truck";
  const heavyLoad = typeof input.declaredWeightLb === "number" && input.declaredWeightLb >= 150;
  const count = resolveLargeLoadPackageCount(input.manifestPackageCount, input.packageCount);
  const manyPackages = count !== null && count >= 10;
  return heavyClass || heavyLoad || manyPackages;
}
