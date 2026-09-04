"use client";

import * as React from "react";
import { Badge, Text } from "@/components/couranr/primitives";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { DriverAssignmentCard } from "@/components/couranr/dispatch/DriverAssignmentCard";
import { fetchMyDriverProfile, type DriverAccountView } from "./client";

type State =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; view: DriverAccountView };

function driverStatus(view: DriverAccountView) {
  const d = view.driver;
  if (d.driverState !== "active" || !d.active) {
    return { label: "Unavailable", tone: "warning" as const };
  }
  if (d.availabilityState === "on_delivery") {
    return { label: "On delivery", tone: "info" as const };
  }
  if (d.availabilityState === "available") {
    return { label: "Online", tone: "success" as const };
  }
  return { label: "Offline", tone: "neutral" as const };
}

export function DriverHome() {
  const [state, setState] = React.useState<State>({ kind: "loading" });

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
      <LoadingState label="Loading your driver account">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (state.kind === "failed") {
    return (
      <ErrorState
        title="Your driver account could not be loaded"
        body={state.message}
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }

  const d = state.view.driver;
  const s = driverStatus(state.view);

  return (
    <div className="cr-driver-page cr-driver-home">
      <header className="cr-driver-home__header">
        <div>
          <h1 className="cr-driver-title">
            {d.displayName && d.displayName !== "Driver" ? `Hi, ${d.displayName}` : "Your route"}
          </h1>
          <Text muted>
            {d.availabilityState === "on_delivery"
              ? "Keep the next safe step in front of you."
              : d.availabilityState === "available"
                ? "You are ready for Couranr-managed assignments."
                : "Go online when you are ready to receive assignments."}
          </Text>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </header>

      <DriverAssignmentCard />

      <div className="cr-driver-home__footer-note">
        Couranr assigns compatible work. There is nothing to bid on, claim, or price from the
        Driver app.
      </div>
    </div>
  );
}
