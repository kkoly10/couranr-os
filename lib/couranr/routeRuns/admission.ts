/** Pure, provider-free safety contract for the later dispatcher.
 * This module authorizes NO mutation. Unknown evidence is a blocker, not zero.
 * The live dispatcher/DB must independently enforce these same conditions. */
export const ROUTE_RUN_V1_AGGREGATE_DECLARED_VALUE_LIMIT_CENTS = 50_000;
export type RouteAdmissionBlocker =
  | "invalid_stop_count" | "duplicate_delivery" | "foreign_business"
  | "not_merchant_paid" | "pickup_mismatch" | "wrong_service_day"
  | "cargo_unknown" | "capacity_unknown" | "vehicle_incompatible" | "payload_exceeded"
  | "declared_value_unknown" | "item_value_exceeded" | "route_value_policy_unconfigured"
  | "route_value_exceeded" | "funding_not_secured" | "unresolved_route_exception"
  | "route_execution_not_released";
export type RouteCargo = {
  deliveryId: string;
  businessAccountId: string;
  payerType: string;
  pickupKey: string;
  serviceDay: string;
  /** Conservative upper bound from the canonical weight-band policy, not a
   * fabricated actual weight. Integer milli-pounds avoid rounding underload. */
  payloadUpperBoundMilliLb: number | null;
  declaredValueCents: number | null;
  fundingState: "authorized" | "captured" | "credited" | "unknown" | "failed";
  vehicleCompatible: boolean;
};
export type RouteAdmissionInput = {
  businessAccountId: string;
  pickupKey: string;
  serviceDay: string;
  children: readonly RouteCargo[];
  vehicleCapacityMilliLb: number | null;
  /** Explicit owner-approved policy. Deliberately no default aggregate limit. */
  aggregateValueLimitCents: number | null;
  hasUnresolvedException: boolean;
};
function nonnegative(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}
export function inspectRouteAdmission(input: RouteAdmissionInput): {
  blockers: RouteAdmissionBlocker[];
  payloadUpperBoundMilliLb: number | null;
  declaredValueCents: number | null;
  executionAvailable: false;
} {
  const blockers = new Set<RouteAdmissionBlocker>();
  const children = input.children;
  if (children.length < 2 || children.length > 5) blockers.add("invalid_stop_count");
  if (new Set(children.map((s) => s.deliveryId.toLowerCase())).size !== children.length) {
    blockers.add("duplicate_delivery");
  }
  let weight: number | null = 0;
  let value: number | null = 0;
  for (const child of children) {
    if (child.businessAccountId.toLowerCase() !== input.businessAccountId.toLowerCase()) blockers.add("foreign_business");
    if (child.payerType !== "merchant") blockers.add("not_merchant_paid");
    if (!input.pickupKey || child.pickupKey !== input.pickupKey) blockers.add("pickup_mismatch");
    if (!input.serviceDay || child.serviceDay !== input.serviceDay) blockers.add("wrong_service_day");
    if (!nonnegative(child.payloadUpperBoundMilliLb) || child.payloadUpperBoundMilliLb === 0) {
      blockers.add("cargo_unknown"); weight = null;
    } else if (weight !== null) {
      const next: number = weight + child.payloadUpperBoundMilliLb;
      if (!Number.isSafeInteger(next)) { blockers.add("cargo_unknown"); weight = null; }
      else weight = next;
    }
    if (!nonnegative(child.declaredValueCents)) {
      blockers.add("declared_value_unknown"); value = null;
    } else {
      if (child.declaredValueCents > 50000) blockers.add("item_value_exceeded");
      if (value !== null) {
        const next: number = value + child.declaredValueCents;
        if (!Number.isSafeInteger(next)) { blockers.add("declared_value_unknown"); value = null; }
        else value = next;
      }
    }
    if (!["authorized", "captured", "credited"].includes(child.fundingState)) blockers.add("funding_not_secured");
    if (!child.vehicleCompatible) blockers.add("vehicle_incompatible");
  }
  if (!nonnegative(input.vehicleCapacityMilliLb) || input.vehicleCapacityMilliLb === 0) blockers.add("capacity_unknown");
  else if (weight !== null && weight > input.vehicleCapacityMilliLb) blockers.add("payload_exceeded");
  if (!nonnegative(input.aggregateValueLimitCents) || input.aggregateValueLimitCents === 0) {
    blockers.add("route_value_policy_unconfigured");
  } else if (value !== null && value > input.aggregateValueLimitCents) blockers.add("route_value_exceeded");
  if (input.hasUnresolvedException) blockers.add("unresolved_route_exception");
  // Draft infrastructure must never accidentally become a dispatch gate.
  blockers.add("route_execution_not_released");
  return { blockers: [...blockers], payloadUpperBoundMilliLb: weight,
    declaredValueCents: value, executionAvailable: false };
}

export type RoutePaymentOutcome = "authorized" | "captured" | "unknown" | "failed" | "released" | "refunded";
/** Recovery intent only. An unknown provider result prohibits all new writes
 * until reconciled. A captured sibling is never captured again. */
export function routeSettlementRecovery(outcomes: readonly RoutePaymentOutcome[]):
  "reconcile_only" | "compensate" | "ready_for_assignment" | "continue_capture" | "no_funding" {
  if (outcomes.length < 2 || outcomes.length > 5) return "no_funding";
  if (outcomes.some((s) => !["authorized", "captured", "failed", "released", "refunded"].includes(s))) return "reconcile_only";
  if (outcomes.some((s) => s === "failed" || s === "released" || s === "refunded")) return "compensate";
  if (outcomes.every((s) => s === "captured")) return "ready_for_assignment";
  return "continue_capture";
}
