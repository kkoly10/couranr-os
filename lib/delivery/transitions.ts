/**
 * Courier delivery lifecycle.
 *
 * The rule this encodes: no route should accept an arbitrary target status from
 * a request body. Every transition is named, its actor is verified, the current
 * state is checked, and the move is allow-listed.
 *
 * The vocabulary and the edges below are taken from the behaviour already
 * implemented by the admin routes, not invented here:
 *   - assign-driver: pending -> assigned      (app/api/admin/courier/deliveries/[id]/assign-driver/route.ts:45)
 *   - cancel:        any but completed -> cancelled  (.../cancel/route.ts:28,31)
 *   - reinstate:     cancelled -> pending     (.../reinstate/route.ts:25,28)
 *   - completed is terminal and locked        (.../route.ts:127, cancel:28, assign-driver:39)
 *
 * Pricing, hours and payer behaviour are NOT settled here — those belong to
 * `02_DECISION_REGISTRY.json`, which does not exist in the repo yet. This module
 * is only about which state moves are legal and who may make them.
 */

export const DELIVERY_STATUSES = [
  "pending",
  "assigned",
  "in_transit",
  "completed",
  "cancelled",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Who is asking. `driver` is only meaningful together with assignment. */
export type DeliveryActorRole = "admin" | "driver";

export type TransitionActor = {
  role: DeliveryActorRole;
  /** True only when this actor is the driver assigned to THIS delivery. */
  isAssignedDriver: boolean;
};

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

/** Terminal states accept no further transitions. */
export const TERMINAL_STATUSES: readonly DeliveryStatus[] = ["completed"];

type Edge = {
  from: DeliveryStatus;
  to: DeliveryStatus;
  /** Roles permitted to make this move. */
  allow: DeliveryActorRole[];
  /** When true, a `driver` actor must be the assigned driver. */
  requiresAssignment: boolean;
};

const EDGES: Edge[] = [
  { from: "pending", to: "assigned", allow: ["admin"], requiresAssignment: false },

  // The driver starting the run. This is what /api/delivery/mark-in-transit does.
  { from: "assigned", to: "in_transit", allow: ["driver", "admin"], requiresAssignment: true },

  { from: "in_transit", to: "completed", allow: ["driver", "admin"], requiresAssignment: true },

  // Operations may cancel anything that is not terminal.
  { from: "pending", to: "cancelled", allow: ["admin"], requiresAssignment: false },
  { from: "assigned", to: "cancelled", allow: ["admin"], requiresAssignment: false },
  { from: "in_transit", to: "cancelled", allow: ["admin"], requiresAssignment: false },

  // Reinstatement returns a cancelled delivery to the queue.
  { from: "cancelled", to: "pending", allow: ["admin"], requiresAssignment: false },
];

export type TransitionDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "unknown_status"
    | "terminal_state"
    | "not_an_allowed_transition"
    | "role_not_permitted"
    | "driver_not_assigned";
};

export function canTransition(
  from: unknown,
  to: unknown,
  actor: TransitionActor | null | undefined
): TransitionDecision {
  if (!isDeliveryStatus(from) || !isDeliveryStatus(to)) {
    return { allowed: false, reason: "unknown_status" };
  }
  if (!actor) {
    return { allowed: false, reason: "role_not_permitted" };
  }
  if (TERMINAL_STATUSES.includes(from)) {
    return { allowed: false, reason: "terminal_state" };
  }

  const edge = EDGES.find((e) => e.from === from && e.to === to);
  if (!edge) {
    return { allowed: false, reason: "not_an_allowed_transition" };
  }
  if (!edge.allow.includes(actor.role)) {
    return { allowed: false, reason: "role_not_permitted" };
  }
  if (
    edge.requiresAssignment &&
    actor.role === "driver" &&
    !actor.isAssignedDriver
  ) {
    return { allowed: false, reason: "driver_not_assigned" };
  }

  return { allowed: true, reason: "ok" };
}

/** The states from which a given target is reachable. Useful for guards. */
export function allowedSourcesFor(to: DeliveryStatus): DeliveryStatus[] {
  return EDGES.filter((e) => e.to === to).map((e) => e.from);
}
