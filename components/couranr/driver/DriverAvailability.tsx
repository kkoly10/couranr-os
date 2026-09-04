"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState, LoadingState, CardSkeleton } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  fetchMyDriverProfile,
  setMyDriverAvailability,
  type DriverAccountView,
} from "./client";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; view: DriverAccountView };

function status(view: DriverAccountView) {
  const d = view.driver;
  if (d.driverState !== "active" || !d.active) {
    return {
      label: "Unavailable",
      tone: "warning" as const,
      title: "Couranr review required",
      body: "Your driver account is not active, so you cannot receive automatic assignments.",
    };
  }
  if (d.availabilityState === "on_delivery") {
    return {
      label: "On delivery",
      tone: "info" as const,
      title: "You are on a delivery",
      body:
        d.availabilityPreference === "unavailable"
          ? "You will go offline when this assignment releases."
          : "You will return online when this assignment releases.",
    };
  }
  if (d.availabilityState === "available") {
    return {
      label: "Online",
      tone: "success" as const,
      title: "You are online",
      body: "Couranr may automatically assign compatible work while you are online.",
    };
  }
  return {
    label: "Offline",
    tone: "neutral" as const,
    title: "You are offline",
    body: "Couranr will not automatically assign new work while you are offline.",
  };
}

export function DriverAvailability() {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const result = await fetchMyDriverProfile();
    if (isApiFailure(result)) {
      setState({ kind: "failed", message: withReference(result) });
      return;
    }
    setState({ kind: "ready", view: result.value });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <LoadingState label="Loading your availability">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  if (state.kind === "failed") {
    return (
      <ErrorState
        title="Availability could not be loaded"
        body={state.message}
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }

  const { view } = state;
  const d = view.driver;
  const s = status(view);
  const activeVehicle = view.vehicles[0] ?? null;
  const blocked = d.driverState !== "active" || !d.active;

  const target: "available" | "unavailable" =
    d.availabilityState === "on_delivery"
      ? d.availabilityPreference === "available"
        ? "unavailable"
        : "available"
      : d.availabilityState === "available"
        ? "unavailable"
        : "available";

  const actionLabel =
    d.availabilityState === "on_delivery"
      ? target === "unavailable"
        ? "Go offline after this delivery"
        : "Stay online after this delivery"
      : target === "unavailable"
        ? "Go offline"
        : "Go online";

  async function change() {
    if (blocked || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await setMyDriverAvailability({
      expectedVersion: d.version,
      preference: target,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setActionError(withReference(result));
      return;
    }
    setState({
      kind: "ready",
      view: { ...view, driver: result.value.driver },
    });
  }

  return (
    <div className="cr-driver-page">
      <section className="cr-driver-status-card" aria-labelledby="driver-status-title">
        <div className="cr-driver-status-card__top">
          <div>
            <h1 id="driver-status-title" className="cr-driver-title">
              Availability
            </h1>
            <Text muted>Control whether Couranr can assign your next delivery.</Text>
          </div>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>

        <div className="cr-driver-status-card__body">
          <h2 className="cr-driver-card-title">{s.title}</h2>
          <Text muted>{s.body}</Text>
        </div>

        {!blocked ? (
          <Button variant="primary" loading={busy} onClick={() => void change()}>
            {actionLabel}
          </Button>
        ) : null}

        {actionError ? (
          <div className="cr-driver-inline-error" role="alert">
            {actionError}
          </div>
        ) : null}
      </section>

      <Card>
        <Stack gap={3}>
          <h2 className="cr-driver-card-title">Vehicle on your profile</h2>
          {activeVehicle ? (
            <>
              <div className="cr-driver-fact-row">
                <div>
                  <Text strong>{activeVehicle.name}</Text>
                  <Text size="sm" muted>
                    {activeVehicle.vehicleClass.replaceAll("_", " ")}
                  </Text>
                </div>
                <Badge tone={activeVehicle.availabilityState === "on_delivery" ? "info" : activeVehicle.availabilityState === "available" ? "success" : "neutral"}>
                  {activeVehicle.availabilityState === "on_delivery"
                    ? "On delivery"
                    : activeVehicle.availabilityState === "available"
                      ? "Available"
                      : "Unavailable"}
                </Badge>
              </div>
              <Link href="/driver/vehicle" className="cr-button cr-button--secondary">
                View vehicle profile
              </Link>
            </>
          ) : (
            <Text muted>No vehicle is associated with your driver profile. Contact Couranr Operations.</Text>
          )}
        </Stack>
      </Card>

      <div className="cr-driver-note">
        Being online makes you eligible for compatible Couranr-managed assignments. It does not
        guarantee work and does not create a public offer marketplace.
      </div>
    </div>
  );
}
