"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  buttonClassName,
  Cluster,
  Stack,
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
  const router = useRouter();
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
    // Beginning review is an audited state transition and this control is also
    // the operator's doorway into OPS-003. Staying on the queue after a 200
    // made the action look dead and encouraged repeated clicks.
    router.push(`/operations/deliveries/${r.value.request.id}#ops-current-action`);
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
              {(() => {
                const inFlight = entries.filter((e) => e.stage !== "captured_scheduled").length;
                return total > inFlight
                  ? `Showing the ${inFlight} oldest of ${total} requests in flight, plus recently scheduled work.`
                  : `${inFlight} request${inFlight === 1 ? "" : "s"} in flight.`;
              })()}
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
    <section
      data-stage={stage}
      id={`stage-${stage}`}
      className="cr-ops-queue-stage"
      aria-labelledby={`stage-title-${stage}`}
    >
      <div className="cr-ops-queue-stage__header">
        <div className="cr-ops-queue-stage__copy">
          <h2 id={`stage-title-${stage}`} className="cr-ops-queue-stage__title">
            {label}
          </h2>
          {description ? (
            <p className="cr-ops-queue-stage__description">{description}</p>
          ) : null}
        </div>
        <Badge tone={tone}>
          {rows.length} request{rows.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="cr-ops-queue__mobile" aria-label={`${label} deliveries`}>
        {rows.map((entry) => (
          <MobileQueueCard
            key={entry.request.id}
            entry={entry}
            stage={stage}
            busy={busyId === entry.request.id}
            onBeginReview={onBeginReview}
          />
        ))}
      </div>

      <div className="cr-ops-queue__desktop">
        <div className="cr-ops-worklist" role="list" aria-label={`${label} deliveries`}>
          <div className="cr-ops-worklist__head" aria-hidden="true">
            <span>Delivery</span>
            <span>Payment</span>
            <span>Pickup</span>
            <span>Total</span>
            <span>Next step</span>
          </div>
          {rows.map((entry) => (
            <DesktopQueueRow
              key={entry.request.id}
              entry={entry}
              stage={stage}
              busy={busyId === entry.request.id}
              onBeginReview={onBeginReview}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MobileQueueCard({
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
  const window_ = entry.delivery ?? entry.servicePlan;
  const amount = entry.promotionalCredit
    ? entry.promotionalCredit.standardQuoteCents
    : entry.delivery
      ? entry.delivery.capturedAmountCents
      : entry.payment?.amountCents ?? r.quote.deliverySubtotalCents;

  return (
    <article
      className="cr-ops-queue-card"
      data-request-id={r.id}
      data-stage={stage}
    >
      <div className="cr-ops-queue-card__top">
        <div className="cr-ops-queue-card__identity">
          <Text size="xs" muted>
            {r.requesterKind === "consumer" ? "Consumer delivery" : "Business delivery"}
            {r.submittedAt ? ` · ${new Date(r.submittedAt).toLocaleString()}` : ""}
          </Text>
          <Link
            href={`/operations/deliveries/${r.id}#ops-current-action`}
            className="cr-ops-queue-card__route"
          >
            {routeSummary(r)}
          </Link>
          <Text size="sm" muted>
            {r.loadedMiles === null ? "Distance pending" : `${r.loadedMiles} loaded mi`}
          </Text>
        </div>
        <Text strong numeric className="cr-ops-queue-card__amount">
          {formatCents(amount)}
        </Text>
      </div>

      {r.quote.reviewReasons.length > 0 ? (
        <Text size="xs" muted className="cr-ops-queue-card__reason">
          {r.quote.reviewReasons.map((c) => REVIEW_REASON_LABELS[c] ?? c).join("; ")}
        </Text>
      ) : null}

      <dl className="cr-ops-queue-card__facts">
        <MobileFact
          label="Payment"
          value={
            entry.promotionalCredit
              ? "Couranr pilot credit"
              : entry.payment
                ? PAYMENT_LABELS[entry.payment.paymentState] ?? entry.payment.paymentState
                : "Not started"
          }
        />
        <MobileFact
          label="Payer"
          value={
            entry.promotionalCredit
              ? "Couranr"
              : entry.payment
                ? entry.payment.payerType === "customer"
                  ? "Customer"
                  : "Merchant"
                : "—"
          }
        />
        <MobileFact
          label="Pickup"
          value={window_ ? new Date(window_.scheduledPickupStart).toLocaleString() : "Not scheduled"}
        />
        <MobileFact
          label="Recipient"
          value={r.recipientName || "Not provided"}
        />
      </dl>

      <div className="cr-ops-queue-card__action">
        {stage === "pending_review" ? (
          <Button
            block
            loading={busy}
            disabled={busy}
            onClick={() => onBeginReview(r)}
          >
            Review delivery
          </Button>
        ) : (
          <Link
            href={`/operations/deliveries/${r.id}#ops-current-action`}
            className={buttonClassName({ variant: "secondary", block: true })}
          >
            {stage === "captured_not_scheduled"
              ? "Finish scheduling"
              : stage === "capture_pending"
                ? "Check provider — do not retry"
                : stage === "payment_reauthorization_required"
                  ? "Recover payment"
                  : stage === "awaiting_payment_authorization"
                    ? "Open commercial status"
                    : stage === "merchant_preparing"
                      ? "Open readiness"
                      : stage === "ready_for_planning"
                        ? "Plan delivery"
                        : stage === "service_plan_confirmed"
                          ? entry.promotionalCredit
                            ? "Schedule credited delivery"
                            : "Capture payment"
                          : stage === "captured_scheduled"
                            ? "Assign driver"
                            : stage === "driver_assigned"
                              ? "Monitor delivery"
                              : "Open delivery"}
          </Link>
        )}
      </div>
    </article>
  );
}

function MobileFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="cr-ops-queue-card__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function routeSummary(r: DeliveryRequestView): string {
  const part = (value: unknown) => {
    if (!value || typeof value !== "object") return "";
    const a = value as Record<string, unknown>;
    const city = typeof a.city === "string" ? a.city.trim() : "";
    const region = typeof a.region === "string" ? a.region.trim() : "";
    return [city, region].filter(Boolean).join(", ");
  };
  return `${part(r.pickupAddress) || "Pickup"} → ${part(r.dropoffAddress) || "Dropoff"}`;
}

function DesktopQueueRow({
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
  const window_ = entry.delivery ?? entry.servicePlan;
  const windowIsBooked = Boolean(entry.delivery);
  const amount = entry.promotionalCredit
    ? entry.promotionalCredit.standardQuoteCents
    : entry.delivery
      ? entry.delivery.capturedAmountCents
      : entry.payment?.amountCents ?? r.quote.deliverySubtotalCents;
  const paymentLabel = entry.promotionalCredit
    ? "Couranr pilot credit"
    : entry.payment
      ? PAYMENT_LABELS[entry.payment.paymentState] ?? entry.payment.paymentState
      : "Not started";

  return (
    <article
      className="cr-ops-worklist__row"
      role="listitem"
      data-request-id={r.id}
      data-stage={stage}
    >
      <div className="cr-ops-worklist__delivery">
        <Link
          href={`/operations/deliveries/${r.id}#ops-current-action`}
          className="cr-ops-worklist__route"
        >
          {routeSummary(r)}
        </Link>
        <div className="cr-ops-worklist__meta">
          <span>{r.requesterKind === "consumer" ? "Consumer" : "Business"}</span>
          <span>
            {r.loadedMiles === null ? "Distance pending" : `${r.loadedMiles} loaded mi`}
          </span>
          {r.submittedAt ? <span>{new Date(r.submittedAt).toLocaleString()}</span> : null}
        </div>
        {r.quote.reviewReasons.length > 0 ? (
          <Text size="xs" muted className="cr-ops-worklist__reason">
            {r.quote.reviewReasons.map((c) => REVIEW_REASON_LABELS[c] ?? c).join("; ")}
          </Text>
        ) : null}
      </div>

      <div className="cr-ops-worklist__cell">
        <Text size="sm" strong>{paymentLabel}</Text>
        <Text size="xs" muted>
          {entry.promotionalCredit
            ? `${formatCents(entry.promotionalCredit.amountPaidCents)} paid · ${formatCents(
                entry.promotionalCredit.promotionalCreditCents
              )} credit`
            : entry.payment
              ? entry.payment.payerType === "customer"
                ? "Customer pays"
                : "Merchant pays"
              : "No payment yet"}
        </Text>
      </div>

      <div className="cr-ops-worklist__cell">
        <Text size="sm">
          {window_ ? new Date(window_.scheduledPickupStart).toLocaleString() : "Not scheduled"}
        </Text>
        {window_ ? (
          <Text size="xs" muted>
            {window_.timezone} · {windowIsBooked ? "scheduled" : "planned"}
          </Text>
        ) : null}
      </div>

      <Text strong numeric className="cr-ops-worklist__amount">
        {formatCents(amount)}
      </Text>

      <div className="cr-ops-worklist__action">
        {stage === "pending_review" ? (
          <Button
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() => onBeginReview(r)}
          >
            Review delivery
          </Button>
        ) : (
          <Link
            href={`/operations/deliveries/${r.id}#ops-current-action`}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {stage === "captured_not_scheduled"
              ? "Finish scheduling"
              : stage === "capture_pending"
                ? "Check provider"
                : stage === "payment_reauthorization_required"
                  ? "Recover payment"
                  : stage === "awaiting_payment_authorization"
                    ? "Open commercial status"
                    : stage === "merchant_preparing"
                      ? "Open readiness"
                      : stage === "ready_for_planning"
                        ? "Plan delivery"
                        : stage === "service_plan_confirmed"
                          ? entry.promotionalCredit
                            ? "Schedule credited delivery"
                            : "Capture payment"
                          : stage === "captured_scheduled"
                            ? "Assign driver"
                            : stage === "driver_assigned"
                              ? "Monitor delivery"
                              : "Open delivery"}
          </Link>
        )}
      </div>
    </article>
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
