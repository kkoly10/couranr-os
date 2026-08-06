import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  capabilityForRoleChange,
  memberMay,
  type SettingsCapability,
} from "@/lib/couranr/settings/permissions";
import { normalizeAddressInput } from "@/lib/couranr/onboarding/workspace";

assertServerOnly("lib/couranr/settings/commands.ts");

/**
 * MER-014 / MER-015 command layer.
 *
 * Same contract as every other Couranr command family: one `.rpc()` per
 * mutation into a service-role-only SQL function that performs the change and
 * its audit row in one transaction, with the actor verified first.
 *
 * The capability check appears BOTH here and inside the SQL. That is not
 * redundancy for its own sake — the TypeScript matrix is what the UI reads to
 * decide which controls to render, and the SQL is what refuses a request that
 * reached the database another way. If they ever disagree, the database wins
 * and the caller gets a refusal rather than a surprise.
 */

export const TEAM_RPC = {
  invite: "couranr_invite_member",
  accept: "couranr_accept_member_invite",
  changeRole: "couranr_change_member_role",
  disable: "couranr_disable_member",
  reactivate: "couranr_reactivate_member",
  updateProfile: "couranr_update_workspace_profile",
} as const;

export type SettingsFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type SettingsResult<T> = { ok: true; value: T } | SettingsFailure;

export function isSettingsFailure(r: { ok: boolean }): r is SettingsFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): SettingsFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: SettingsFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<SettingsResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/** The membership the caller holds in the business they named. */
export type ActorMembership = { userId: string; role: string; status: string };

/**
 * Narrow a resolved request actor to the MEMBERSHIP these screens require.
 *
 * Couranr Operations is deliberately refused here even though it outranks a
 * merchant elsewhere. Settings and team management are the tenant's own
 * business: an operator is not a member of the workspace, holds no role in
 * it, and must not be able to invite themselves into one or rewrite a
 * merchant's pickup address. Operations acts through the Operations surface,
 * against delivery requests — not by editing a merchant's team.
 *
 * Returns null for anything that is not an active-or-otherwise membership
 * row; the capability matrix then decides what that membership may actually
 * do, so a `disabled` member still reaches the matrix and is refused there
 * rather than being indistinguishable from a non-member.
 */
export function settingsActorFrom(resolved: {
  userId: string;
  actor: { kind: string; membership?: { role: string; status: string } | null };
}): ActorMembership | null {
  if (resolved.actor.kind !== "member") return null;
  const m = resolved.actor.membership;
  if (!m) return null;
  return { userId: resolved.userId, role: String(m.role), status: String(m.status) };
}

/**
 * The capability gate every command below runs first.
 *
 * Kept as one function so the failure SHAPE is identical everywhere: a refusal
 * is `not_permitted` with no detail about what would have been allowed, which
 * is what stops the API from being a probe for someone else's role.
 */
function requireCapability(
  operation: string,
  actor: ActorMembership,
  capability: SettingsCapability
): SettingsFailure | null {
  if (memberMay({ role: actor.role, status: actor.status }, capability)) return null;
  return fail({
    operation,
    code: "not_permitted",
    detail: { capability, role: actor.role, status: actor.status },
    message: "You do not have access to change this.",
  });
}

/* ----------------------------------------------------------- MER-014 ---- */

export type WorkspaceSettingsView = {
  businessAccountId: string;
  name: string;
  /** Read-only. The hosted-request URL depends on it (MER-013). */
  slug: string | null;
  timezone: string;
  /** Null when this business predates the Couranr workspace profile. */
  workspace: {
    businessCategory: string;
    pickupAddress: unknown;
    contactPhone: string | null;
    payerDefault: string;
    policiesVersion: string | null;
    policiesAcceptedAt: string | null;
  } | null;
  /** The caller's own membership, so the UI renders the right affordances. */
  viewer: { role: string; status: string };
};

/**
 * Read the settings a merchant may see.
 *
 * FAILS CLOSED on either lookup erroring. A failed workspace read must never
 * render as "this business has no workspace profile" — that is the same
 * mistake `listActiveMemberships` was fixed for, where a database error read
 * to the user as "you have no business".
 */
