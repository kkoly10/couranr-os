"use client";

import * as React from "react";
import { Badge, Button, Card, CardHeader, Cluster, Grid, Stack, Table, TableScroll, Text } from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  createDispatchVehicleFromBrowser,
  fetchDispatchVehicles,
  setVehicleAvailabilityFromBrowser,
  type DispatchVehicle,
} from "./client";
import { AVAILABILITY_LABELS, VEHICLE_CLASSES, VEHICLE_CLASS_LABELS } from "@/lib/couranr/dispatch/states";

/**
 * OPS-008 — the canonical dispatch fleet.
 *
 * Deliberately NOT the auto-rental `vehicles` table. That one has daily and
 * weekly rates, a deposit, a VIN and a `rented` status, and is pinned by live
 * rental rows; it has no payload capacity and no vehicle class, so it cannot
 * answer the only question dispatch asks of a vehicle.
 *
 * Status is never carried by colour alone: every badge is accompanied by its
 * word, per the registry's non-colour-cue requirement.
 */

const TONE: Record<string, "success" | "warning" | "neutral"> = {
  available: "success",
  on_delivery: "warning",
  unavailable: "neutral",
};

export function OperationsVehicleManager() {
  const [vehicles, setVehicles] = React.useState<DispatchVehicle[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const [name, setName] = React.useState("");
  const [vehicleClass, setVehicleClass] = React.useState("van");
  const [payload, setPayload] = React.useState("800");

  const load = React.useCallback(async () => {
    const r = await fetchDispatchVehicles();
    if (isApiFailure(r)) {
      // Never render a failed read as an empty fleet.
      setError(withReference(r));
      setVehicles([]);
      return;
    }
    setError(null);
    setVehicles(r.value.vehicles);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await createDispatchVehicleFromBrowser({
      name,
      vehicleClass,
      payloadCapacityLb: Number(payload),
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setName("");
    setAdding(false);
    await load();
  }

  async function toggle(v: DispatchVehicle) {
    setBusy(true);
    setError(null);
    const r = await setVehicleAvailabilityFromBrowser({
      vehicleId: v.id,
      expectedVersion: v.version,
      availability: v.availability_state === "available" ? "unavailable" : "available",
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    await load();
  }

  if (vehicles === null) {
    return (
      <LoadingState label="Loading the Couranr fleet">
        <TableSkeleton rows={3} />
      </LoadingState>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Couranr fleet"
        description="Vehicles Couranr can dispatch, and what each one can carry."
        actions={
          <Button variant="secondary" onClick={() => setAdding((v) => !v)} disabled={busy}>
            {adding ? "Cancel" : "Add a vehicle"}
          </Button>
        }
      />

      <Stack gap={4}>
        {error ? <ErrorState title="Vehicles could not be loaded" body={error} /> : null}

        {adding ? (
          <Stack gap={3}>
            <Grid columns={3}>
              <Field label="Name" required>
                {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Class" required>
                {(a) => (
                  <Select {...a} value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
                    {VEHICLE_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {VEHICLE_CLASS_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Payload capacity (lb)" required hint="Checked against the weight Couranr committed to.">
                {(a) => (
                  <Input {...a} type="number" value={payload} onChange={(e) => setPayload(e.target.value)} />
                )}
              </Field>
            </Grid>
            <Cluster gap={3}>
              <Button variant="primary" loading={busy} disabled={!name || !payload} onClick={add}>
                Add vehicle
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {vehicles.length === 0 && !error ? (
          <EmptyState
            title="No vehicles yet"
            body="Add the first Couranr vehicle so deliveries can be dispatched."
          />
        ) : (
          <TableScroll>
            <Table caption="Couranr dispatch vehicles">
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Class</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td>{VEHICLE_CLASS_LABELS[v.vehicle_class] ?? v.vehicle_class}</td>
                    <td>{v.payload_capacity_lb} lb</td>
                    <td>
                      {/* Word plus tone — never tone alone. */}
                      <Badge tone={TONE[v.availability_state] ?? "neutral"}>
                        {AVAILABILITY_LABELS[v.availability_state] ?? v.availability_state}
                      </Badge>
                      {!v.active ? <Text size="xs" muted> Out of service</Text> : null}
                    </td>
                    <td>
                      {v.availability_state === "on_delivery" ? (
                        <Text size="xs" muted>
                          On a delivery — release it by replacing the assignment
                        </Text>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggle(v)}>
                          {v.availability_state === "available" ? "Mark unavailable" : "Mark available"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Stack>
    </Card>
  );
}
