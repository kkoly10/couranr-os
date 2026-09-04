"use client";

import * as React from "react";
import { Badge, Card, Stack, Text } from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  fetchMyDriverProfile,
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

/**
 * DRV-010 — Driver-visible vehicle facts.
 *
 * READ-ONLY by design. Payload, dimensions, equipment and vehicle availability
 * feed dispatch safety/matching. The Driver surface may show what Couranr has
 * on file, but it must not let a browser rewrite those authoritative facts.
 */
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
          <Text muted>These are the vehicle facts Couranr currently uses for dispatch.</Text>
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

      <VehicleCard vehicle={selected} />

      <div className="cr-driver-note">
        Need something corrected? Contact Couranr Operations. Vehicle capacity, equipment,
        class, assignment and availability stay Operations-controlled because they affect
        automatic matching and safety. Compliance evidence is not shown as verified until
        Couranr can enforce it as a dispatch requirement.
      </div>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: DriverVehicleView }) {
  return (
    <Card>
      <Stack gap={4}>
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

        {vehicle.availabilityState === "on_delivery" ? (
          <div className="cr-driver-lock-note">
            This vehicle is reserved for your active delivery.
          </div>
        ) : null}

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

        <div className="cr-driver-equipment" aria-label="Vehicle equipment">
          <Equipment label="Ramp" enabled={vehicle.hasRamp} />
          <Equipment label="Dolly" enabled={vehicle.hasDolly} />
          <Equipment label="Tie-downs" enabled={vehicle.hasTieDowns} />
        </div>
      </Stack>
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
