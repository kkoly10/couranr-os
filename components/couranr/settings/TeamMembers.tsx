"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import {
  acceptInvitation,
  changeTeamMemberRole,
  fetchMyInvitations,
  fetchTeam,
  inviteTeamMember,
  setTeamMemberStatus,
  type PendingInvitation,
  type TeamMemberView,
} from "./client";
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  capabilityForRoleChange,
  memberMay,
} from "@/lib/couranr/settings/permissions";

/**
 * MER-015 — team and permissions.
 *
 * Registry-required states, each a real branch: PENDING INVITATION, ACTIVE,
 * DISABLED, and LAST-OWNER PROTECTION.
 *
 * Last-owner protection is enforced in SQL under a row lock, not here. This
 * screen's job is to explain it before it bites and to render the refusal
 * faithfully when it does — a client-side check alone would lose the race
 * between two people demoting the two remaining owners at once.
 *
 * "Remove" is `disable`. The membership row is the record of who had access
 * and when; deleting it to mean "removed" would destroy the audit. The button
 * says "Remove access" and the state it produces is `disabled`, which the
 * permission matrix already treats as no access at all.
 */

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  active: "success",
  invited: "info",
  disabled: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  invited: "Invitation pending",
  disabled: "Disabled",
};

export function TeamMembers() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [members, setMembers] = React.useState<TeamMemberView[] | null>(null);
  const [membersError, setMembersError] = React.useState<ApiFailure | null>(null);
  const [invitations, setInvitations] = React.useState<PendingInvitation[]>([]);

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("dispatcher");
  const [inviteNotice, setInviteNotice] = React.useState<string | null>(null);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setAccountsError(r);
        if (r.status === 401) setAccounts([]);
        return;
      }
      setAccounts(r.value.businessAccounts);
      if (r.value.businessAccounts.length >= 1) {
        setBusinessAccountId(r.value.businessAccounts[0].businessAccountId);
      }
    });
    // The invitee's own pending invitations are independent of any tenant.
    fetchMyInvitations().then((r) => {
      if (cancelled || isApiFailure(r)) return;
      setInvitations(r.value.invitations);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setMembers(null);
    setMembersError(null);
    fetchTeam(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setMembersError(r);
        return;
      }
      setMembers(r.value.members);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

  /** Turns a server refusal into copy that says what actually happened. */
  function describeFailure(f: ApiFailure): string {
    if (f.status === 409) {
      // The SQL raises `last_owner_protected` as CR409. Saying "reload and try
      // again" here would be actively wrong advice — reloading changes nothing.
      return "This business must always have at least one active owner. Give someone else the owner role first, then try again.";
    }
    if (f.status === 403) {
      return "Your role cannot make that change.";
    }
    return withReference(f);
  }

  async function run(key: string, fn: () => Promise<any>) {
    setBusy(key);
    setActionError(null);
    const r = await fn();
    setBusy(null);
    if (isApiFailure(r)) {
      setActionError(describeFailure(r));
      return false;
    }
    setReloadKey((k) => k + 1);
    return true;
  }

  if (accounts === null && accountsError) {
    return (
      <ErrorState
        title="We could not check your account"
        body={withReference(accountsError)}
        action={{ label: "Reload", onClick: () => router.refresh() }}
      />
    );
  }
  if (accounts === null) {
    return (
      <LoadingState label="Loading your team">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to manage your team"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const viewer = activeAccount
    ? { role: activeAccount.role, status: "active" }
    : { role: "", status: "" };
  const mayInvite = memberMay(viewer, "team.invite");
  const maySetStatus = memberMay(viewer, "team.set_member_status");

  const activeOwners = (members ?? []).filter(
    (m) => m.role === "owner" && m.status === "active"
  ).length;

  return (
    <Stack gap={6}>
      {/*
        REQUIRED STATE: pending invitation — the INVITEE's side.

        This is what makes an invitation real without any email delivery: the
        person who was invited sees it in their own session and accepts it.
        Nothing here can join a workspace that did not invite them.
      */}
      {invitations.length > 0 ? (
        <Stack gap={3}>
          {invitations.map((inv) => (
            <Alert
              key={inv.businessAccountId}
              tone="info"
              title={`You have been invited to ${inv.name}`}
            >
              <Stack gap={2}>
                <Text size="sm">
                  You were invited as {ROLE_LABELS[inv.role as never] ?? inv.role}. Accepting
                  gives you access to that business immediately.
                </Text>
                <div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === `accept:${inv.businessAccountId}`}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(`accept:${inv.businessAccountId}`, () =>
                        acceptInvitation(inv.businessAccountId)
                      )
                    }
                  >
                    Accept invitation
                  </Button>
                </div>
              </Stack>
            </Alert>
          ))}
        </Stack>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          title="No business account yet"
          body="Set up your business workspace before inviting a team."
          action={{ label: "Set up your workspace", href: "/app/business/onboarding" }}
        />
      ) : null}

      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.businessAccountId} value={a.businessAccountId}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Card>
      ) : null}

      {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

      {mayInvite ? (
        <Card>
          <CardHeader
            title="Invite a teammate"
            description="They need a Couranr account first — invite the email they signed up with."
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setInviteNotice(null);
              const ok = await run("invite", () =>
                inviteTeamMember({ businessAccountId, email: inviteEmail, role: inviteRole })
              );
              if (ok) {
                setInviteNotice(
                  `Invitation created for ${inviteEmail}. They will see it when they next sign in to Couranr.`
                );
                setInviteEmail("");
              }
            }}
            noValidate
          >
            <Stack gap={3}>
              <Field label="Email address" required>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Role" required hint={ROLE_DESCRIPTIONS[inviteRole as never]}>
                {(p) => (
                  <Select
                    {...p}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {MEMBER_ROLES.filter(
                      // Only an owner may hand out the owner role, so a manager
                      // is never offered a control the server would refuse.
                      (r) => r !== "owner" || memberMay(viewer, "team.grant_owner")
                    ).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy === "invite"}
                  disabled={Boolean(busy) || inviteEmail.trim() === ""}
                >
                  Send invitation
                </Button>
              </div>
              {inviteNotice ? (
                <Alert tone="success" title="Invitation created">
                  {/*
                    Says exactly what happened. Couranr does not email the
                    invitation — no delivery mechanism is specified — so this
                    must not claim one was sent.
                  */}
                  <Text size="sm">{inviteNotice}</Text>
                </Alert>
              ) : null}
            </Stack>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Team"
          description={activeAccount ? `Everyone with access to ${activeAccount.name}.` : undefined}
        />
        {membersError && membersError.status === 403 ? (
          <EmptyState
            title="You do not have access to this team"
            body="Ask an owner or manager of this business if you need access."
          />
        ) : membersError ? (
          // FAIL CLOSED: an error never renders as "no team members".
          <ErrorState
            title="Your team did not load"
            body={withReference(membersError)}
            action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
          />
        ) : members === null ? (
          <CardSkeleton lines={4} />
        ) : (
          <Stack gap={3}>
            {/*
              REQUIRED STATE: last-owner protection, explained BEFORE it is hit.
              The rule is enforced in SQL; this sentence is why a control is
              missing rather than why an error appeared.
            */}
            {activeOwners <= 1 ? (
              <Alert tone="info" title="Last owner protection">
                This business has one active owner. Couranr will not let that
                owner be removed, disabled or demoted — give someone else the
                owner role first.
              </Alert>
            ) : null}

            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="cr-visually-hidden-h">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const isLastActiveOwner =
                      m.role === "owner" && m.status === "active" && activeOwners <= 1;
                    const mayChangeThisRole = memberMay(
                      viewer,
                      capabilityForRoleChange(m.role, "manager")
                    );
                    return (
                      <tr key={m.id}>
                        <td>
                          <Stack gap={1}>
                            <Text size="sm">{m.email ?? "Couranr user"}</Text>
                            {m.isSelf ? (
                              <Text size="xs" muted>
                                You
                              </Text>
                            ) : null}
                          </Stack>
                        </td>
                        <td>
                          {mayChangeThisRole && !isLastActiveOwner && m.status !== "invited" ? (
                            <Select
                              aria-label={`Role for ${m.email ?? "this member"}`}
                              value={m.role}
                              disabled={Boolean(busy)}
                              onChange={(e) =>
                                run(`role:${m.id}`, () =>
                                  changeTeamMemberRole({
                                    businessAccountId,
                                    memberId: m.id,
                                    fromRole: m.role,
                                    toRole: e.target.value,
                                  })
                                )
                              }
                            >
                              {MEMBER_ROLES.filter(
                                (r) =>
                                  r === m.role ||
                                  memberMay(viewer, capabilityForRoleChange(m.role, r))
                              ).map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Text size="sm">{ROLE_LABELS[m.role as never] ?? m.role}</Text>
                          )}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>
                            {STATUS_LABEL[m.status] ?? m.status}
                          </Badge>
                        </td>
                        <td>
                          <Cluster gap={2}>
                            {maySetStatus && m.status !== "disabled" && !isLastActiveOwner ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busy === `disable:${m.id}`}
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  run(`disable:${m.id}`, () =>
                                    setTeamMemberStatus({
                                      businessAccountId,
                                      memberId: m.id,
                                      action: "disable",
                                    })
                                  )
                                }
                              >
                                Remove access
                              </Button>
                            ) : null}
                            {maySetStatus && m.status === "disabled" ? (
                              <Button
                                size="sm"
                                loading={busy === `reactivate:${m.id}`}
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  run(`reactivate:${m.id}`, () =>
                                    setTeamMemberStatus({
                                      businessAccountId,
                                      memberId: m.id,
                                      action: "reactivate",
                                    })
                                  )
                                }
                              >
                                Restore access
                              </Button>
                            ) : null}
                          </Cluster>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Stack>
        )}
      </Card>

      <Card>
        <CardHeader
          title="What each role can do"
          description="Couranr enforces these on the server, not just in this screen."
        />
        <TableScroll>
          <Table>
            <tbody>
              {MEMBER_ROLES.map((r) => (
                <tr key={r}>
                  <td>
                    <Text size="sm">
                      <strong>{ROLE_LABELS[r]}</strong>
                    </Text>
                  </td>
                  <td>
                    <Text size="sm" muted>
                      {ROLE_DESCRIPTIONS[r]}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <Card>
        <CardHeader title="Member activity" />
        {/*
          Honest empty state: Couranr records every membership change in
          couranr_team_events, but no read surface for it is specified and
          nothing reads it yet. An invented activity feed would be exactly the
          fabricated data the registry forbids.
        */}
        <Text size="sm" muted>
          Couranr records every team change. A per-member activity view is not
          available yet — contact Couranr Support if you need an access history
          for this business.
        </Text>
      </Card>
    </Stack>
  );
}
