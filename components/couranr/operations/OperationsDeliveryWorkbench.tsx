"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  buttonClassName,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { ReviewOutcomeActions } from "@/components/couranr/requests/ReviewOutcomeActions";
import { OperationsPlanPanel } from "@/components/couranr/fulfillment/OperationsPlanPanel";
import { OperationsPaymentRecoveryPanel } from "@/components/couranr/fulfillment/OperationsPaymentRecoveryPanel";
import { OperationsAssignmentPanel } from "@/components/couranr/dispatch/OperationsAssignmentPanel";
import { OperationsExecutionPanel } from "@/components/couranr/dispatch/OperationsExecutionPanel";
import type { FulfillmentView } from "@/components/couranr/fulfillment/client";
import {
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_TONE,
} from "@/lib/couranr/fulfillment/lifecycle";
import {
  OPERATIONS_WORKBENCH_LABELS,
  OPERATIONS_WORKBENCH_PHASES,
  operationsWorkbenchState,
  type OperationsWorkbenchState,
} from "@/lib/couranr/operations/workbench";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";

export function OperationsDeliveryWorkbench({
  request,
  fulfillment,
  fulfillmentUnavailable,
  onRequestUpdated,
  onLifecycleChanged,
}: {
  request: DeliveryRequestView;
  fulfillment: FulfillmentView | null;
  fulfillmentUnavailable: boolean;
  onRequestUpdated: (next: DeliveryRequestView) => void;
  onLifecycleChanged: () => void;
}) {
  const work = operationsWorkbenchState({
    requestState: request.requestState,
    readinessState: fulfillment?.readinessState ?? request.readinessState,
    paymentState: fulfillment?.payment?.paymentState ?? null,
    promotionalCreditApplied: Boolean(fulfillment?.promotionalCredit),
    servicePlanConfirmed: Boolean(fulfillment?.servicePlan),
    canonicalDeliveryExists: Boolean(fulfillment?.delivery),
    assignmentActive: Boolean(fulfillment?.delivery?.driverAssigned),
    fulfillmentState: fulfillment?.delivery?.fulfillmentState ?? null,
  });

  const copy = workbenchCopy(work, Boolean(fulfillment?.promotionalCredit));
  const currentIndex = OPERATIONS_WORKBENCH_PHASES.indexOf(work.phase);
  const amount = fulfillment?.promotionalCredit
    ? fulfillment.promotionalCredit.standardQuoteCents
    : fulfillment?.payment?.amountCents ?? request.quote.deliverySubtotalCents;

  return (
    <Stack gap={4} id="operations-workbench">
      <Card className="cr-ops-case">
        <CardHeader
          title={copy.title}
          description={copy.description}
          actions={
            <Badge tone={LIFECYCLE_STAGE_TONE[work.lifecycleStage] ?? "neutral"}>
              {LIFECYCLE_STAGE_LABELS[work.lifecycleStage] ?? work.lifecycleStage}
            </Badge>
          }
        />

        <ol className="cr-ops-case__progress" aria-label="Delivery lifecycle">
          {OPERATIONS_WORKBENCH_PHASES.map((phase, index) => (
            <li
              key={phase}
              className="cr-ops-case__phase"
              data-state={index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming"}
              aria-current={index === currentIndex ? "step" : undefined}
            >
              <span className="cr-ops-case__phase-dot" aria-hidden="true" />
              <span>{OPERATIONS_WORKBENCH_LABELS[phase]}</span>
            </li>
          ))}
        </ol>

        <Grid columns={4}>
          <CaseFact label="Quote" value={formatCents(amount)} />
          <CaseFact
            label="Commercial"
            value={
              fulfillment?.promotionalCredit
                ? "Couranr pilot credit"
                : fulfillment?.payment
                  ? fulfillment.payment.paymentState.replace(/_/g, " ")
                  : "Not secured"
            }
          />
          <CaseFact
            label="Readiness"
            value={(fulfillment?.readinessState ?? request.readinessState).replace(/_/g, " ")}
          />
          <CaseFact
            label="Driver"
            value={fulfillment?.delivery?.driverAssigned ? "Assigned" : "Not assigned"}
          />
        </Grid>

        <Cluster gap={3}>
          <Link href="/operations/queue" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Back to queue
          </Link>
        </Cluster>
      </Card>

      <div id="ops-current-action" className="cr-ops-case__current">
        {fulfillmentUnavailable && work.phase !== "review" ? (
          <ErrorState
            title="Couranr could not load this delivery's lifecycle"
            body="Operations actions are withheld until payment, planning and delivery state can be read again. Refresh this page before continuing."
          />
        ) : (
          <CurrentAction
            work={work}
            request={request}
            fulfillment={fulfillment}
            onRequestUpdated={onRequestUpdated}
            onLifecycleChanged={onLifecycleChanged}
          />
        )}
      </div>
    </Stack>
  );
}

function CurrentAction({
  work,
  request,
  fulfillment,
  onRequestUpdated,
  onLifecycleChanged,
}: {
  work: OperationsWorkbenchState;
  request: DeliveryRequestView;
  fulfillment: FulfillmentView | null;
  onRequestUpdated: (next: DeliveryRequestView) => void;
  onLifecycleChanged: () => void;
}) {
  if (work.phase === "review") {
    return <ReviewOutcomeActions request={request} onUpdated={onRequestUpdated} />;
  }

  if (work.phase === "commercial") {
    const businessPayer =
      request.requesterKind === "business" &&
      request.payerType === "merchant" &&
      request.source === "operations" &&
      !fulfillment?.promotionalCredit;

    return (
      <Stack gap={4}>
        {businessPayer ? (
          <Card>
            <CardHeader
              title="Business approval required"
              description="Couranr can approve service. The Business must approve its own price."
            />
            <Stack gap={3}>
              <Text size="sm">
                Open the Business view to authorize{" "}
                <strong>{formatCents(request.quote.deliverySubtotalCents)}</strong>. Operations
                never inherits payer authority.
              </Text>
              <div>
                <Link
                  href={`/app/business/deliveries/${request.id}`}
                  className={buttonClassName({ variant: "primary" })}
                >
                  Open Business approval
                </Link>
              </div>
            </Stack>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Waiting on commercial approval"
              description="Planning stays locked until the payer or provider state is resolved."
            />
          </Card>
        )}

        <OperationsPaymentRecoveryPanel
          request={request}
          fulfillment={fulfillment}
          onChanged={onLifecycleChanged}
        />
      </Stack>
    );
  }

  if (work.phase === "plan") {
    return (
      <OperationsPlanPanel
        request={request}
        fulfillment={fulfillment}
        onChanged={onLifecycleChanged}
      />
    );
  }

  if (work.phase === "dispatch") {
    return fulfillment?.delivery ? (
      <OperationsAssignmentPanel
        deliveryId={fulfillment.delivery.id}
        onChanged={onLifecycleChanged}
      />
    ) : (
      <ErrorState
        title="The scheduled delivery could not be loaded"
        body="Refresh before assigning a driver."
      />
    );
  }

  if (work.phase === "execute") {
    return fulfillment?.delivery ? (
      <Stack gap={4}>
        <OperationsExecutionPanel
          deliveryId={fulfillment.delivery.id}
          fulfillmentState={fulfillment.delivery.fulfillmentState}
          onChanged={onLifecycleChanged}
        />
        <OperationsAssignmentPanel
          deliveryId={fulfillment.delivery.id}
          onChanged={onLifecycleChanged}
        />
      </Stack>
    ) : null;
  }

  return fulfillment?.delivery ? (
    <OperationsExecutionPanel
      deliveryId={fulfillment.delivery.id}
      fulfillmentState={fulfillment.delivery.fulfillmentState}
      onChanged={onLifecycleChanged}
    />
  ) : (
    <Alert tone="info" title="No further Operations action">
      This request is closed, declined or cancelled.
    </Alert>
  );
}

function workbenchCopy(
  work: OperationsWorkbenchState,
  credited: boolean
): { title: string; description: string } {
  switch (work.lifecycleStage) {
    case "pending_review":
      return {
        title: "Review this delivery",
        description: "Decide whether Couranr can serve it as quoted, needs a revised quote, or cannot confirm service.",
      };
    case "awaiting_payment_authorization":
      return {
        title: "Secure commercial approval",
        description: "The quote is set. Planning stays locked until the real payer authorizes it.",
      };
    case "payment_reauthorization_required":
      return {
        title: "Recover payment authorization",
        description: "The previous authorization ended. Do not plan or capture until the payer authorizes again.",
      };
    case "capture_pending":
      return {
        title: "Resolve the payment provider outcome",
        description: "A capture is in flight. Do not retry it; reconcile the provider result first.",
      };
    case "merchant_preparing":
      return {
        title: "Waiting for Business readiness",
        description: "Commercial settlement is secured. Planning unlocks when the Business marks the shipment ready.",
      };
    case "ready_for_planning":
      return {
        title: "Plan this delivery",
        description: credited
          ? "The Couranr pilot credit is applied and the shipment is ready. Confirm the pickup window and vehicle requirement."
          : "Payment is authorized and the shipment is ready. Confirm the pickup window and vehicle requirement.",
      };
    case "service_plan_confirmed":
      return {
        title: credited ? "Schedule this credited delivery" : "Capture and schedule",
        description: credited
          ? "The service plan is confirmed. Create the canonical delivery against the approved Couranr credit."
          : "The service plan is confirmed. Capture the authorized amount and create the canonical delivery.",
      };
    case "captured_not_scheduled":
      return {
        title: "Finish scheduling",
        description: "Payment is already captured. Create the canonical delivery without taking money again.",
      };
    case "captured_scheduled":
      return {
        title: "Assign a driver",
        description: "The delivery is scheduled and commercially settled. Commit a compatible driver and vehicle.",
      };
    case "driver_assigned":
      return {
        title: "Monitor delivery execution",
        description: "The driver owns movement and proof commands. Operations monitors, resolves issues and can replace the assignment before pickup.",
      };
    default:
      return {
        title: "Delivery complete",
        description: "Review the final execution evidence and audit trail.",
      };
  }
}

function CaseFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>{label}</Text>
      <Text strong>{value}</Text>
    </div>
  );
}
