"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Grid, Stack, Text } from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import {
  captureFromBrowser,
  confirmServicePlanFromBrowser,
  reconcileCaptureFromBrowser,
  type FulfillmentView,
} from "./client";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";

/**
 * OPS-003 — service plan, capture, and the canonical delivery result.
 *
 * Capture is deliberately gated in the UI on the same conditions the database
 * enforces, so an operator is never offered a button that will 409. The
 * database remains the authority; this only avoids inviting a failure.
 *
 * There is no amount field. Capture takes the authorized hold.
 */

const VEHICLE_CLASSES = [
  { value: "car", label: "Car" },
  { value: "van", label: "Van" },
  { value: "box_truck", label: "Box truck" },
  { value: "cargo_bike", label: "Cargo bike" },
];

export function OperationsPlanPanel({
  request,
  fulfillment,
  onChanged,
}: {
  request: DeliveryRequestView;
  fulfillment: FulfillmentView | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  const [pickupStart, setPickupStart] = React.useState("");
  const [pickupEnd, setPickupEnd] = React.useState("");
  const [timezone, setTimezone] = React.useState("America/New_York");
  const [vehicleClass, setVehicleClass] = React.useState("van");
  const [maxPayloadLb, setMaxPayloadLb] = React.useState("800");

  if (request.requestState !== "confirmed") return null;

  const plan = fulfillment?.servicePlan ?? null;
  const payment = fulfillment?.payment ?? null;
  const delivery = fulfillment?.delivery ?? null;
  const readiness = fulfillment?.readinessState ?? "not_confirmed";

  const canCapture =
    Boolean(plan) &&
    readiness === "ready" &&
    payment?.paymentState === "authorized" &&
    !delivery;

  /*
   * The capture was started and its outcome is unknown. Capture is withheld —
   * a blind retry is how money already taken gets taken twice — and the only
   * action offered is to ask the provider what happened.
   */
  const captureUnresolved = payment?.paymentState === "capture_pending" && !delivery;

  /*
   * Money TAKEN, no delivery. Conversion is idempotent and runs inside the
   * capture command, so the way out is to run it again — it will short-circuit
   * to the existing obligation and create the delivery.
   *
   * This state used to render as a dead end: `canCapture` was false, so the
   * panel fell through to "The payment is not authorized." on a request whose
   * payment had been captured, and offered nothing at all. Wrong on the fact
   * and wrong on the action.
   */
  const capturedNotScheduled = payment?.paymentState === "captured" && !delivery;

  /*
   * The provider SETTLED this capture as failed. Nothing was taken, the hold
   * is gone, and no amount of retrying on this surface changes that — the
   * payer has to authorize again. Capture must never be offered here.
   */
  const reauthorizationRequired = payment?.paymentState === "failed" && !delivery;

  async function confirmPlan() {
    setBusy(true);
    setError(null);
    const r = await confirmServicePlanFromBrowser({
      id: request.id,
      expectedVersion: request.version,
      pickupStart: new Date(pickupStart).toISOString(),
      pickupEnd: new Date(pickupEnd).toISOString(),
      timezone,
      vehicleClass,
      maxPayloadLb: Number(maxPayloadLb),
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function capture() {
    setBusy(true);
    setError(null);
    const r = await captureFromBrowser({ id: request.id });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    onChanged();
  }

  async function reconcile() {
    setBusy(true);
    setError(null);
    const r = await reconcileCaptureFromBrowser({ id: request.id });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Service plan and capture"
        description="Confirm the pickup window and vehicle, then capture the authorized payment."
        actions={
          delivery ? (
            <Badge tone="success">Scheduled</Badge>
          ) : plan ? (
            <Badge tone="info">Plan confirmed</Badge>
          ) : (
            <Badge tone="neutral">No plan</Badge>
          )
        }
      />

      <Stack gap={4}>
        {error ? <ErrorState title="That could not be completed" body={error} /> : null}

        <Grid columns={3}>
          <Detail label="Pickup readiness" value={readiness.replace(/_/g, " ")} />
          <Detail
            label="Payment"
            value={payment ? payment.paymentState.replace(/_/g, " ") : "none"}
          />
          <Detail
            label="Amount"
            value={payment ? formatCents(payment.amountCents) : "—"}
          />
        </Grid>

        {delivery ? (
          <Alert tone="success" title="Canonical delivery created">
            {formatCents(delivery.capturedAmountCents)} captured. Pickup{" "}
            {new Date(delivery.scheduledPickupStart).toLocaleString()} –{" "}
            {new Date(delivery.scheduledPickupEnd).toLocaleString()} ({delivery.timezone}).
            No driver is assigned yet.
          </Alert>
        ) : null}

        {capturedNotScheduled ? (
          <Alert tone="warning" title="Payment captured — this delivery is not scheduled yet">
            {formatCents(payment.amountCents)} has been taken. The canonical delivery was not
            created, so nothing is scheduled. Finish scheduling — do NOT capture again; the
            money has already moved.
          </Alert>
        ) : null}

        {reauthorizationRequired ? (
          <Alert tone="danger" title="The payment provider ended this authorization">
            Nothing was taken — this is verified from the provider, not assumed. The hold no
            longer exists, so this delivery cannot be planned or captured until the payer
            authorizes again.
            {payment?.payerType === "customer"
              ? " This delivery is paid by the recipient, so the business needs to send them a new secure payment link."
              : " The business needs to authorize again from their delivery screen."}
          </Alert>
        ) : null}

        {captureUnresolved ? (
          <Alert tone="warning" title="Couranr does not know whether this capture completed">
            The payment provider did not confirm the outcome. Do not capture again — check
            with the provider and Couranr will either finish the capture or release the
            hold so it can be retried.
          </Alert>
        ) : null}

        {plan && !editing && !delivery ? (
          <Stack gap={2}>
            <Text size="sm">
              Pickup {new Date(plan.scheduledPickupStart).toLocaleString()} –{" "}
              {new Date(plan.scheduledPickupEnd).toLocaleString()} ({plan.timezone})
            </Text>
            <Text size="xs" muted>
              Vehicle: {plan.vehicleRequirement?.vehicleClass} up to{" "}
              {plan.vehicleRequirement?.maxPayloadLb} lb
            </Text>
          </Stack>
        ) : null}

        {!delivery && !capturedNotScheduled && !captureUnresolved && !reauthorizationRequired && (editing || !plan) ? (
          <Stack gap={3}>
            <Grid columns={2}>
              <Field label="Pickup window start" required>
                {(a) => (
                  <Input
                    {...a}
                    type="datetime-local"
                    value={pickupStart}
                    onChange={(e) => setPickupStart(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Pickup window end" required>
                {(a) => (
                  <Input
                    {...a}
                    type="datetime-local"
                    value={pickupEnd}
                    onChange={(e) => setPickupEnd(e.target.value)}
                  />
                )}
              </Field>
            </Grid>
            <Grid columns={3}>
              <Field label="Timezone" required>
                {(a) => (
                  <Input {...a} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                )}
              </Field>
              <Field label="Vehicle" required>
                {(a) => (
                  <Select
                    {...a}
                    value={vehicleClass}
                    onChange={(e) => setVehicleClass(e.target.value)}
                  >
                    {VEHICLE_CLASSES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Payload capacity (lb)"
                hint="Couranr checks this against the stored shipment weight."
                required
              >
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    value={maxPayloadLb}
                    onChange={(e) => setMaxPayloadLb(e.target.value)}
                  />
                )}
              </Field>
            </Grid>
            <Cluster gap={3}>
              <Button
                variant="secondary"
                loading={busy}
                disabled={!pickupStart || !pickupEnd}
                onClick={confirmPlan}
              >
                Confirm service plan
              </Button>
              {plan ? (
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
            </Cluster>
          </Stack>
        ) : null}

        {!delivery ? (
          <Cluster gap={3}>
            {plan && !editing && !captureUnresolved && !capturedNotScheduled && !reauthorizationRequired ? (
              <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                Change the plan
              </Button>
            ) : null}
            {capturedNotScheduled ? (
              /*
               * Calls the SAME capture command. It sees the obligation is
               * already `captured`, skips Stripe entirely and runs the
               * idempotent conversion — so this cannot take money twice.
               */
              <Button variant="primary" loading={busy} onClick={capture}>
                Finish scheduling
              </Button>
            ) : reauthorizationRequired ? (
              /*
               * No action on this surface. Recovery belongs to the payer, and
               * offering anything capture-shaped here would suggest Operations
               * can force a payment that no longer has an authorization.
               */
              <Text size="sm" muted>
                Waiting for the payer to authorize again. No delivery was created.
              </Text>
            ) : captureUnresolved ? (
              <Button variant="primary" loading={busy} onClick={reconcile}>
                Check with the payment provider
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={!canCapture} onClick={capture}>
                Capture {payment ? formatCents(payment.amountCents) : ""} and schedule
              </Button>
            )}
          </Cluster>
        ) : null}

        {!canCapture && !delivery && !captureUnresolved && !capturedNotScheduled && !reauthorizationRequired ? (
          <Text size="xs" muted>
            {!plan
              ? "Confirm a service plan before capturing."
              : readiness !== "ready"
                ? "The merchant has not marked this ready yet."
                : payment?.paymentState !== "authorized"
                  ? "The payment is not authorized."
                  : ""}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text strong>{value}</Text>
    </div>
  );
}
