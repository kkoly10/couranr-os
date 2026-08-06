"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Grid, Stack, Text } from "@/components/couranr/primitives";
import { Field, Select } from "@/components/couranr/forms";
import { ErrorState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  assignDeliveryFromBrowser,
  fetchDispatchPanel,
  replaceAssignmentFromBrowser,
  type DispatchDriver,
  type DispatchPanelView,
  type DispatchVehicle,
} from "./client";
import {
  AVAILABILITY_LABELS,
  DRIVER_STATE_LABELS,
  VEHICLE_CLASS_LABELS,
  classSatisfies,
  dispatchReasonMessage,
  driverIneligibility,
} from "@/lib/couranr/dispatch/states";

/**
 * OPS-003 — managed dispatch.
 *
 * Couranr assigns work. There is no marketplace and no self-selection: this is
 * the only surface from which an assignment is created, and it is Operations
 * only.
 *
 * Eligibility is shown, never hidden. An ineligible driver or vehicle stays in
 * the list with the REASON next to it rather than being filtered out — an
 * operator who cannot see why the van they expected is missing will assume the
 * screen is broken. The reason strings come from one shared vocabulary, so
 * what the selector says and what the command refuses cannot drift apart.
 *
 * The eligibility shown here is ADVISORY. The database decides at write time
 * against the plan's immutable requirement; this only avoids inviting a 409.
 */

function vehicleIneligibility(
  v: DispatchVehicle,
  driverId: string | null,
  req: { vehicleClass?: string; maxPayloadLb?: number }
): string | null {
  if (!v.active) return "vehicle_inactive";
  if (v.availability_state !== "available") return "vehicle_unavailable";
  if (v.assigned_driver_id && driverId && v.assigned_driver_id !== driverId) {
    return "vehicle_assigned_to_another_driver";
  }
  if (req?.vehicleClass && !classSatisfies(v.vehicle_class, req.vehicleClass)) {
    return "vehicle_class_too_small";
  }
  if (typeof req?.maxPayloadLb === "number" && v.payload_capacity_lb < req.maxPayloadLb) {
    return "vehicle_payload_too_low";
  }
  return null;
}

