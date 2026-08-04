/**
 * The customer-facing tracking vocabulary.
 *
 * PURE ON PURPOSE. No client, no secret, no I/O — so the server projection and
 * the browser render from ONE list and cannot drift into telling a recipient
 * two different stories.
 *
 * This is a TRANSLATION layer, not a second state machine. The database
 * remains the authority: `couranr_deliveries.fulfillment_state` is the fact,
 * and every function here maps a stored fact to what a recipient is told. No
 * value here is ever written anywhere.
 *
 * WHY THE MAP IS MANY-TO-ONE. `en_route_to_pickup` and `at_pickup` both mean
 * "a driver has this and has not collected it yet" to someone waiting at the
 * far end. Collapsing them keeps the customer-visible set exactly the one
 * PUB-006 requires, rather than inventing stages the registry does not name.
 */

/**
 * PUB-006's required states, and only those.
 *
 *   Preparing; confirmed; assigned; picked up; in transit; at drop-off;
 *   delivered; return; proof processing.
 *
 * "Proof processing" is modelled separately as a PROOF state rather than a
 * stage, because CUS-006 needs it alongside `verified` and `unavailable` and a
 * delivery can be `delivered` with proof still pending. `could_not_deliver`
 * and `cancelled` are not in the registry's list but are reachable stored
 * states, and a recipient staring at a link deserves the truth rather than a
 * stage that quietly stops advancing.
 */
export const TRACKING_STAGES = [
  "preparing",
  "confirmed",
  "assigned",
  "picked_up",
  "in_transit",
  "at_dropoff",
  "delivered",
  "return",
  "could_not_deliver",
  "cancelled",
] as const;

export type TrackingStage = (typeof TRACKING_STAGES)[number];

/**
 * `return` IS DECLARED AND CURRENTLY UNREACHABLE.
 *
 * `02_DECISION_REGISTRY.json` STA-002 declares a fourteen-value fulfillment
 * vocabulary including `return_required`, `returning` and `returned`. The
 * shipped `FULFILLMENT_STATES` has ten values and none of those three, and no
 * command produces them — the returns and refunds work (P6-004, P7-005) has
 * not started. The stage exists here so the mapping is complete the day those
 * states land, and `tests/couranr-tracking.test.ts` asserts that no value in
 * today's stored vocabulary maps to it. That test is the honest record of the
 * gap: if it ever starts failing, returns have shipped and the ledger is stale.
 */
export const UNREACHABLE_STAGES: readonly TrackingStage[] = ["return"];

export const STAGE_LABELS: Record<TrackingStage, string> = {
  preparing: "Preparing your delivery",
  confirmed: "Confirmed",
  assigned: "Driver assigned",
  picked_up: "Picked up",
  in_transit: "On the way",
  at_dropoff: "Arriving now",
  delivered: "Delivered",
  return: "Returning to the sender",
  could_not_deliver: "Could not be delivered",
  cancelled: "Cancelled",
};

/**
 * One sentence per stage, written for the person waiting rather than for an
 * operator. None of them states a time — TIMES ARE ESTIMATES is PUB-006's
 * mandatory correction, and the estimate is rendered separately and labelled.
 */
export const STAGE_DESCRIPTIONS: Record<TrackingStage, string> = {
  preparing: "Couranr has this delivery. The sender is getting your items ready.",
  confirmed: "Couranr has confirmed this delivery and is assigning a driver.",
  assigned: "A Couranr driver is assigned and is collecting your items.",
  picked_up: "Your items are with the driver.",
  in_transit: "Your driver is on the way to you.",
  at_dropoff: "Your driver has arrived at the drop-off address.",
  delivered: "This delivery is complete.",
  return: "These items are on their way back to the sender.",
  could_not_deliver: "This delivery could not be completed. Couranr Operations is reviewing it.",
  cancelled: "This delivery was cancelled.",
};

/** Ordering for a progress rail. Terminal stages share the last rank. */
export const STAGE_ORDER: Record<TrackingStage, number> = {
  preparing: 0,
  confirmed: 1,
  assigned: 2,
  picked_up: 3,
  in_transit: 4,
  at_dropoff: 5,
  delivered: 6,
  return: 6,
  could_not_deliver: 6,
  cancelled: 6,
};