export async function getWorkspaceSettings(params: {
  actor: ActorMembership;
  businessAccountId: string;
}): Promise<SettingsResult<WorkspaceSettingsView>> {
  const op = "getWorkspaceSettings";

  const denied = requireCapability(op, params.actor, "settings.read");
  if (denied) return denied;

  const account = await supabaseAdmin
    .from("business_accounts")
    .select("id,name,slug,timezone")
    .eq("id", params.businessAccountId)
    .maybeSingle();

  if (account.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "business_accounts", error: account.error } });
  }
  if (!account.data) {
    return fail({ operation: op, code: "not_found", detail: { businessAccountId: params.businessAccountId } });
  }

  const ws = await supabaseAdmin
    .from("couranr_merchant_workspaces")
    .select(
      "business_category,pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at"
    )
    .eq("business_account_id", params.businessAccountId)
    .maybeSingle();

  // An ERROR is not the same as "no row". Only the second is allowed to mean
  // the workspace profile is missing.
  if (ws.error) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_merchant_workspaces", error: ws.error },
    });
  }

  return {
    ok: true,
    value: {
      businessAccountId: params.businessAccountId,
      name: String(account.data.name ?? ""),
      slug: account.data.slug ?? null,
      timezone: String(account.data.timezone ?? "America/New_York"),
      workspace: ws.data
        ? {
            businessCategory: String(ws.data.business_category ?? ""),
            pickupAddress: ws.data.pickup_address ?? null,
            contactPhone: ws.data.contact_phone ?? null,
            payerDefault: String(ws.data.payer_default ?? "merchant"),
            policiesVersion: ws.data.policies_version ?? null,
            policiesAcceptedAt: ws.data.policies_accepted_at ?? null,
          }
        : null,
      viewer: { role: params.actor.role, status: params.actor.status },
    },
  };
}

export async function updateWorkspaceProfile(params: {
  actor: ActorMembership;
  businessAccountId: string;
  name?: string;
  businessCategory?: string;
  pickupAddress?: unknown;
  contactPhone?: string;
  payerDefault?: string;
}): Promise<SettingsResult<{ workspace: Record<string, any> }>> {
  const op = "updateWorkspaceProfile";

  const denied = requireCapability(op, params.actor, "settings.write");
  if (denied) return denied;

  // Reuse onboarding's normalizer rather than a second address parser, so a
  // pickup address edited here is shaped exactly like one captured at signup.
  let pickup: unknown = null;
  if (params.pickupAddress !== undefined && params.pickupAddress !== null) {
    const normalized = normalizeAddressInput(params.pickupAddress);
    if (!normalized.ok) {
      return fail({
        operation: op,
        code: "invalid_input",
        detail: { field: "pickupAddress", reason: normalized.reason },
        message: "Enter a street address, city, state and ZIP.",
      });
    }
    pickup = normalized.value;
  }

  const r = await callRpc<Record<string, any>>(op, TEAM_RPC.updateProfile, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_name: params.name ?? null,
    p_business_category: params.businessCategory ?? null,
    p_pickup_address: pickup,
    p_contact_phone: params.contactPhone ?? null,
    p_payer_default: params.payerDefault ?? null,
  });
  if (isSettingsFailure(r)) return r;
  return { ok: true, value: { workspace: r.value } };
}

/* ----------------------------------------------------------- MER-015 ---- */

export type TeamMemberView = {
  id: string;
  userId: string;
  role: string;
  status: string;
  /** The address the invitation was sent to, or the member's account email. */
  email: string | null;
  joinedAt: string | null;
  createdAt: string;
  /** True for the caller's own row, so the UI can label it and guard it. */
  isSelf: boolean;
};

/**
 * List the team.
 *
 * Emails come from the auth admin API for accepted members, and from
 * `invited_email` for pending ones. NOTHING ELSE from the auth user is
 * projected — no last-sign-in, no metadata, no provider — because a team
 * screen has no reason to publish another person's session history.
 */
export async function listTeamMembers(params: {
  actor: ActorMembership;
  businessAccountId: string;
}): Promise<SettingsResult<{ members: TeamMemberView[] }>> {
  const op = "listTeamMembers";

  const denied = requireCapability(op, params.actor, "team.read");
  if (denied) return denied;

  const rows = await supabaseAdmin
    .from("business_members")
    .select("id,user_id,role,status,invited_email,joined_at,created_at")
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: true });

  if (rows.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "business_members", error: rows.error } });
  }
  if (!Array.isArray(rows.data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "business_members", reason: "no error and no rows array" },
    });
  }

  const members: TeamMemberView[] = [];
  for (const row of rows.data) {
    let email: string | null = row.invited_email ?? null;
    if (!email) {
      // Best effort: a lookup failure costs the email, never the row. A team
      // list that vanished because one auth lookup hiccuped would be a worse
      // answer than one showing a member without their address.
      try {
        const u = await supabaseAdmin.auth.admin.getUserById(String(row.user_id));
        email = u.data?.user?.email ?? null;
      } catch {
        email = null;
      }
    }
    members.push({
      id: String(row.id),
      userId: String(row.user_id),
      role: String(row.role),
      status: String(row.status),
      email,
      joinedAt: row.joined_at ?? null,
      createdAt: String(row.created_at),
      isSelf: String(row.user_id) === params.actor.userId,
    });
  }

  return { ok: true, value: { members } };
}

/**
 * Invite an EXISTING Couranr user.
 *
 * The email is resolved to a user id HERE, because only the auth admin API can
 * do it. A miss is reported as `not_found` with copy that says what to do —
 * deliberately not as "no such user", which would turn this into an oracle for
 * whether an address has a Couranr account.
 */
