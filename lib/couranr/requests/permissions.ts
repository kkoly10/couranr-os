/**
 * BOUNDED delivery-request permissions for the first merchant slice.
 *
 * Registry: DRP-001 (decided). This is NOT the complete team-role matrix —
 * TRM-002 remains unresolved and covers everything beyond request creation
 * and submission.
 *
 * Pure and dependency-free so the whole matrix is unit-testable.
 */

export type MemberRole = "owner" | "manager" | "dispatcher" | "viewer" | "billing";
export type MemberStatus = "active" | "invited" | "disabled";

export type Membership = {
  businessAccountId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
};

export type RequestActor =
  | { kind: "anonymous" }
  | { kind: "operations"; userId: string }
  | { kind: "member"; userId: string; membership: Membership | null };

export type RequestCapability = "create" | "submit" | "read" | "review";

export type PermissionDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "anonymous"
    | "not_a_member"
    | "membership_not_active"
    | "role_may_not_write"
    | "role_may_not_review"
    | "wrong_business";
};

/** Roles that may create and submit a delivery request. */
const WRITE_ROLES: readonly MemberRole[] = ["owner", "manager", "dispatcher"];

function sameId(a: string | null | undefined, b: string | null | undefined) {
  const l = typeof a === "string" ? a.trim() : "";
  const r = typeof b === "string" ? b.trim() : "";
  if (!l || !r) return false;
  return l === r;
}

/**
 * Can `actor` perform `capability` on a request belonging to
 * `businessAccountId`?
 */
export function canActOnDeliveryRequest(
  actor: RequestActor,
  capability: RequestCapability,
  businessAccountId: string | null
): PermissionDecision {
  if (actor.kind === "anonymous") {
    return { allowed: false, reason: "anonymous" };
  }

  // Couranr Operations reads and reviews across businesses. It does not create
  // or submit on a merchant's behalf in this slice.
  if (actor.kind === "operations") {
    if (capability === "read" || capability === "review") {
      return { allowed: true, reason: "ok" };
    }
    return { allowed: false, reason: "role_may_not_write" };
  }

  const m = actor.membership;
  if (!m) return { allowed: false, reason: "not_a_member" };
  if (!sameId(m.userId, actor.userId)) return { allowed: false, reason: "not_a_member" };
  if (!sameId(m.businessAccountId, businessAccountId)) {
    return { allowed: false, reason: "wrong_business" };
  }
  if (m.status !== "active") {
    return { allowed: false, reason: "membership_not_active" };
  }

  // Only Operations reviews.
  if (capability === "review") {
    return { allowed: false, reason: "role_may_not_review" };
  }

  // Every active member of the right business may read.
  if (capability === "read") return { allowed: true, reason: "ok" };

  // create / submit
  if (!WRITE_ROLES.includes(m.role)) {
    return { allowed: false, reason: "role_may_not_write" };
  }
  return { allowed: true, reason: "ok" };
}

export const DELIVERY_REQUEST_WRITE_ROLES = WRITE_ROLES;
