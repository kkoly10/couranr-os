/**
 * Managed dispatch vocabularies.
 *
 * Pure and dependency-free so both the server commands and the browser render
 * from ONE list. A second copy of "which driver states may be assigned" is a
 * second chance to disagree with the database, and the disagreement would show
 * up as an operator being offered a driver the command then refuses.
 *
 * Nothing here decides anything about a real row. Compatibility is settled in
 * SQL against stored rows; these are the names and the copy.
 */

export const DRIVER_STATES = ["pending", "active", "suspended", "inactive"] as const;
export type DriverState = (typeof DRIVER_STATES)[number];

export const AVAILABILITY_STATES = ["available", "unavailable", "on_delivery"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/**
 * What a person may SET. `on_delivery` is missing on purpose: it is a
 * consequence of an assignment, and only assign/replace may write it. The SQL
 * refuses it too — this list exists so the UI never offers it.
 */
export const SETTABLE_AVAILABILITY: readonly AvailabilityState[] = ["available", "unavailable"];

export const VEHICLE_CLASSES = ["cargo_bike", "car", "van", "box_truck"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const ASSIGNMENT_STATES = ["active", "replaced", "cancelled"] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

/**
 * Capability ordering, mirroring `couranr_vehicle_class_rank`. Substitution is
 * upward only: a van covers a car requirement, a car does not cover a van.
 *
 * An unknown class ranks 0 and therefore satisfies nothing — the same
 * fail-closed direction the SQL takes, so a class added to one side and not the
 * other under-offers rather than over-offers.
 */
export function vehicleClassRank(c: string): number {
  const i = (VEHICLE_CLASSES as readonly string[]).indexOf(c);
  return i < 0 ? 0 : i + 1;
}

/** Advisory only. The database decides; this keeps the selector from lying. */
export function classSatisfies(vehicleClass: string, requiredClass: string): boolean {
  const req = vehicleClassRank(requiredClass);
  if (req === 0) return false;
  return vehicleClassRank(vehicleClass) >= req;
}

/** A driver may take new work only when BOTH of these hold. */
export function driverIsAssignable(d: {
  driverState: string;
  availabilityState: string;
  active: boolean;
}): boolean {
  return d.active && d.driverState === "active" && d.availabilityState === "available";
}

/**
 * Why a driver cannot take work. Same shape as the vehicle reason codes so
 * OPS-003 renders both through one path.
 */
export function driverIneligibility(d: {
  driverState: string;
  availabilityState: string;
  active: boolean;
}): DispatchReason | null {
  if (!d.active || d.driverState !== "active") return "driver_not_active";
  if (d.availabilityState !== "available") return "driver_not_available";
  return null;
}

/**
 * The closed set of reasons a driver or vehicle is ineligible.
 *
 * These strings are produced by `couranr_vehicle_incompatibility` and by the
 * command layer, and they are the ONLY thing the browser switches on. Copy
 * lives here; the reason travels as a code so the server and the screen can
 * never drift into telling an operator two different stories.
 */
export const DISPATCH_REASONS = [
  "driver_not_found",
  "driver_not_active",
  "driver_not_available",
  "vehicle_not_found",
  "vehicle_inactive",
  "vehicle_unavailable",
  "vehicle_assigned_to_another_driver",
  "vehicle_class_too_small",
  "vehicle_payload_too_low",
  "delivery_not_scheduled",
  "delivery_not_assigned",
  "delivery_already_assigned",
  "payment_not_captured",
  "service_plan_not_confirmed",
  "no_active_assignment",
] as const;
export type DispatchReason = (typeof DISPATCH_REASONS)[number];

export function isDispatchReason(v: unknown): v is DispatchReason {
  return typeof v === "string" && (DISPATCH_REASONS as readonly string[]).includes(v);
}

const REASON_COPY: Record<DispatchReason, string> = {
  driver_not_found: "That driver no longer exists.",
  driver_not_active: "This driver is not active. Activate them before assigning work.",
  driver_not_available: "This driver is already on a delivery or is marked unavailable.",
  vehicle_not_found: "That vehicle no longer exists.",
  vehicle_inactive: "This vehicle is not active.",
  vehicle_unavailable: "This vehicle is already on a delivery or is marked unavailable.",
  vehicle_assigned_to_another_driver: "This vehicle belongs to a different driver.",
  vehicle_class_too_small: "This vehicle is smaller than the class Couranr committed to.",
  vehicle_payload_too_low: "This vehicle cannot carry the weight Couranr committed to.",
  delivery_not_scheduled: "This delivery is not waiting for assignment.",
  delivery_not_assigned: "This delivery is no longer assigned, so it cannot be reassigned here.",
  delivery_already_assigned: "This delivery already has a driver.",
  payment_not_captured: "The payment for this delivery has not been captured.",
  service_plan_not_confirmed: "The service plan for this delivery is not confirmed.",
  no_active_assignment: "There is no active assignment to replace.",
};

/**
 * Never returns an empty string or a raw code. An unrecognised reason — an
 * older event, or a code a newer build raised — falls back to something true
 * and unalarming rather than leaking an identifier to an operator.
 */
export function dispatchReasonMessage(reason: unknown): string {
  return isDispatchReason(reason)
    ? REASON_COPY[reason]
    : "Couranr cannot use that driver or vehicle for this delivery.";
}

export const DRIVER_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  inactive: "Inactive",
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  unavailable: "Unavailable",
  on_delivery: "On a delivery",
};

export const VEHICLE_CLASS_LABELS: Record<string, string> = {
  cargo_bike: "Cargo bike",
  car: "Car",
  van: "Van",
  box_truck: "Box truck",
};

/** Stable per delivery + attempt, so a double-click cannot assign twice. */
export function assignmentIdempotencyKey(deliveryId: string, deliveryVersion: number): string {
  return `couranr:assign:${deliveryId}:v${deliveryVersion}`;
}

/**
 * Scoped to the assignment being REPLACED, not to the delivery: the delivery
 * does not move during a replacement, so a delivery-scoped key would collide
 * on the second replacement and silently return the first one's result.
 */
export function replacementIdempotencyKey(
  deliveryId: string,
  replacedAssignmentId: string,
  assignmentVersion: number
): string {
  return `couranr:reassign:${deliveryId}:${replacedAssignmentId}:v${assignmentVersion}`;
}
