"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import {
  CardSkeleton,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import {
  fetchReviewQueue,
  isApiFailure,
  withReference,
  type ApiFailure,
  type QueueEntry,
} from "@/components/couranr/requests/client";
import {
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_TONE,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";

const METRICS: Array<{
  label: string;
  stages: LifecycleStage[];
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}> = [
  { label: "Needs review", stages: ["pending_review"], tone: "info" },
  { label: "Ready to plan", stages: ["ready_for_planning"], tone: "info" },
  { label: "Plan confirmed", stages: ["service_plan_confirmed"], tone: "info" },
  { label: "Needs driver", stages: ["captured_scheduled"], tone: "warning" },
  { label: "Active deliveries", stages: ["driver_assigned"], tone: "success" },
  {
    label: "Payment attention",
    stages: ["capture_pending", "payment_reauthorization_required", "captured_not_scheduled"],
    tone: "danger",
  },
];

const OPERATOR_ACTION_STAGES = new Set<LifecycleStage>([
  "pending_review",
  "ready_for_planning",
  "service_plan_confirmed",
  "capture_pending",
  "payment_reauthorization_required",
  "captured_not_scheduled",
  "captured_scheduled",
]);

export function OperationsPilotDashboard() {
  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);

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
    setTotal(Number(r.value.total ?? 0));
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (entries === null) {
    return (
      <LoadingState label="Loading live Operations">
        <div className="cr-ops-metrics">
          {METRICS.map((m) => (
            <CardSkeleton key={m.label} lines={2} />
          ))}
        </div>
      </LoadingState>
    );
  }

  if (failure?.status === 401 || failure?.status === 403) {
    return <PermissionDeniedState />;
  }

  const actionEntries = entries.filter((entry) =>
    OPERATOR_ACTION_STAGES.has(entry.stage as LifecycleStage)
  );
  const waiting = entries.filter((entry) =>
    ["awaiting_payment_authorization", "merchant_preparing"].includes(entry.stage)
  ).length;

  return (
    <Stack gap={6}>
      {failure ? (
        <ErrorState
          title="Live Operations could not be loaded"
          body={withReference(failure)}
          action={{ label: "Retry", onClick: load }}
        />
      ) : null}

      <div className="cr-ops-metrics" aria-label="Live Operations summary">
        {METRICS.map((metric) => {
          const count = entries.filter((entry) =>
            metric.stages.includes(entry.stage as LifecycleStage)
          ).length;
          const href = metric.stages.length === 1
            ? `/operations/queue#stage-${metric.stages[0]}`
            : "/operations/queue";
          return (
            <Link key={metric.label} href={href} className="cr-ops-metric">
              <span className="cr-ops-metric__top">
                <span>{metric.label}</span>
                <Badge tone={metric.tone}>{count}</Badge>
              </span>
              <span className="cr-ops-metric__value">{count}</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="What needs your attention"
          description={
            total === 0
              ? "No submitted delivery is waiting on Couranr right now."
              : `${total} request${total === 1 ? "" : "s"} still need Operations work. ${waiting} are waiting on the payer or merchant.`
          }
          actions={
            <Link
              href="/operations/queue"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              Open full queue
            </Link>
          }
        />

        {actionEntries.length === 0 ? (
          <div className="cr-ops-ready-state">
            <Text strong>Pilot console is clear.</Text>
            <Text muted size="sm">
              Create a business delivery here in Operations, or wait for a merchant/customer request. New work appears here as soon as Couranr has something to do.
            </Text>
          </div>
        ) : (
          <div className="cr-ops-attention-list">
            {actionEntries.slice(0, 6).map((entry) => (
              <AttentionRow key={entry.request.id} entry={entry} />
            ))}
          </div>
        )}
      </Card>

      {entries.some((entry) => entry.stage === "driver_assigned") ? (
        <Card>
          <CardHeader
            title="Active deliveries"
            description="Driver-assigned deliveries currently visible to Operations."
          />
          <div className="cr-ops-attention-list">
            {entries
              .filter((entry) => entry.stage === "driver_assigned")
              .slice(0, 6)
              .map((entry) => (
                <AttentionRow key={entry.request.id} entry={entry} />
              ))}
          </div>
        </Card>
      ) : null}
    </Stack>
  );
}

function AttentionRow({ entry }: { entry: QueueEntry }) {
  const stage = entry.stage as LifecycleStage;
  const request = entry.request;
  const amount = entry.promotionalCredit
    ? entry.promotionalCredit.standardQuoteCents
    : entry.delivery
      ? entry.delivery.capturedAmountCents
      : entry.payment?.amountCents ?? request.quote.deliverySubtotalCents;

  return (
    <Link
      href={`/operations/deliveries/${request.id}#ops-current-action`}
      className="cr-ops-attention"
    >
      <div className="cr-ops-attention__main">
        <Cluster gap={2} align="start">
          <Badge tone={LIFECYCLE_STAGE_TONE[stage] ?? "neutral"}>
            {LIFECYCLE_STAGE_LABELS[stage] ?? stage}
          </Badge>
          <Text size="xs" muted>
            {request.requesterKind === "consumer" ? "Consumer" : "Business"}
          </Text>
        </Cluster>
        <Text strong className="cr-ops-attention__route">
          {routeLabel(request)}
        </Text>
        <Text size="sm" muted>
          {request.loadedMiles == null ? "Distance pending" : `${request.loadedMiles} loaded mi`}
          {" · "}
          {entry.promotionalCredit
            ? "Couranr pilot credit"
            : entry.payment
              ? paymentLabel(entry.payment.paymentState)
              : "Payment not started"}
        </Text>
      </div>
      <div className="cr-ops-attention__aside">
        <Text strong numeric>{formatCents(amount)}</Text>
        <Text size="xs" muted>{pickupLabel(entry)}</Text>
      </div>
    </Link>
  );
}

function addressShort(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const a = value as Record<string, unknown>;
  const city = typeof a.city === "string" ? a.city.trim() : "";
  const region = typeof a.region === "string" ? a.region.trim() : "";
  return [city, region].filter(Boolean).join(", ");
}

function routeLabel(request: DeliveryRequestView): string {
  const pickup = addressShort(request.pickupAddress) || "Pickup";
  const dropoff = addressShort(request.dropoffAddress) || "Dropoff";
  return `${pickup} → ${dropoff}`;
}

function pickupLabel(entry: QueueEntry): string {
  const window_ = entry.delivery ?? entry.servicePlan;
  if (!window_) return "No pickup window yet";
  return new Date(window_.scheduledPickupStart).toLocaleString();
}

function paymentLabel(state: string): string {
  return state.replace(/_/g, " ");
}
