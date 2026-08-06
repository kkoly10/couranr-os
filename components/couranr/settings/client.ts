"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/**
 * Browser data access for MER-014 and MER-015.
 *
 * Goes through `call` rather than a raw fetch so every request carries the
 * Bearer token the canonical routes resolve their actor from. A hand-rolled
 * fetch carries none, which is exactly how the merchant authorize call came
 * back 401 the first time it was driven in a browser.
 */

export type WorkspaceSettingsView = {
  businessAccountId: string;
  name: string;
  slug: string | null;
  timezone: string;
  workspace: {
    businessCategory: string;
    pickupAddress: any;
    contactPhone: string | null;
    payerDefault: string;
    policiesVersion: string | null;
    policiesAcceptedAt: string | null;
  } | null;
  viewer: { role: string; status: string };
};

export type TeamMemberView = {
  id: string;
  userId: string;
  role: string;
  status: string;
  email: string | null;
  joinedAt: string | null;
  createdAt: string;
  isSelf: boolean;
};

const tenant = (id: string) => `businessAccountId=${encodeURIComponent(id)}`;

export function fetchSettings(businessAccountId: string): Promise<ApiResult<WorkspaceSettingsView>> {
  return call(`/api/couranr/me/settings?${tenant(businessAccountId)}`);
}

export function saveSettings(input: {
  businessAccountId: string;
  name?: string;
  businessCategory?: string;
  pickupAddress?: unknown;
  contactPhone?: string;
  payerDefault?: string;
}): Promise<ApiResult<WorkspaceSettingsView>> {
  const { businessAccountId, ...rest } = input;
  return call(`/api/couranr/me/settings?${tenant(businessAccountId)}`, {
    method: "PATCH",
    body: rest,
  });
}

export function fetchTeam(
  businessAccountId: string
): Promise<ApiResult<{ members: TeamMemberView[] }>> {
  return call(`/api/couranr/me/team?${tenant(businessAccountId)}`);
}

export function inviteTeamMember(input: {
  businessAccountId: string;
  email: string;
  role: string;
}): Promise<ApiResult<{ member: any }>> {
  return call(`/api/couranr/me/team?${tenant(input.businessAccountId)}`, {
    method: "POST",
    body: { email: input.email, role: input.role },
  });
}

/**
 * Every member mutation names an ACTION. No route accepts a target column, and
 * `change_role` sends the role the browser BELIEVES is current only so the
 * server can pick the right capability — the SQL re-reads the real one under a
 * lock, so a stale value cannot widen what the caller may do.
 */
export function changeTeamMemberRole(input: {
  businessAccountId: string;
  memberId: string;
  fromRole: string;
  toRole: string;
}): Promise<ApiResult<{ member: any }>> {
  return call(
    `/api/couranr/me/team/${encodeURIComponent(input.memberId)}?${tenant(input.businessAccountId)}`,
    { method: "POST", body: { action: "change_role", fromRole: input.fromRole, toRole: input.toRole } }
  );
}

export function setTeamMemberStatus(input: {
  businessAccountId: string;
  memberId: string;
  action: "disable" | "reactivate";
}): Promise<ApiResult<{ member: any }>> {
  return call(
    `/api/couranr/me/team/${encodeURIComponent(input.memberId)}?${tenant(input.businessAccountId)}`,
    { method: "POST", body: { action: input.action } }
  );
}

export type PendingInvitation = {
  businessAccountId: string;
  name: string;
  role: string;
};

export function fetchMyInvitations(): Promise<ApiResult<{ invitations: PendingInvitation[] }>> {
  return call("/api/couranr/me/invitations");
}

export function acceptInvitation(businessAccountId: string): Promise<ApiResult<{ member: any }>> {
  return call("/api/couranr/me/invitations", {
    method: "POST",
    body: { businessAccountId },
  });
}
