"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  call,
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { memberMay } from "@/lib/couranr/settings/permissions";
import {
  ACKNOWLEDGEMENT_DESCRIPTIONS,
  ACKNOWLEDGEMENT_KINDS,
  ACKNOWLEDGEMENT_LABELS,
  ACTIVATION_STATE_DESCRIPTIONS,
  ACTIVATION_STATE_LABELS,
  ACTIVATION_STATE_TONE,
  type ActivationState,
} from "@/lib/couranr/activation/states";

/**
 * MER-003 — the live activation checklist.
 *
 * Registry-required states, each a real branch over the database:
 * not_started → in_progress → pending_couranr_review → live | blocked.
 *
 * The one thing this screen must never do is imply the merchant can activate
 * themselves. There is no control here that produces `live`: the furthest a
 * merchant can go is asking Couranr to review, and the button says exactly
 * that.
 */

export type ActivationView = {
  businessAccountId: string;
  state: string;
  blockedReason: string | null;
  contactVerifiedAt: string | null;
  testDeliveryRequestId: string | null;
  requestedAt: string | null;
  acknowledgements: Record<string, string>;
  requirements: { id: string; label: string; met: boolean; detail: string }[];
  canRequest: boolean;
  currentVersions: Record<string, string>;
};

export function fetchActivation(businessAccountId: string) {
  return call<ActivationView>(
    `/api/couranr/me/activation?businessAccountId=${encodeURIComponent(businessAccountId)}`
  );
}

function post(businessAccountId: string, body: Record<string, unknown>) {
  return call<ActivationView>(
    `/api/couranr/me/activation?businessAccountId=${encodeURIComponent(businessAccountId)}`,
    { method: "POST", body }
  );
}