/**
 * The rail a recipient sees advance. Terminal exceptions are deliberately NOT
 * on it: a cancelled delivery does not render as "step 6 of 6 complete".
 */
export const STAGE_RAIL: readonly TrackingStage[] = [
  "preparing",
  "confirmed",
  "assigned",
  "picked_up",
  "in_transit",
  "at_dropoff",
  "delivered",
];

export type StageTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * Tone per stage. `delivered` is the only success — the driver-side renderer
 * this mirrors once painted every state green, which told an operator a
 * delivery sitting at the door was finished.
 */
export const STAGE_TONES: Record<TrackingStage, StageTone> = {
  preparing: "neutral",
  confirmed: "info",
  assigned: "info",
  picked_up: "info",
  in_transit: "info",
  at_dropoff: "info",
  delivered: "success",
  return: "warning",
  could_not_deliver: "danger",
  cancelled: "warning",
};

/**
 * Stored fulfillment state -> customer stage.
 *
 * Exhaustive over today's ten-value `FULFILLMENT_STATES`. An unknown value
 * returns `null` rather than guessing, and the caller falls back to the
 * request-derived stage — fail-closed, because a stage invented from an
 * unrecognised state is a sentence told to a customer that nothing verified.
 */
const FULFILLMENT_TO_STAGE: Record<string, TrackingStage> = {
  scheduled: "confirmed",
  assigned: "assigned",
  en_route_to_pickup: "assigned",
  at_pickup: "assigned",
  picked_up: "picked_up",
  in_transit: "in_transit",
  at_dropoff: "at_dropoff",
  delivered: "delivered",
  could_not_deliver: "could_not_deliver",
  cancelled: "cancelled",
};

export function stageForFulfillmentState(state: unknown): TrackingStage | null {
  if (typeof state !== "string") return null;
  return FULFILLMENT_TO_STAGE[state] ?? null;
}

/**
 * Request state -> customer stage, for the window BEFORE a delivery row
 * exists. A `couranr_deliveries` row is created only after payment capture, so
 * "Preparing" and "Confirmed" are necessarily request-derived.
 *
 * `readiness` is the merchant's own signal about the shipment and is what
 * separates the two: confirmed-and-being-packed reads as "Preparing".
 */
export function stageForRequest(params: {
  requestState: unknown;
  readinessState?: unknown;
}): TrackingStage {
  const rs = typeof params.requestState === "string" ? params.requestState : "";
  if (rs === "cancelled" || rs === "declined") return "cancelled";
  if (params.readinessState === "preparing") return "preparing";
  if (rs === "confirmed" || rs === "closed") return "confirmed";
  // Everything else is a request that has not been confirmed. A link cannot be
  // issued for one, so this is only reachable if a confirmed request were
  // later moved backwards.
  return "preparing";
}

/* ----------------------------------------------------------- proof --- */

/** CUS-006's required states. `revoked` is carried by the refusal, not here. */
export const PROOF_STATES = ["processing", "available", "unavailable"] as const;
export type ProofState = (typeof PROOF_STATES)[number];

export const PROOF_STATE_COPY: Record<ProofState, string> = {
  processing: "Couranr is still processing the proof for this delivery.",
  available: "Proof of delivery is available.",
  unavailable: "No proof is available for this delivery.",
};

/* -------------------------------------------------------- refusals --- */

/**
 * Why a link did not resolve. These are the strings
 * `couranr_redeem_delivery_access_token` returns, so the UI switches on one
 * closed set and the server and the screen cannot drift.
 *
 * Every one of them renders the SAME way — see `REFUSAL_COPY`. PHO-001's
 * acceptance criterion is that an unauthorized caller receives the same
 * response as for a missing delivery, and a screen that distinguished
 * "expired" from "never existed" would leak exactly what the SQL refuses to.
 */
export const TRACKING_REFUSALS = ["not_found", "revoked", "expired"] as const;
export type TrackingRefusal = (typeof TRACKING_REFUSALS)[number];

export function isTrackingRefusal(v: unknown): v is TrackingRefusal {
  return typeof v === "string" && (TRACKING_REFUSALS as readonly string[]).includes(v);
}

/**
 * ONE sentence for every refusal. Not a lookup with a branch per reason — a
 * single string, so there is no way to accidentally distinguish them.
 */
export const REFUSAL_COPY =
  "This tracking link is not available. If you were expecting a delivery, ask the sender for a new link.";
