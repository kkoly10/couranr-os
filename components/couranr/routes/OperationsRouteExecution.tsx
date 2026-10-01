"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { ConfirmDialog } from "@/components/couranr/interactive";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";

type RouteView = {
  routeRunId: string; title: string; settlementState: string;
  resourceState: string; executionState: string; currentSequence: number;
  driverName: string;
  stops: Array<{ sequence: number; requestId: string;
    fulfillmentState: string; paymentState: string;
    capturedAmountCents: number | null; returnState: string | null }>;
};
const path = "/api/couranr/operations/route-execution";
const label = (state: string) => state.replaceAll("_", " ");

/** Embedded in OPS-003: one Route truth alongside a canonical child case. */
export function OperationsRouteExecution({ requestId, onChanged }: {
  requestId: string; onChanged: () => void;
}) {
  const [route, setRoute] = React.useState<RouteView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [decision, setDecision] = React.useState<"continue_later_stops" | "return_now" | null>(null);
  const readGeneration = React.useRef(0);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    const generation = ++readGeneration.current;
    const result = await call<{ route: RouteView | null }>(
      `${path}?requestId=${encodeURIComponent(requestId)}`);
    if (generation !== readGeneration.current) return;
    setLoadedFor(requestId);
    if (isApiFailure(result)) { setError(withReference(result)); return; }
    setRoute(result.value.route);
    setError(null);
  }, [requestId]);
  React.useEffect(() => { void load(); }, [load]);

  async function resolve() {
    if (!route || loadedFor !== requestId || !decision || busy) return;
    setBusy(true);
    setError(null);
    const result = await call<{ outcome: string }>(path, {
      method: "POST", body: { routeRunId: route.routeRunId, resolution: decision },
    });
    setBusy(false);
    setDecision(null);
    if (isApiFailure(result)) { setError(withReference(result)); await load(); return; }
    await load();
    onChanged();
  }

  if (loadedFor !== requestId || (!route && !error)) return null;
  return <Card>
    <CardHeader title={route ? `Route Run · ${route.title}` : "Route Run status unavailable"}
      description="All child payments, custody states and the single Route resource in one view." />
    <Stack gap={3}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {route ? <>
        <Text>Settlement: <strong>{label(route.settlementState)}</strong> · Resource: <strong>{label(route.resourceState)}</strong> · Driver: <strong>{route.driverName}</strong></Text>
        <Text>Execution: <Badge tone={route.executionState === "exception" ? "warning" : "info"}>
          {label(route.executionState)}</Badge> · Current stop: {route.currentSequence || "common pickup"}</Text>
        <ol>{route.stops.map((stop) => <li key={stop.requestId}>
          <Link href={`/operations/deliveries/${stop.requestId}`}>Stop {stop.sequence}</Link>
          {` · ${label(stop.fulfillmentState)} · ${label(stop.paymentState)}`}
          {stop.returnState ? ` · return ${label(stop.returnState)}` : ""}
        </li>)}</ol>
        {route.executionState === "exception" ? <>
          <Alert tone="warning">{route.currentSequence === 0
            ? "Shared pickup failed. Close each uncollected child through the existing governed failed-pickup cancellation and refund flow. Any loaded child needs a governed physical return. The Route keeps its driver and vehicle until all children are resolved."
            : "Operations must decide whether the driver continues to later stops carrying governed return cargo or returns now. Neither choice changes child payment or proof."}</Alert>
          {route.currentSequence > 0 ? <Button disabled={busy} onClick={() => setDecision("continue_later_stops")}>
            Continue to later stops
          </Button> : null}
          <Button variant="secondary" disabled={busy} onClick={() => setDecision("return_now")}>
            Return now
          </Button>
        </> : null}
      </> : null}
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>Refresh Route status</Button>
    </Stack>
    <ConfirmDialog open={decision !== null} onClose={() => setDecision(null)}
      onConfirm={() => void resolve()} title="Resolve this Route exception?"
      consequence={decision === "continue_later_stops"
        ? "The driver may visit later stops while the failed child's return cargo remains in Couranr custody. The Route cannot close until that return is complete."
        : "The Route will stop visiting later destinations. Operations must govern every child still in custody before the driver and vehicle can be released."}
      confirmLabel={decision === "continue_later_stops" ? "Continue later stops" : "Return now"}
      loading={busy} />
  </Card>;
}