export function OperationsAssignmentPanel({
  deliveryId,
  onChanged,
}: {
  deliveryId: string;
  /**
   * Fired once the server has accepted an assignment or a replacement.
   *
   * An assignment moves the delivery `scheduled` → `assigned`, and the panels
   * BELOW this one — the execution timeline, the pre-pickup unassign control —
   * read that state from the parent, not from here. Without this the operator
   * sees a driver named in this card while the card under it still says
   * "Scheduled" and offers nothing, until they reload the page by hand.
   */
  onChanged?: () => void;
}) {
  const [view, setView] = React.useState<DispatchPanelView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [driverId, setDriverId] = React.useState("");
  const [vehicleId, setVehicleId] = React.useState("");
  const [replacing, setReplacing] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetchDispatchPanel(deliveryId);
    setLoading(false);
    if (isApiFailure(r)) {
      // A read failure is never rendered as "no drivers". Not knowing and
      // knowing there are none are different facts.
      setError(withReference(r));
      return;
    }
    setError(null);
    setView(r.value);
  }, [deliveryId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;

  if (error && !view) {
    return (
      <Card>
        <CardHeader title="Driver and vehicle" />
        <ErrorState title="Dispatch could not be loaded" body={error} />
      </Card>
    );
  }

  const delivery = view?.delivery ?? null;
  if (!delivery) return null;

  const assignment = view?.assignment ?? null;
  const req = delivery.vehicle_requirement ?? {};
  const drivers = view?.drivers ?? [];
  const vehicles = view?.vehicles ?? [];

  const assignedDriver = assignment ? drivers.find((d) => d.id === assignment.driver_id) : null;
  const assignedVehicle = assignment ? vehicles.find((v) => v.id === assignment.vehicle_id) : null;

  /*
   * A delivery can only be assigned from `scheduled`, and only replaced from
   * `assigned`. Anything else — already picked up, delivered, cancelled — is
   * out of this slice, and the panel says so instead of offering a control the
   * server would refuse.
   */
  const canAssign = delivery.fulfillment_state === "scheduled" && !assignment;
  const canReplace = delivery.fulfillment_state === "assigned" && Boolean(assignment);

  const selectedDriverId = driverId || null;
  const eligibleDriver = (d: DispatchDriver) => driverIneligibility({
    driverState: d.driver_state,
    availabilityState: d.availability_state,
    active: d.active,
  });

  async function submit() {
    // The render-scope `if (!delivery) return null` does not narrow inside
    // this closure, and strictly it should not: the handler runs later. The
    // guard is real, not a type appeasement — a click racing a reload would
    // otherwise read .version off null.
    if (!delivery) return;
    setBusy(true);
    setError(null);
    const r =
      replacing && assignment
        ? await replaceAssignmentFromBrowser({
            deliveryId,
            replacedAssignmentId: assignment.id,
            expectedAssignmentVersion: assignment.version,
            driverId,
            vehicleId,
          })
        : await assignDeliveryFromBrowser({
            deliveryId,
            expectedVersion: delivery.version,
            driverId,
            vehicleId,
          });
    setBusy(false);
    if (isApiFailure(r)) {
      // The server's closed reason code wins over anything this screen guessed.
      const reason = (r as any).reason;
      setError(reason ? dispatchReasonMessage(reason) : withReference(r));
      return;
    }
    setReplacing(false);
    setDriverId("");
    setVehicleId("");
    await load();
    // After this panel's own read, so a parent that re-renders it does not race
    // a refetch that is still in flight.
    onChanged?.();
  }

  return (
    <Card>
      <CardHeader
        title="Driver and vehicle"
        description="Couranr assigns this delivery. Drivers do not select their own work."
        actions={
          assignment ? <Badge tone="success">Assigned</Badge> : <Badge tone="warning">Needs a driver</Badge>
        }
      />

      <Stack gap={4}>
        {error ? <ErrorState title="That could not be completed" body={error} /> : null}

        <Grid columns={3}>
          <Detail label="Required vehicle" value={VEHICLE_CLASS_LABELS[req.vehicleClass ?? ""] ?? req.vehicleClass ?? "—"} />
          <Detail label="Required capacity" value={req.maxPayloadLb ? `${req.maxPayloadLb} lb` : "—"} />
          <Detail label="Fulfillment" value={delivery.fulfillment_state.replace(/_/g, " ")} />
        </Grid>

        {assignment ? (
          <Alert tone="success" title="This delivery has a driver">
            {assignedDriver?.display_name ?? "Driver"} with{" "}
            {assignedVehicle?.name ?? "a vehicle"}
            {assignedVehicle ? ` (${VEHICLE_CLASS_LABELS[assignedVehicle.vehicle_class] ?? assignedVehicle.vehicle_class})` : ""}
            , assigned {new Date(assignment.assigned_at).toLocaleString()}. No pickup has happened yet.
          </Alert>
        ) : null}

        {!canAssign && !canReplace ? (
          <Text size="sm" muted>
            {assignment
              ? "This delivery has moved past the point where its driver can be changed here."
              : "This delivery is not waiting for a driver."}
          </Text>
        ) : null}

        {(canAssign || (canReplace && replacing)) ? (
          <Stack gap={3}>
            <Grid columns={2}>
              <Field label="Driver" required>
                {(a) => (
                  <Select {...a} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">Select a driver…</option>
                    {drivers.map((d) => {
                      const why = eligibleDriver(d);
                      return (
                        <option key={d.id} value={d.id} disabled={Boolean(why)}>
                          {d.display_name} — {DRIVER_STATE_LABELS[d.driver_state] ?? d.driver_state}
                          {", "}
                          {AVAILABILITY_LABELS[d.availability_state] ?? d.availability_state}
                          {why ? " — cannot take work" : ""}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>

              <Field label="Vehicle" required hint="Only a vehicle that meets the committed requirement can be assigned.">
                {(a) => (
                  <Select {...a} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select a vehicle…</option>
                    {vehicles.map((v) => {
                      const why = vehicleIneligibility(v, selectedDriverId, req);
                      return (
                        <option key={v.id} value={v.id} disabled={Boolean(why)}>
                          {v.name} — {VEHICLE_CLASS_LABELS[v.vehicle_class] ?? v.vehicle_class},{" "}
                          {v.payload_capacity_lb} lb
                          {why ? ` — ${dispatchReasonMessage(why)}` : ""}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
            </Grid>

            {/*
              The reason is spelled out under the selector as well as inside the
              option, because a disabled <option> is not announced by every
              screen reader and colour alone must never carry the meaning.
            */}
            {vehicleId
              ? (() => {
                  const v = vehicles.find((x) => x.id === vehicleId);
                  const why = v ? vehicleIneligibility(v, selectedDriverId, req) : null;
                  return why ? (
                    <Alert tone="warning" title="This vehicle cannot take this delivery">
                      {dispatchReasonMessage(why)}
                    </Alert>
                  ) : null;
                })()
              : null}

            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy}
                disabled={!driverId || !vehicleId}
                onClick={submit}
              >
                {replacing ? "Replace assignment" : "Assign delivery"}
              </Button>
              {replacing ? (
                <Button variant="ghost" disabled={busy} onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              ) : null}
            </Cluster>
          </Stack>
        ) : null}

        {canReplace && !replacing ? (
          <Cluster gap={3}>
            <Button variant="secondary" onClick={() => setReplacing(true)} disabled={busy}>
              Replace assignment
            </Button>
            <Text size="xs" muted>
              Before pickup only. The delivery stays assigned; the previous driver and vehicle are released.
            </Text>
          </Cluster>
        ) : null}

        {(view?.events ?? []).length > 0 ? (
          <Stack gap={2}>
            <Text size="sm" strong>
              Assignment timeline
            </Text>
            {(view?.events ?? []).map((e) => (
              <Text key={e.id} size="xs" muted>
                {new Date(e.created_at).toLocaleString()} — {e.command.replace(/_/g, " ")} by {e.actor_type}
              </Text>
            ))}
          </Stack>
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