export async function inviteMember(params: {
  actor: ActorMembership;
  businessAccountId: string;
  email: string;
  role: string;
}): Promise<SettingsResult<{ member: Record<string, any> }>> {
  const op = "inviteMember";

  const denied = requireCapability(op, params.actor, "team.invite");
  if (denied) return denied;

  // Granting owner is narrower than inviting; check the specific capability.
  if (params.role === "owner") {
    const ownerDenied = requireCapability(op, params.actor, "team.grant_owner");
    if (ownerDenied) return ownerDenied;
  }

  const email = String(params.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { field: "email" },
      message: "Enter a valid email address.",
    });
  }

  const found = await findUserIdByEmail(email);
  if (found === "error") {
    return fail({ operation: op, code: "internal", detail: { lookup: "auth.admin.listUsers" } });
  }
  if (!found) {
    return fail({
      operation: op,
      code: "not_found",
      detail: { reason: "no_account_for_email" },
      message:
        "That person needs a Couranr account before they can be invited. Ask them to sign up first, then invite this address again.",
    });
  }

  const r = await callRpc<Record<string, any>>(op, TEAM_RPC.invite, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_invited_user_id: found,
    p_invited_email: email,
    p_role: params.role,
  });
  if (isSettingsFailure(r)) return r;
  return { ok: true, value: { member: r.value } };
}

/**
 * Resolve an email to a user id.
 *
 * `listUsers` is paginated and has no server-side email filter in the version
 * pinned here, so this walks pages and compares case-insensitively. Bounded at
 * 20 pages so a large project cannot turn one invite into an unbounded scan;
 * the bound is reported as "not found", which is the safe direction.
 */
async function findUserIdByEmail(email: string): Promise<string | null | "error"> {
  try {
    for (let page = 1; page <= 20; page += 1) {
      const res = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (res.error) return "error";
      const users = res.data?.users ?? [];
      const hit = users.find((u: any) => String(u.email ?? "").toLowerCase() === email);
      if (hit) return String(hit.id);
      if (users.length < 200) return null;
    }
    return null;
  } catch {
    return "error";
  }
}

/**
 * The invitee accepts their own invitation.
 *
 * Takes no membership: the caller is by definition NOT an active member yet,
 * so there is no capability to check. The SQL verifies that a pending
 * invitation exists for this exact user in this exact business, which is the
 * whole authorization.
 */
export async function acceptInvitation(params: {
  userId: string;
  businessAccountId: string;
}): Promise<SettingsResult<{ member: Record<string, any> }>> {
  const op = "acceptInvitation";
  const r = await callRpc<Record<string, any>>(op, TEAM_RPC.accept, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.userId,
  });
  if (isSettingsFailure(r)) return r;
  return { ok: true, value: { member: r.value } };
}

/** Every pending invitation for this user, across businesses. */
export async function listMyInvitations(params: {
  userId: string;
}): Promise<SettingsResult<{ invitations: { businessAccountId: string; name: string; role: string }[] }>> {
  const op = "listMyInvitations";

  const rows = await supabaseAdmin
    .from("business_members")
    .select("business_account_id,role,business_accounts(name)")
    .eq("user_id", params.userId)
    .eq("status", "invited");

  if (rows.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "business_members", error: rows.error } });
  }
  if (!Array.isArray(rows.data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "business_members", reason: "no error and no rows array" },
    });
  }

  return {
    ok: true,
    value: {
      invitations: rows.data.map((r: any) => ({
        businessAccountId: String(r.business_account_id),
        name: String(r.business_accounts?.name ?? "a Couranr workspace"),
        role: String(r.role),
      })),
    },
  };
}

export async function changeMemberRole(params: {
  actor: ActorMembership;
  businessAccountId: string;
  memberId: string;
  fromRole: string;
  toRole: string;
}): Promise<SettingsResult<{ member: Record<string, any> }>> {
  const op = "changeMemberRole";

  // Which capability this needs depends on whether OWNER is on either side.
  const denied = requireCapability(
    op,
    params.actor,
    capabilityForRoleChange(params.fromRole, params.toRole)
  );
  if (denied) return denied;

  const r = await callRpc<Record<string, any>>(op, TEAM_RPC.changeRole, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_member_id: params.memberId,
    p_to_role: params.toRole,
  });
  if (isSettingsFailure(r)) return r;
  return { ok: true, value: { member: r.value } };
}

export async function setMemberStatus(params: {
  actor: ActorMembership;
  businessAccountId: string;
  memberId: string;
  to: "disabled" | "active";
}): Promise<SettingsResult<{ member: Record<string, any> }>> {
  const op = "setMemberStatus";

  const denied = requireCapability(op, params.actor, "team.set_member_status");
  if (denied) return denied;

  // `to` selects the COMMAND; it is never passed as a target state. Same rule
  // as readiness: the SQL function hard-codes its own destination.
  const fn = params.to === "disabled" ? TEAM_RPC.disable : TEAM_RPC.reactivate;

  const r = await callRpc<Record<string, any>>(op, fn, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_member_id: params.memberId,
  });
  if (isSettingsFailure(r)) return r;
  return { ok: true, value: { member: r.value } };
}