export function ActivationChecklist({
  businessAccountId,
  mayRequest,
}: {
  businessAccountId: string;
  /**
   * Whether this member may ACT. Read is every active member; accepting terms
   * and asking for activation is owner/manager only, because those acts bind
   * the business. The route enforces the same capability — this prop only
   * decides whether a control a member cannot use is drawn at all.
   */
  mayRequest: boolean;
}) {
  const [view, setView] = React.useState<ActivationView | null>(null);
  const [error, setError] = React.useState<ApiFailure | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setView(null);
    setError(null);
    fetchActivation(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setError(r);
        return;
      }
      setView(r.value);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setActionError(null);
    const r = await post(businessAccountId, body);
    setBusy(null);
    if (isApiFailure(r)) {
      setActionError(
        r.status === 409
          ? "Some of the steps are not complete yet. Refresh and check the list."
          : withReference(r)
      );
      setReloadKey((k) => k + 1);
      return;
    }
    setView(r.value);
  }

  if (error && error.status === 403) {
    return (
      <EmptyState
        title="You do not have access to activation"
        body="Ask an owner or manager of this business if you need access."
      />
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Activation did not load"
        body={withReference(error)}
        action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
      />
    );
  }
  if (!view) {
    return (
      <LoadingState label="Loading activation">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  const state = view.state as ActivationState;
  const isLive = state === "live";
  const isPending = state === "pending_couranr_review";
  /**
   * A control is drawn only when this member could actually complete it.
   * Showing a viewer an "Accept" button that the route will refuse is worse
   * than showing none: it reads as their consent being asked for.
   */
  const mayAct = mayRequest && !isLive;
  const contactMet = view.requirements.find((r) => r.id === "contact")?.met === true;
  const testMet = view.requirements.find((r) => r.id === "test_delivery")?.met === true;

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Live activation"
          actions={
            <Badge tone={ACTIVATION_STATE_TONE[state] ?? "neutral"}>
              {ACTIVATION_STATE_LABELS[state] ?? state}
            </Badge>
          }
        />
        <Stack gap={2}>
          {/*
            Every state says plainly whether deliveries are live. That is the
            only question this screen exists to answer, and a merchant should
            never have to infer it from a progress bar.
          */}
          <Text size="sm">{ACTIVATION_STATE_DESCRIPTIONS[state] ?? ""}</Text>
          {view.blockedReason ? (
            <Alert tone="warning" title="What Couranr needs">
              {view.blockedReason}
            </Alert>
          ) : null}
          {isPending && view.requestedAt ? (
            <Text size="xs" muted>
              Requested {new Date(view.requestedAt).toLocaleDateString()}. Couranr
              will be in touch.
            </Text>
          ) : null}
        </Stack>
      </Card>

      {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

      <Card>
        <CardHeader
          title="What Couranr needs before going live"
          description="No website, business registration or card is required."
        />
        <Stack gap={4}>
          {ACKNOWLEDGEMENT_KINDS.map((kind) => {
            const req = view.requirements.find((r) => r.id === `ack:${kind}`);
            const met = req?.met === true;
            return (
              <Stack key={kind} gap={1}>
                <Cluster gap={2}>
                  <Badge tone={met ? "success" : "neutral"}>{met ? "Accepted" : "To do"}</Badge>
                  <Text size="sm">
                    <strong>{ACKNOWLEDGEMENT_LABELS[kind]}</strong>
                  </Text>
                </Cluster>
                <Text size="sm" muted>
                  {ACKNOWLEDGEMENT_DESCRIPTIONS[kind]}
                </Text>
                {!met && mayAct ? (
                  <div>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy === kind}
                      disabled={Boolean(busy)}
                      onClick={() => run(kind, { action: "accept", kind })}
                    >
                      Accept
                    </Button>
                  </div>
                ) : null}
                {!met && req?.detail?.includes("updated since") ? (
                  <Text size="xs" muted>
                    {req.detail}
                  </Text>
                ) : null}
              </Stack>
            );
          })}

          <Stack gap={1}>
            <Cluster gap={2}>
              <Badge tone={contactMet ? "success" : "neutral"}>
                {contactMet ? "Verified" : "To do"}
              </Badge>
              <Text size="sm">
                <strong>Operations contact</strong>
              </Text>
            </Cluster>
            <Text size="sm" muted>
              Confirm the phone number Couranr Operations should reach during a
              delivery. It comes from your settings.
            </Text>
            {!contactMet && mayAct ? (
              <Cluster gap={2}>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === "contact"}
                  disabled={Boolean(busy)}
                  onClick={() => run("contact", { action: "verify_contact" })}
                >
                  Confirm contact
                </Button>
                <Link href="/business/settings" className={buttonClassName({ size: "sm" })}>
                  Change it in settings
                </Link>
              </Cluster>
            ) : null}
          </Stack>

          <Stack gap={1}>
            <Cluster gap={2}>
              <Badge tone={testMet ? "success" : "neutral"}>
                {testMet ? "Recorded" : "To do"}
              </Badge>
              <Text size="sm">
                <strong>Test delivery</strong>
              </Text>
            </Cluster>
            <Text size="sm" muted>
              Create one delivery in your test workspace so you have seen the
              whole flow. It is never dispatched and never charged.
            </Text>
            {!testMet && mayAct ? (
              <div>
                <Link
                  href="/business/deliveries/new"
                  className={buttonClassName({ size: "sm", variant: "primary" })}
                >
                  Create a test delivery
                </Link>
              </div>
            ) : null}
          </Stack>
        </Stack>
      </Card>

      {!isLive && !mayRequest ? (
        <Alert tone="info" title="Someone else has to do this part">
          Accepting Couranr&rsquo;s terms and asking to go live commits the
          business, so only an owner or a manager can do it. You can follow the
          progress here.
        </Alert>
      ) : null}

      {!isLive && mayRequest ? (
        <Card>
          <CardHeader
            title="Ask Couranr to activate"
            description="Couranr reviews every workspace before it goes live."
          />
          <Stack gap={2}>
            <div>
              {/*
                The furthest a merchant can go. There is no control on this
                screen that produces `live` — that decision is Couranr
                Operations', and the copy says so rather than implying a
                checklist unlocks it.
              */}
              <Button
                variant="primary"
                loading={busy === "request"}
                disabled={!view.canRequest || Boolean(busy) || isPending}
                onClick={() => run("request", { action: "request_activation" })}
              >
                {isPending ? "Already with Couranr" : "Request activation"}
              </Button>
            </div>
            {!view.canRequest && !isPending ? (
              <Text size="xs" muted>
                Finish the steps above first.
              </Text>
            ) : null}
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

/**
 * The MER-003 screen: resolve which workspace, then render its checklist.
 *
 * Account resolution FAILS CLOSED in the same shape as every other merchant
 * screen — a failed lookup leaves account existence UNKNOWN, which is not the
 * same as having none, so an outage must never render "set up your workspace"
 * at a merchant who already has one.
 */
export function ActivationScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

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
    return () => {
      cancelled = true;
    };
  }, []);

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
      <LoadingState label="Loading activation">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your activation status"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Set up your business first"
        body="Activation is the step after your workspace exists."
        action={{ label: "Set up your workspace", href: "/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const mayRequest = memberMay(
    { role: activeAccount.role, status: "active" },
    "activation.request"
  );

  return (
    <Stack gap={6}>
      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Activating" required>
            {(p) => (
              <Select
                {...p}
                value={activeAccount.businessAccountId}
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

      <ActivationChecklist
        key={activeAccount.businessAccountId}
        businessAccountId={activeAccount.businessAccountId}
        mayRequest={mayRequest}
      />
    </Stack>
  );
}
