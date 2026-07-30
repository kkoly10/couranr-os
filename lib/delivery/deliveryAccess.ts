import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Server-side authorization for delivery proof-of-delivery material.
 *
 * Who may see a delivery's photos:
 *   - a Couranr Operations admin
 *   - the driver assigned to that delivery
 *   - the customer who owns the delivery's order
 *
 * Authorization is resolved HERE, in application code, from an already-verified
 * identity. It is deliberately not pushed down into a storage policy: the
 * `delivery-photos` bucket has no policies, both writers are service-role, and a
 * policy that re-derived this by joining `deliveries` and `orders` would add a
 * cross-table dependency for a caller that does not exist.
 */

export type DeliveryAccessRole = "admin" | "driver" | "customer";

export type DeliveryAccessSubject = {
  userId: string;
  isAdmin: boolean;
};

export type DeliveryAccessRecord = {
  deliveryId: string;
  driverId: string | null;
  customerId: string | null;
};

export type DeliveryAccessDecision = {
  allowed: boolean;
  role: DeliveryAccessRole | null;
  reason: string;
};

/**
 * Identifier comparison that cannot grant access on absent data.
 *
 * A plain `a === b` returns true for two nulls, two empty strings, or two
 * undefineds. An unassigned delivery has `driver_id = null`, so a subject whose
 * id failed to resolve would match it. Every comparison below goes through here.
 */
function sameId(a: string | null | undefined, b: string | null | undefined) {
  const left = typeof a === "string" ? a.trim() : "";
  const right = typeof b === "string" ? b.trim() : "";
  if (!left || !right) return false;
  return left === right;
}

function isPresentId(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pure decision. No I/O, so the authorization matrix is unit-testable without
 * mocking Supabase.
 */
export function resolveDeliveryAccess(
  subject: DeliveryAccessSubject | null | undefined,
  delivery: DeliveryAccessRecord | null | undefined
): DeliveryAccessDecision {
  if (!subject || !isPresentId(subject.userId)) {
    return { allowed: false, role: null, reason: "anonymous" };
  }

  if (!delivery) {
    return { allowed: false, role: null, reason: "delivery_not_found" };
  }

  if (subject.isAdmin === true) {
    return { allowed: true, role: "admin", reason: "ops_admin" };
  }

  if (sameId(delivery.driverId, subject.userId)) {
    return { allowed: true, role: "driver", reason: "assigned_driver" };
  }

  if (sameId(delivery.customerId, subject.userId)) {
    return { allowed: true, role: "customer", reason: "owning_customer" };
  }

  return { allowed: false, role: null, reason: "not_a_participant" };
}

/** Signed-URL lifetime per role. Ops review needs longer than a driver tap. */
export function signedUrlTtlSeconds(role: DeliveryAccessRole): number {
  return role === "admin" ? 60 * 15 : 60 * 10;
}

/**
 * Loads the two identifiers the decision needs. Uses the service-role client so
 * the lookup itself is not subject to RLS — the authorization decision is made
 * above, from a verified identity, not by the database.
 */
export async function loadDeliveryAccessRecord(
  deliveryId: string
): Promise<DeliveryAccessRecord | null> {
  const id = (deliveryId || "").trim();
  if (!id) return null;

  const { data, error } = await supabaseAdmin
    .from("deliveries")
    .select("id, driver_id, order_id, orders:order_id ( id, customer_id )")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  // PostgREST returns an embedded relation as either an object or a
  // single-element array depending on how it infers the relationship.
  const orders = (data as any).orders;
  const order = Array.isArray(orders) ? orders[0] : orders;

  return {
    deliveryId: String((data as any).id),
    driverId: (data as any).driver_id ?? null,
    customerId: order?.customer_id ?? null,
  };
}

/** Reads `profiles.role`. Returns false rather than throwing on any failure. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const id = (userId || "").trim();
  if (!id) return false;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return false;
  return (data as any).role === "admin";
}

/** Convenience: verified user id -> decision for one delivery. */
export async function authorizeDeliveryAccess(
  userId: string,
  deliveryId: string
): Promise<DeliveryAccessDecision & { record: DeliveryAccessRecord | null }> {
  const trimmed = (userId || "").trim();
  if (!trimmed) {
    return { allowed: false, role: null, reason: "anonymous", record: null };
  }

  const [record, isAdmin] = await Promise.all([
    loadDeliveryAccessRecord(deliveryId),
    isAdminUser(trimmed),
  ]);

  const decision = resolveDeliveryAccess({ userId: trimmed, isAdmin }, record);
  return { ...decision, record };
}
