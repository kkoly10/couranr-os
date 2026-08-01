"use client";

import * as React from "react";
import Link from "next/link";
import {
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
import {
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  TableSkeleton,
} from "@/components/couranr/states";
import {
  beginReview,
  fetchReviewQueue,
  isApiFailure,
  withReference,
  type ApiFailure,
  type QueueEntry,
} from "./client";
import { REVIEW_REASON_LABELS, formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import {
  LIFECYCLE_STAGE_DESCRIPTIONS,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_TONE,
  QUEUE_STAGES,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";

/**
 * OPS-002 — the Couranr Operations Queue.
 *
 * One section per lifecycle stage, in the order Operations should work them:
 * review first, then everything the hold has unblocked, then the rows that are
 * waiting on somebody else.
 *
 * The stage is computed on the SERVER from the request, obligation, plan and
 * delivery rows. This screen never re-derives it — a queue that decided for
 * itself what "ready" meant is exactly how an operator ends up looking at a
 * Capture button on a row whose capture is already in flight.
 */
export function OperationsQueue() {
  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await fetchReviewQueue();
    if (isApiFailure(r)) {
      setFailure(r);
      setEntries([]);
      setTotal(0);
      return;
    }
    setFailure(null);
    setEntries(r.value.entries ?? []);
    setTotal(Number(r.value.total ?? (r.value.entries ?? []).length));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onBeginReview(request: DeliveryRequestView) {
    setBusyId(request.id);
    const r = await beginReview({ id: request.id, expectedVersion: request.version });
    setBusyId(null);
    if (isApiFailure(r)) {
      setFailure(r);
      return;
    }
    setFailure(null);
    setEntries((prev) =>
      (prev ?? []).map((e) =>
        e.request.id === r.value.request.id ? { ...e, request: r.value.request } : e
      )
    );
  }

  if (entries === null) {
    return (
      <LoadingState label="Loading the Couranr Operations Queue">
        <TableSkeleton rows={5} columns={5} />
      </LoadingState>
    );
  }

  if (failure?.status === 401 || failure?.status === 403) {
    return <PermissionDeniedState />;
  }

  const byStage = new Map<LifecycleStage, QueueEntry[]>();
  for (const stage of QUEUE_STAGES) byStage.set(stage, []);
  for (const entry of entries) {
    const bucket = byStage.get(entry.stage as LifecycleStage);
    // A stage this build does not know about is still shown, at the end,
    // rather than dropped — a row that vanishes from the queue is worse than
    // a row with an unfamiliar label.
    if (bucket) bucket.push(entry);
    else byStage.set(entry.stage as LifecycleStage, [entry]);
  }

  return (
    <Stack gap={4}>
      {failure?.code === "version_conflict" ? (
        <ConflictState action={{ label: "Reload the queue", onClick: load }} />
      ) : null}
      {failure && failure.code !== "version_conflict" ? (
        <ErrorState title="The queue could not be updated" body={withReference(failure)} />
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing in the queue"
          body="Submitted delivery requests appear here, oldest first, and stay until they are scheduled."
          action={{ label: "Refresh", onClick: load }}
        />
      ) : (
        <Stack gap={4}>
          <Cluster gap={3} justify="between" align="start">
            <Text size="sm" muted>
              {/*
                The cap is stated, never silent. An operator who is shown 200 of
                340 rows and told nothing believes they have seen the queue.
              */}
              {total > entries.length
                ? `Showing the ${entries.length} oldest of ${total} requests in flight.`
                : `${entries.length} request${entries.length === 1 ? "" : "s"} in flight.`}
            </Text>
            <Button size="sm" onClick={load}>
              Refresh
            </Button>
          </Cluster>

          {Array.from(byStage.entries()).map(([stage, rows]) =>
            rows.length === 0 ? null : (
              <StageSection
                key={stage}
                stage={stage}
                rows={rows}
                busyId={busyId}
                onBeginReview={onBeginReview}
              />
            )
          )}
        </Stack>
      )}
    </Stack>
  );
}

function StageSection({
  stage,
  rows,
  busyId,
  onBeginReview,
}: {
  stage: LifecycleStage;
  rows: QueueEntry[];
  busyId: string | null;
  onBeginReview: (r: DeliveryRequestView) => void;
}) {
  const label = LIFECYCLE_STAGE_LABELS[stage] ?? stage;
  const description = LIFECYCLE_STAGE_DESCRIPTIONS[stage] ?? "";
  const tone = LIFECYCLE_STAGE_TONE[stage] ?? "neutral";

  return (
    <Card padding="flush" data-stage={stage}>
      {/*
        The badge carries the COUNT, not the stage name — the title already
        says the stage, and repeating it twice in one header just adds noise
        while the colour is what makes `capture pending` stand out from
        `captured`.
      */}
      <CardHeader
        title={label}
        description={description}
        actions={
          <Badge tone={tone}>
            {rows.length} request{rows.length === 1 ? "" : "s"}
          </Badge>
        }
      />
      <TableScroll>
        <Table caption={`Submission, route, payment and scheduled pickup for each ${label.toLowerCase()} request`}>
          <thead>
            <tr>
              <th scope="col">Submitted</th>
              <th scope="col">Route</th>
              <th scope="col">Payment</th>
              <th scope="col">Scheduled</th>
              <th scope="col">Amount</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <QueueRow
                key={e.request.id}
                entry={e}
                stage={stage}
                busy={busyId === e.request.id}
                onBeginReview={onBeginReview}
              />
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}

function QueueRow({
  entry,
  stage,
  busy,
  onBeginReview,
}: {
  entry: QueueEntry;
  stage: LifecycleStage;
  busy: boolean;
  onBeginReview: (r: DeliveryRequestView) => void;
}) {
  const r = entry.request;
  const scheduled = entry.delivery ?? entry.servicePlan;

  return (
    <tr data-request-id={r.id} data-stage={stage}>
      <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}</td>
      <td>
        {/*
          OPS-003, not the merchant surface. Linking Operations at /business/…
          sent them to a route the surface guard redirects them off, which made
          the review workspace unreachable from the queue.
        */}
        <Link href={`/operations/deliveries/${r.id}`}>
          {r.loadedMiles === null ? "Open" : `${r.loadedMiles} mi`}
        </Link>
        {r.quote.reviewReasons.length > 0 ? (
          <Text size="xs" muted>
            {r.quote.reviewReasons.map((c) => REVIEW_REASON_LABELS[c] ?? c).join("; ")}
          </Text>
        ) : null}
      </td>
      <td data-payment-state={entry.payment?.paymentState ?? "none"}>
        {entry.payment ? (
          <>
            <Text size="sm">{PAYMENT_LABELS[entry.payment.paymentState] ?? entry.payment.paymentState}</Text>
            <Text size="xs" muted>
              {entry.payment.payerType === "customer" ? "Customer pays" : "Merchant pays"}
            </Text>
          </>
        ) : (
          <Text size="sm" muted>
            Not started
          </Text>
        )}
      </td>
      <td>
        {scheduled ? (
          <>
            <Text size="sm">{new Date(scheduled.scheduledPickupStart).toLocaleString()}</Text>
            <Text size="xs" muted>
              {scheduled.timezone}
            </Text>
          </>
        ) : (
          <Text size="sm" muted>
            —
          </Text>
        )}
      </td>
      <td>
        {entry.delivery
          ? formatCents(entry.delivery.capturedAmountCents)
          : formatCents(entry.payment?.amountCents ?? r.quote.deliverySubtotalCents)}
      </td>
      <td>
        {/*
          Exactly one action per stage, and none at all where the correct move
          is to wait. `capture_pending` offers nothing on purpose: a retry
          there is a second capture of money that may already be taken.
        */}
        {stage === "pending_review" ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => onBeginReview(r)}>
            Open for review
          </Button>
        ) : stage === "capture_pending" ? (
          <Text size="xs" muted>
            Resolving — do not retry
          </Text>
        ) : (
          <Link href={`/operations/deliveries/${r.id}`}>
            {stage === "ready_for_planning"
              ? "Plan"
              : stage === "service_plan_confirmed"
                ? "Capture"
                : "View"}
          </Link>
        )}
      </td>
    </tr>
  );
}

const PAYMENT_LABELS: Record<string, string> = {
  not_started: "Not started",
  requires_action: "Action required",
  authorized: "Authorized",
  capture_pending: "Capture pending",
  captured: "Captured",
  failed: "Failed",
  cancelled: "Cancelled",
};
