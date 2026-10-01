"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState, LoadingState, CardSkeleton } from "@/components/couranr/states";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";
import { DriverAssignmentCard } from "@/components/couranr/dispatch/DriverAssignmentCard";
import { useLocationCapture, locationBody } from "@/components/couranr/dispatch/useLocationCapture";
import type { DriverRouteTask as Task, DriverRouteAction } from "@/lib/couranr/routeRuns/executionTypes";

const PATH = "/api/couranr/driver/route-run";
export function DriverRouteTask() {
  const [task, setTask] = React.useState<Task | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const location = useLocationCapture();
  const readGeneration = React.useRef(0);

  const load = React.useCallback(async () => {
    const generation = ++readGeneration.current;
    const result = await call<{ task: Task | null }>(PATH);
    if (generation !== readGeneration.current) return;
    setLoading(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    setError(null);
    setTask(result.value.task);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function run(action: DriverRouteAction) {
    if (!task || busy) return;
    if (action === "arrive_pickup" && !location.usable) {
      location.request();
      return;
    }
    setBusy(true);
    setError(null);
    // A prior dashboard GET must not replace the just-committed command
    // response with an older Route generation.
    ++readGeneration.current;
    const result = await call<{ task: Task }>(PATH, {
      method: "POST",
      body: { routeRunId: task.routeRunId, action,
        ...(action === "arrive_pickup" ? locationBody(location) : {}) },
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      void load();
      return;
    }
    setTask(result.value.task);
    if (action === "arrive_pickup") location.reset();
  }

  if (loading) return <LoadingState label="Loading your Route Run"><CardSkeleton lines={4} /></LoadingState>;
  if (error && !task) return <ErrorState title="Your Route Run could not load"
    body={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!task) return <DriverAssignmentCard />;
  const current = task.stops.find((stop) => stop.sequence === Math.max(task.currentSequence, 1));
  const pickupComplete = task.stops.every((stop) => stop.fulfillmentState === "picked_up");
  const currentTerminal = current && ["delivered", "returned"].includes(current.fulfillmentState);
  const returnCargoOpen = task.stops.some((stop) =>
    ["return_required", "returning"].includes(stop.fulfillmentState));
  return <Card>
    <CardHeader title={task.title} description={`One pickup · ${task.stopCount} separate deliveries`} />
    <Stack gap={4}>
      <Badge tone={task.state === "exception" ? "warning" : "info"}>
        {task.state.replaceAll("_", " ")}
      </Badge>
      <Text muted>Each package needs its own sender credential and pickup proof. Do not depart until every stop shows Picked up.</Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ol>
        {task.stops.map((stop) => <li key={stop.deliveryId}>
          <strong>Stop {stop.sequence}:</strong> {stop.packageDescription ?? "Package"}
          {stop.packageCount !== null ? ` · ${stop.packageCount} package${stop.packageCount === 1 ? "" : "s"}` : ""}
          {` · ${stop.fulfillmentState.replaceAll("_", " ")}`}
          {(task.state === "at_pickup" || task.state === "returning" ||
            (task.state === "exception" && task.currentSequence === 0) ||
            stop.sequence === task.currentSequence ||
            ["return_required", "returning"].includes(stop.fulfillmentState))
            ? <> · <Link href={`/driver/deliveries/${stop.deliveryId}`}>
              {task.state === "at_pickup" ? "Record child pickup" : "Open delivery or return"}
            </Link></> : null}
        </li>)}
      </ol>
      {task.state === "ready" ? <Button disabled={busy}
        onClick={() => void run("start_pickup")}>Start route to pickup</Button> : null}
      {task.state === "en_route_to_pickup" ? <>
        <Text muted>{location.message}</Text>
        <Button disabled={busy || location.status === "requesting"}
          onClick={() => location.usable ? void run("arrive_pickup") : location.request()}>
          {location.usable ? "Confirm arrival at pickup" : "Capture pickup location"}
        </Button>
      </> : null}
      {task.state === "at_pickup" ? <Button disabled={busy || !pickupComplete}
        onClick={() => void run("depart_pickup")}>Depart with verified packages</Button> : null}
      {task.state === "in_progress" ? <>
        <Text>Current destination: Stop {task.currentSequence}.</Text>
        {returnCargoOpen ? <Alert tone="warning">Return cargo remains in your custody. Complete its governed return before this Route can close.</Alert> : null}
        {currentTerminal ? <Button disabled={busy}
          onClick={() => void run("advance_stop")}>Continue to next stop or finish Route</Button> : null}
      </> : null}
      {task.state === "exception" || task.state === "returning" ?
        <Alert tone="warning">A stop has an unresolved exception or return. Keep the cargo secure and follow Operations’ direction. Other stops cannot proceed automatically.</Alert> : null}
      {task.state === "returning" && task.currentSequence === 0 ? <>
        <Text muted>Failed shared pickup: each uncollected child needs its own failed-pickup evidence and governed settlement. Any loaded package needs its own return. Operations must resolve all children before the Route can close.</Text>
        <Button disabled={busy} onClick={() => void run("complete_route")}>Check Route closure</Button>
      </> : null}
      {task.state === "returning" && task.currentSequence > 0 ?
        <Button disabled={busy} onClick={() => void run("complete_route")}>Check return closure</Button> : null}
      {task.state === "completed" ? <Alert tone="success">Route complete. The driver and vehicle have been released.</Alert> : null}
      {task.state === "cancelled" ? <Alert tone="success">The failed Route has closed after child custody and settlement recovery. The driver and vehicle have been released.</Alert> : null}
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>Refresh Route status</Button>
    </Stack>
  </Card>;
}
