/**
 * MER-014 / MER-015 permission matrix.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS AND WHAT IT IS BOUNDED BY
 * ---------------------------------------------------------------------------
 *
 * TRM-002 (decided 2026-08-06) names the five roles and their permissions for
 * ONE domain, and says so in its own `scope` field: "conversations and
 * messaging only. This decision does not define any other permission for these
 * roles." DRP-001 covers exactly one more thing — who may create and submit a
 * delivery request — and its note repeats that it "is not the complete
 * team-role matrix".
 *
 * So the permissions for SETTINGS and TEAM MANAGEMENT are not decided
 * anywhere. This module is a BOUNDED IMPLEMENTATION DECISION filling that gap,
 * and it is deliberately one small pure file so that when the registry record
 * lands it replaces exactly one thing.
 *
 * The bound: least privilege, modelled on the two decisions that DO exist.
 *   - Write is the narrow set (owner, manager), the same shape DRP-001 uses
 *     when it limits writes to a subset.
 *   - Granting or revoking OWNER is narrower still — owner only — because the
 *     owner role is the one that can dismantle the workspace.
 *   - Read is every active member, mirroring the delivery-request read rule.
 *   - `invited` and `disabled` members get NOTHING, per DRP-001's status rule.
 *   - An unrecognised role gets NOTHING. Fail closed, the same shape as
 *     `memberMayRead`/`memberMayPost` in conversations/states.ts.
 *
 * TRM-002's acceptance criterion — "each of the five roles has an explicit
 * permission set before MER-015 ships" — is satisfied by this matrix being
 * explicit, exhaustive over the five roles, and unit-tested.
 *
 * Do NOT cite DRP-001 as the authority for anything here: DRP-001 is scoped to
 * request create/submit and says so.
 *
 * Pure and dependency-free, so the whole matrix is testable without a database.
 */

import type { MemberRole, MemberStatus } from "@/lib/couranr/requests/permissions";

export type { MemberRole, MemberStatus };

/** Everything a person can attempt on the two settings screens. */
export const SETTINGS_CAPABILITIES = [
  /** Read the business profile, pickup defaults, category, payer default. */
  "settings.read",
  /** Change any of the above. */
  "settings.write",
  /** See the member list, their roles and their statuses. */
  "team.read",
  /** Invite an existing Couranr user into this workspace. */
  "team.invite",
  /** Change a member's role to any NON-owner role. */
  "team.change_role",
  /**
   * Grant or revoke the OWNER role specifically. Separate from
   * `team.change_role` because it is the one change that can hand over — or
   * take away — control of the workspace.
   */
  "team.grant_owner",
  /** Disable a member's access, and restore it. */
  "team.set_member_status",
] as const;
export type SettingsCapability = (typeof SETTINGS_CAPABILITIES)[number];

/**
 * The matrix, written out in full rather than derived, so reading this file
 * tells you what every role may do without running anything.
 *
 * Every one of the five schema roles appears. There is no sixth role: the
 * registry's prose names ("counter-staff", "view-only") are LABELS for
 * `dispatcher` and `viewer`, not additional roles, and the database CHECK
 * constraint permits exactly these five.
 */
const MATRIX: Readonly<Record<MemberRole, readonly SettingsCapability[]>> = {
  owner: [
    "settings.read",
    "settings.write",
    "team.read",
    "team.invite",
    "team.change_role",
    "team.grant_owner",
    "team.set_member_status",
  ],
  manager: [
    "settings.read",
    "settings.write",
    "team.read",
    "team.invite",
    "team.change_role",
    "team.set_member_status",
  ],
  dispatcher: ["settings.read", "team.read"],
  viewer: ["settings.read", "team.read"],
  billing: ["settings.read", "team.read"],
};

/**
 * Human-readable role descriptions for MER-015.
 *
 * The conversation sentence is NOT decoration: TRM-002 decided that `viewer`
 * and `billing` may neither read nor send messages, and a team screen that
 * showed only "view only" would leave an owner to discover that by surprise.
 * Every string here is a statement about a permission this build enforces.
 */
export const ROLE_DESCRIPTIONS: Readonly<Record<MemberRole, string>> = {
  owner:
    "Full access. Can change settings, invite teammates, change roles including owner, and use messages.",
  manager:
    "Can change settings, invite teammates, change non-owner roles, create deliveries, and use messages.",
  dispatcher:
    "Can create and submit deliveries and use messages. Cannot change settings or manage the team.",
  viewer:
    "Read-only. Can see deliveries and settings. Has no access to messages at all.",
  billing:
    "Read-only, for billing contacts. Can see deliveries and settings. Has no access to messages at all.",
};

/** The label MER-015 shows, with the registry's prose name where it differs. */
export const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  owner: "Owner",
  manager: "Manager",
  dispatcher: "Dispatcher (counter staff)",
  viewer: "View only",
  billing: "Billing",
};

export const MEMBER_ROLES: readonly MemberRole[] = [
  "owner",
  "manager",
  "dispatcher",
  "viewer",
  "billing",
];

export type SettingsActor = {
  role: string | null | undefined;
  status: string | null | undefined;
};

/**
 * May this member perform this capability?
 *
 * Takes plain strings because the values arrive from the database, and a role
 * this build has never heard of must be REFUSED rather than throw on a screen
 * someone is trying to work from.
 */
export function memberMay(actor: SettingsActor, capability: SettingsCapability): boolean {
  // Only an active membership carries any capability. `invited` has not
  // accepted yet and `disabled` has been switched off; both get nothing.
  if (actor.status !== "active") return false;
  const allowed = MATRIX[actor.role as MemberRole];
  if (!allowed) return false; // unknown role: fail closed
  return allowed.includes(capability);
}

/**
 * Which capability a role change requires.
 *
 * Moving a member TO owner, or away FROM owner, is `team.grant_owner`.
 * Anything else is `team.change_role`. Both directions matter: demoting the
 * only other owner is as consequential as promoting someone.
 */
export function capabilityForRoleChange(
  fromRole: string,
  toRole: string
): SettingsCapability {
  return fromRole === "owner" || toRole === "owner"
    ? "team.grant_owner"
    : "team.change_role";
}
