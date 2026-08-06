"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Cluster,
  Grid,
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
import {
  listConversations,
  type ConversationSummary,
} from "@/components/couranr/conversations/client";
import { fetchFulfillment, type FulfillmentView } from "@/components/couranr/fulfillment/client";
import { MerchantReadinessPanel } from "@/components/couranr/fulfillment/MerchantReadinessPanel";
import { REQUEST_STATES } from "@/lib/couranr/requests/states";
import { DELIVERY_REQUEST_WRITE_ROLES } from "@/lib/couranr/requests/permissions";
import { REQUEST_STATE_LABELS, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import {
  LIFECYCLE_STAGE_DESCRIPTIONS,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_TONE,
  PAYABLE_REQUEST_STATES,
} from "@/lib/couranr/fulfillment/lifecycle";
import {
  dashboardAttention,
  fulfillmentToLifecycleInput,
  type DashboardAttention,
} from "@/lib/couranr/dashboard/attention";

/**
 * MER-001 — the merchant dashboard. A COMPOSITION of endpoints that already
 * exist; it adds no new server behavior and no new permission decisions.
 *
 * Every tile is real posted data or an honest gap (`UI_SCREEN_REGISTRY.md:274`
 * bans fabricated revenue, customer, or on-time metrics — none is rendered,
 * because no posted source for any of them exists):
 *
 *  - Deliveries by state: the caller's own rows from the list endpoint,
 *    grouped client-side. There is no aggregate endpoint; the rows ARE the
 *    counts.
 *  - Attention / preparation: the per-request fulfillment view, mapped through
 *    `dashboardAttention`, which derives from the SAME `lifecycleStage` the
 *    Operations queue uses — never a second reading of the row.
 *  - Messages: `hasUnread` is a boolean by design; this renders badges, never
 *    an invented number.
 *  - Activation: a truthful static banner. No activation state exists anywhere
 *    in the system (MER-003 is unbuilt), so every workspace IS a test
 *    workspace and the banner says exactly that.
 */

/**
 * The fulfillment view is one route call per request (three queries each), so
 * the fan-out is bounded. The cap is announced on the page when it bites —
 * a silently truncated health check would read as "everything is fine".
 */
const FULFILLMENT_FANOUT_LIMIT = 25;

const TERMINAL_REQUEST_STATES: readonly string[] = ["declined", "cancelled", "closed"];

/** Same labels MER-012's list uses, keyed by the real kind vocabulary. */
const CONVERSATION_KIND_LABELS: Record<string, string> = {
  merchant_support: "Couranr Support",
  delivery_chat: "Delivery chat",
  delivery_help: "Delivery Help",
};

type FanoutEntry = {
  request: DeliveryRequestView;
  fulfillment: FulfillmentView;
  attention: DashboardAttention;
};

/**
 * `Alert` has no "neutral" rendering, and an item that made it into the
 * attention tile is by definition at least a warning (`requires_action` files
 * under the lifecycle's neutral awaiting-authorization stage).
 */
function attentionAlertTone(
  stage: DashboardAttention["stage"]
): "info" | "success" | "warning" | "danger" {
  const t = LIFECYCLE_STAGE_TONE[stage];
  return t === "neutral" ? "warning" : t;
}

export function MerchantDashboard() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [requests, setRequests] = React.useState<DeliveryRequestView[] | null>(null);
  const [requestsError, setRequestsError] = React.useState<ApiFailure | null>(null);
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null);
  const [conversationsError, setConversationsError] = React.useState<ApiFailure | null>(null);

  const [fanout, setFanout] = React.useState<FanoutEntry[] | null>(null);
  const [fanoutTruncatedTo, setFanoutTruncatedTo] = React.useState<number | null>(null);

  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        // Fail closed, the onboarding rule: a failed lookup leaves account
        // existence UNKNOWN, which is not the same as having none — so no
        // "new workspace" screen is shown for what is actually an outage.
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

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setRequests(null);
    setRequestsError(null);
    setConversations(null);
    setConversationsError(null);
    setFanout(null);
    setFanoutTruncatedTo(null);

    call<{ requests: DeliveryRequestView[] }>(
      `/api/couranr/delivery-requests?businessAccountId=${encodeURIComponent(businessAccountId)}`
    ).then(async (r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setRequestsError(r);
        return;
      }
      setRequests(r.value.requests);

      // Payment and preparation are per-request lifecycle facts, and only a
      // request Couranr has priced can carry an obligation — so the fan-out
      // covers exactly the payable states, most recently updated first.
      const payable = r.value.requests
        .filter((q) =>
          (PAYABLE_REQUEST_STATES as readonly string[]).includes(q.requestState)
        )
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const checked = payable.slice(0, FULFILLMENT_FANOUT_LIMIT);
      if (payable.length > checked.length) setFanoutTruncatedTo(checked.length);

      const views = await Promise.all(
        checked.map((q) => fetchFulfillment({ id: q.id, businessAccountId }))
      );
      if (cancelled) return;
      const entries: FanoutEntry[] = [];
      for (let i = 0; i < checked.length; i++) {
        const v = views[i];
        // A row whose health could not be read is dropped from the buckets,
        // never guessed at; the tile states how many were checked.
        if (isApiFailure(v)) continue;
        entries.push({
          request: checked[i],
          fulfillment: v.value,
          attention: dashboardAttention(fulfillmentToLifecycleInput(v.value)),
        });
      }
      setFanout(entries);
    });

    listConversations().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setConversationsError(r);
        return;
      }
      setConversations(r.value.conversations);
    });

    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

  /* ---------------------------------------------------- account resolution */

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
      <LoadingState label="Loading your dashboard">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your dashboard"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }

  // Required state: NEW WORKSPACE — no membership yet, so the only real next
  // step is onboarding (MER-002, a real flow).
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Welcome to Couranr"
        body="Set up your business workspace to start creating deliveries."
        action={{ label: "Set up your workspace", href: "/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  // UX mirror of DRP-001 only — the server re-checks every write regardless.
  const mayWrite = (DELIVERY_REQUEST_WRITE_ROLES as readonly string[]).includes(
    activeAccount.role
  );

  const openRequests = (requests ?? []).filter(
    (q) => !TERMINAL_REQUEST_STATES.includes(q.requestState)
  );
  const closedCount = (requests ?? []).length - openRequests.length;
  const stateCounts = REQUEST_STATES.map((s) => ({
    state: s,
    count: openRequests.filter((q) => q.requestState === s).length,
  })).filter((g) => g.count > 0 && !TERMINAL_REQUEST_STATES.includes(g.state));

  const degraded = (fanout ?? []).filter((e) => e.attention.degradedPayment);
  const preparing = (fanout ?? []).filter((e) => e.attention.awaitingPreparation);

  const recentConversations = (conversations ?? [])
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 5);

  return (
    <Stack gap={6}>
      {/*
        Required state: ACTIVATION INCOMPLETE. Honest by construction: nothing
        in the system can activate a workspace yet (no activation state exists;
        MER-003 is not built), so every workspace is a test workspace and this
        banner is simply true. It must not become a checklist with invented
        progress.
      */}
      <Alert tone="info" title="Test workspace">
        Live activation is not yet available. Everything you create here is part
        of your Couranr test workspace.
      </Alert>

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

      <Cluster gap={3}>
        {mayWrite ? (
          <Link
            href="/business/deliveries/new"
            className={buttonClassName({ variant: "primary" })}
          >
            Create delivery
          </Link>
        ) : null}
        <Link href="/business/deliveries" className={buttonClassName({})}>
          View deliveries
        </Link>
        <Link href="/business/messages" className={buttonClassName({})}>
          View messages
        </Link>
      </Cluster>

      {requestsError ? (
        <ErrorState
          title="Your deliveries did not load"
          body={withReference(requestsError)}
          action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
        />
      ) : null}

      {/* ---------------------------------------- attention: degraded payments */}
      {degraded.length > 0 ? (
        <Card>
          <CardHeader
            title="Payments need attention"
            description="These deliveries cannot move until their payment is put right."
          />
          <Stack gap={3}>
            {degraded.map((e) => (
              <Alert
                key={e.request.id}
                tone={attentionAlertTone(e.attention.stage)}
                title={LIFECYCLE_STAGE_LABELS[e.attention.stage]}
              >
                <Stack gap={2}>
                  <Text size="sm">
                    {e.request.recipientName
                      ? `Delivery for ${e.request.recipientName}. `
                      : ""}
                    {LIFECYCLE_STAGE_DESCRIPTIONS[e.attention.stage]}
                  </Text>
                  <div>
                    <Link
                      href={`/business/deliveries/${e.request.id}`}
                      className={buttonClassName({ size: "sm" })}
                    >
                      Open delivery
                    </Link>
                  </div>
                </Stack>
              </Alert>
            ))}
          </Stack>
        </Card>
      ) : null}

      {/* -------------------------------------------- preparation: mark ready */}
      {preparing.length > 0 ? (
        <Stack gap={3}>
          <CardHeader
            title="Waiting on your preparation"
            description="Payment is held. Tell Couranr when each shipment is ready to collect."
          />
          {preparing.map((e) =>
            mayWrite ? (
              // The real writer, reused — no second readiness mutation path.
              <MerchantReadinessPanel
                key={e.request.id}
                request={e.request}
                fulfillment={e.fulfillment}
                businessAccountId={businessAccountId}
                onChanged={() => setReloadKey((k) => k + 1)}
              />
            ) : (
              <Card key={e.request.id}>
                <CardHeader
                  title={
                    e.request.recipientName
                      ? `Delivery for ${e.request.recipientName}`
                      : "Delivery"
                  }
                  actions={<Badge tone="info">Preparing</Badge>}
                />
                <Text size="sm" muted>
                  A teammate with a dispatcher, manager, or owner role can mark
                  this ready.
                </Text>
              </Card>
            )
          )}
        </Stack>
      ) : null}

      <Grid columns={2}>
        {/* -------------------------------------------- deliveries by state */}
        <Card>
          <CardHeader
            title="Deliveries"
            description={
              activeAccount ? `Open deliveries for ${activeAccount.name}.` : undefined
            }
          />
          {requests === null && !requestsError ? (
            <CardSkeleton lines={3} />
          ) : openRequests.length === 0 && !requestsError ? (
            // Required state: EMPTY — a workspace with no deliveries yet.
            <EmptyState
              title="No deliveries yet"
              body={
                mayWrite
                  ? "Create your first delivery and Couranr will price it before anything is charged."
                  : "Deliveries created for this business will appear here."
              }
              action={
                mayWrite
                  ? { label: "Create delivery", href: "/business/deliveries/new" }
                  : undefined
              }
            />
          ) : (
            <Stack gap={2}>
              {stateCounts.map((g) => (
                <Cluster key={g.state} gap={2}>
                  <Badge tone={g.state === "confirmed" ? "success" : "neutral"}>
                    {g.count}
                  </Badge>
                  <Text size="sm">{REQUEST_STATE_LABELS[g.state] ?? g.state}</Text>
                </Cluster>
              ))}
              {closedCount > 0 ? (
                <Text size="xs" muted>
                  {closedCount} declined, cancelled or closed.
                </Text>
              ) : null}
              {fanoutTruncatedTo !== null ? (
                <Text size="xs" muted>
                  Payment and preparation checks cover the {fanoutTruncatedTo} most
                  recently updated open deliveries.
                </Text>
              ) : null}
              {fanout !== null && degraded.length === 0 ? (
                <Text size="xs" muted>
                  No payment issues in the deliveries checked.
                </Text>
              ) : null}
            </Stack>
          )}
        </Card>

        {/* ------------------------------------------------------- messages */}
        <Card>
          <CardHeader
            title="Messages"
            actions={
              <Link href="/business/messages" className={buttonClassName({ size: "sm" })}>
                Open messages
              </Link>
            }
          />
          {conversationsError ? (
            <Text size="sm" muted>
              {conversationsError.status === 403
                ? "Messaging is not available for your role."
                : withReference(conversationsError)}
            </Text>
          ) : conversations === null ? (
            <CardSkeleton lines={3} />
          ) : recentConversations.length === 0 ? (
            <Text size="sm" muted>
              Delivery chats and Couranr Support conversations appear here.
            </Text>
          ) : (
            <Stack gap={2}>
              {recentConversations.map((c) => (
                <Cluster key={c.id} gap={2}>
                  {/* hasUnread is a boolean by design — a badge, never a count. */}
                  {c.hasUnread ? <Badge tone="info">Unread</Badge> : null}
                  <Text size="sm">
                    {CONVERSATION_KIND_LABELS[c.kind] ?? "Conversation"}
                    {c.deliveryId ? " · about a delivery" : ""}
                  </Text>
                </Cluster>
              ))}
            </Stack>
          )}
        </Card>
      </Grid>
    </Stack>
  );
}
