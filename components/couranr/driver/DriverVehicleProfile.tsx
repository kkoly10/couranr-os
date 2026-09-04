"use client";

import * as React from "react";
import { Badge, Button, Card, Stack, Text } from "@/components/couranr/primitives";
import { Field, Input } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  fetchMyDriverProfile,
  setMyVehicleAvailability,
  updateMyVehicleCapabilities,
  type DriverAccountView,
  type DriverVehicleView,
} from "./client";

type State =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; view: DriverAccountView };

function statusTone(value: string): "success" | "info" | "neutral" {
  if (value === "available") return "success";
  if (value === "on_delivery") return "info";
  return "neutral";
}

function statusLabel(value: string) {
  if (value === "available") return "Available";
  if (value === "on_delivery") return "On delivery";
  return "Unavailable";
}

export function DriverVehicleProfile() {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const result = await fetchMyDriverProfile();
    if (isApiFailure(result)) {
      setState({ kind: "failed", message: withReference(result) });
      return;
    }
    setState({ kind: "ready", view: result.value });
    setSelectedId((current) => current ?? result.value.vehicles[0]?.id ?? null);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <LoadingState label="Loading your vehicle">
        <CardSkeleton lines={7} />
      </LoadingState>
    );
  }
  if (state.kind === "failed") {
    return (
      <ErrorState
        title="Vehicle profile could not be loaded"
        body={state.message}
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }
  if (state.view.vehicles.length === 0) {
    return (
      <EmptyState
        title="No vehicle associated with you"
        body="Couranr Operations must associate a dispatch vehicle with your driver profile before you can receive compatible assignments."
      />
    );
  }

  const selected =
    state.view.vehicles.find((v) => v.id === selectedId) ?? state.view.vehicles[0];

  return (
    <div className="cr-driver-page">
      <div className="cr-driver-page-heading">
        <div>
          <h1 className="cr-driver-title">Vehicle</h1>
          <Text muted>Keep the capacity facts Couranr uses for matching accurate.</Text>
        </div>
      </div>

      {state.view.vehicles.length > 1 ? (
        <div className="cr-driver-vehicle-switcher" role="list" aria-label="Your vehicles">
          {state.view.vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              className="cr-driver-vehicle-chip"
              aria-pressed={v.id === selected.id}
              onClick={() => setSelectedId(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}

      <VehicleCard
        key={selected.id}
        vehicle={selected}
        onChanged={(next) =>
          setState({
            kind: "ready",
            view: {
              ...state.view,
              vehicles: state.view.vehicles.map((v) => (v.id === next.id ? next : v)),
            },
          })
        }
      />

      <div className="cr-driver-note">
        Couranr Operations owns vehicle assignment and vehicle class. Insurance, registration, and
        inspection verification are not editable from this pilot screen; Couranr must add those as
        dispatch-blocking evidence before presenting them here as verified.
      </div>
    </div>
  );
}

function VehicleCard({
  vehicle,
  onChanged,
}: {
  vehicle: DriverVehicleView;
  onChanged: (next: DriverVehicleView) => void;
}) {
  const locked = vehicle.availabilityState === "on_delivery";
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState(String(vehicle.payloadCapacityLb));
  const [length, setLength] = React.useState(vehicle.cargoLengthIn?.toString() ?? "");
  const [width, setWidth] = React.useState(vehicle.cargoWidthIn?.toString() ?? "");
  const [height, setHeight] = React.useState(vehicle.cargoHeightIn?.toString() ?? "");
  const [enclosed, setEnclosed] = React.useState(vehicle.enclosed);
  const [ramp, setRamp] = React.useState(vehicle.hasRamp);
  const [dolly, setDolly] = React.useState(vehicle.hasDolly);
  const [tieDowns, setTieDowns] = React.useState(vehicle.hasTieDowns);
  const [weather, setWeather] = React.useState(vehicle.weatherProtection);

  async function toggleAvailability() {
    if (locked || busy) return;
    setBusy(true);
    setError(null);
    const result = await setMyVehicleAvailability({
      vehicleId: vehicle.id,
      expectedVersion: vehicle.version,
      availability: vehicle.availabilityState === "available" ? "unavailable" : "available",
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged(result.value.vehicle);
  }

  async function save() {
    if (locked || busy) return;
    const payloadNumber = Number(payload);
    if (!Number.isInteger(payloadNumber) || payloadNumber <= 0) {
      setError("Enter a payload capacity greater than zero.");
      return;
    }
    const toOptional = (value: string) => {
      if (!value.trim()) return null;
      const n = Number(value);
      return Number.isInteger(n) && n > 0 ? n : NaN;
    };
    const l = toOptional(length);
    const w = toOptional(width);
    const h = toOptional(height);
    if ([l, w, h].some((n) => typeof n === "number" && Number.isNaN(n))) {
      setError("Cargo dimensions must be positive whole numbers when entered.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await updateMyVehicleCapabilities({
      vehicleId: vehicle.id,
      expectedVersion: vehicle.version,
      payloadCapacityLb: payloadNumber,
      cargoLengthIn: l,
      cargoWidthIn: w,
      cargoHeightIn: h,
      enclosed,
      hasRamp: ramp,
      hasDolly: dolly,
      hasTieDowns: tieDowns,
      weatherProtection: weather,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged(result.value.vehicle);
    setEditing(false);
  }

  return (
    <Card>
      <div className="cr-driver-vehicle-head">
        <div>
          <h2 className="cr-driver-card-title">{vehicle.name}</h2>
          <Text size="sm" muted>
            {vehicle.vehicleClass.replaceAll("_", " ")}
          </Text>
        </div>
        <Badge tone={statusTone(vehicle.availabilityState)}>
          {statusLabel(vehicle.availabilityState)}
        </Badge>
      </div>

      {locked ? (
        <div className="cr-driver-lock-note">
          This vehicle is reserved for your active delivery. Capacity and availability changes
          unlock when the assignment ends.
        </div>
      ) : null}

      {!editing ? (
        <Stack gap={4}>
          <div className="cr-driver-facts-grid">
            <Fact label="Payload" value={`${vehicle.payloadCapacityLb} lb`} />
            <Fact
              label="Cargo space"
              value={
                vehicle.cargoLengthIn && vehicle.cargoWidthIn && vehicle.cargoHeightIn
                  ? `${vehicle.cargoLengthIn} × ${vehicle.cargoWidthIn} × ${vehicle.cargoHeightIn} in`
                  : "Not recorded"
              }
            />
            <Fact label="Enclosed" value={vehicle.enclosed ? "Yes" : "No"} />
            <Fact label="Weather protected" value={vehicle.weatherProtection ? "Yes" : "No"} />
          </div>

          <div className="cr-driver-equipment">
            <Equipment label="Ramp" enabled={vehicle.hasRamp} />
            <Equipment label="Dolly" enabled={vehicle.hasDolly} />
            <Equipment label="Tie-downs" enabled={vehicle.hasTieDowns} />
          </div>

          {!locked ? (
            <div className="cr-driver-actions">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit capacity
              </Button>
              <Button variant="ghost" loading={busy} onClick={() => void toggleAvailability()}>
                {vehicle.availabilityState === "available" ? "Mark unavailable" : "Mark available"}
              </Button>
            </div>
          ) : null}
        </Stack>
      ) : (
        <Stack gap={4}>
          <div className="cr-driver-edit-grid">
            <Field label="Payload capacity (lb)" required>
              {(p) => <Input {...p} type="number" inputMode="numeric" value={payload} onChange={(e) => setPayload(e.target.value)} />}
            </Field>
            <Field label="Cargo length (in)">
              {(p) => <Input {...p} type="number" inputMode="numeric" value={length} onChange={(e) => setLength(e.target.value)} />}
            </Field>
            <Field label="Cargo width (in)">
              {(p) => <Input {...p} type="number" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value)} />}
            </Field>
            <Field label="Cargo height (in)">
              {(p) => <Input {...p} type="number" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} />}
            </Field>
          </div>

          <div className="cr-driver-check-grid">
            <Check label="Enclosed cargo area" checked={enclosed} onChange={setEnclosed} />
            <Check label="Weather protection" checked={weather} onChange={setWeather} />
            <Check label="Ramp" checked={ramp} onChange={setRamp} />
            <Check label="Dolly" checked={dolly} onChange={setDolly} />
            <Check label="Tie-downs" checked={tieDowns} onChange={setTieDowns} />
          </div>

          <div className="cr-driver-actions">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save vehicle
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Stack>
      )}

      {error ? (
        <div className="cr-driver-inline-error" role="alert">
          {error}
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="cr-driver-fact">
      <Text size="xs" muted>{label}</Text>
      <Text strong>{value}</Text>
    </div>
  );
}

function Equipment({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className="cr-driver-equipment-pill">
      <span aria-hidden="true">{enabled ? "✓" : "—"}</span> {label}
      <span className="cr-visually-hidden">{enabled ? " available" : " not available"}</span>
    </span>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="cr-driver-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
