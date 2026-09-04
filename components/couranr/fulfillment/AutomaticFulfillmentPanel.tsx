"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import type { FulfillmentView } from "./client";

const REASON_COPY: Record<string, string> = {
  manual_planning_required: "This shipment needs a person to plan it.",
  capacity_policy_missing: "The automatic capacity policy is unavailable.",
  authorization_horizon_too_long:
    "The pickup is too far away to rely on the current payment authorization.",
  scheduled_time_unresolved: "The requested pickup time could not be resolved safely.",
  scheduled_time_too_close: "The requested pickup time is too close for automatic dispatch.",
  requested_window_outside_operating_hours:
    "The requested pickup falls outside Couranr operating hours.",
  capacity_unavailable: "Couranr does not have automatic capacity for this requested window.",
  no_driver_before_deadline: "No compatible driver was available before the dispatch deadline.",
  readiness_changed: "Pickup readiness changed after Couranr scheduled the delivery.",
  route_revalidation_failed: "Couranr could not re-verify the route before dispatch.",
  route_outside_auto_lane_at_dispatch:
    "The re-verified route no longer fits the automatic lane.",
  route_evidence_missing: "The stored route identities are incomplete.",
  request_no_longer_confirmed: "The request is no longer confirmed.",
  commercial_settlement_failed: "Commercial settlement could not be completed automatically.",
  payment_capture_requires_reconciliation:
    "The payment provider outcome needs reconciliation before dispatch can continue.",
  canonical_delivery_missing: "Commercial settlement succeeded but the canonical delivery is missing.",
  assignment_commit_failed: "Couranr could not commit the selected driver and vehicle.",
};

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export function AutomaticFulfillmentPanel({
  fulfillment,
}: {
  fulfillment: FulfillmentView | null;
}) {
  const plan = fulfillment?.servicePlan ?? null;
  const delivery = fulfillment?.delivery ?? null;
  const exception = fulfillment?.automationException ?? null;

  if (!plan && !exception) return null;

  const automatic = plan?.planSource === "automatic";

  return (
    <Card>
      <CardHeader
        title={exception ? "Automation needs Operations" : "Scheduled automatically"}
        description={
          exception
            ? "Couranr stopped the machine-owned path safely and recorded why."
            : "Couranr owns the normal-lane schedule and dispatch timing. No planning action is required."
        }
        actions={
          <Badge tone={exception ? "warning" : automatic ? "success" : "neutral"}>
            {exception ? "Exception" : automatic ? "Automatic" : "Manual"}
          </Badge>
        }
      />

      <Stack gap={4}>
        {exception ? (
          <Alert tone="warning" title={REASON_COPY[exception.reason] ?? exception.reason.replace(/_/g, " ")}>
            Stage: {exception.stage}. Attempts: {exception.attempts}. Last seen{" "}
            {when(exception.lastSeenAt)}.
          </Alert>
        ) : null}

        {plan ? (
          <Grid columns={4}>
            <Fact label="Pickup start" value={when(plan.scheduledPickupStart)} />
            <Fact label="Pickup end" value={when(plan.scheduledPickupEnd)} />
            <Fact label="Dispatch not before" value={when(plan.dispatchNotBefore)} />
            <Fact label="Expected service end" value={when(plan.expectedServiceEnd)} />
          </Grid>
        ) : null}

        {plan?.plannerVersion ? (
          <Text size="xs" muted>
            Planner {plan.plannerVersion}
            {plan.marketKey ? " · " + plan.marketKey : ""}
            {plan.lastRevalidatedAt ? " · route revalidated " + when(plan.lastRevalidatedAt) : ""}
          </Text>
        ) : null}

        {delivery?.driverAssigned && delivery.assignment ? (
          <Alert tone="success" title="Driver assignment committed">
            Assignment source: {delivery.assignment.assignmentSource}. Assigned{" "}
            {when(delivery.assignment.assignedAt)}.
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>{label}</Text>
      <Text strong>{value}</Text>
    </div>
  );
}
