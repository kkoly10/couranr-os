"use client";

import * as React from "react";
import { Badge, Stack, Text, VisuallyHidden } from "@/components/couranr/primitives";
import {
  FULFILLMENT_LABELS,
  FULFILLMENT_ORDER,
  FULFILLMENT_TONES,
  isFulfillmentState,
  type FulfillmentState,
} from "@/lib/couranr/driver/states";

/**
 * The canonical execution timeline, shared by every surface that shows one.
 *
 * ONE RENDERER, because the alternative already happened: three screens each
 * did `String(state).replace(/_/g, " ")` and one painted every state green, so
 * a delivery sitting at a door looked finished. The labels and tones come from
 * `lib/couranr/driver/states.ts`, which is the same module the driver bundle and
 * the server read, so what an operator sees and what the SQL will allow cannot
 * drift.
 *
 * IT DESCRIBES, IT NEVER OFFERS. There is no control here — no state selector,
 * no "advance", no reassignment. Every transition is a named server command
 * invoked from the surface that owns it.
 */

/** The shape both `couranr_delivery_events` and `couranr_assignment_events` share. */
export type ExecutionEvent = {
  command: string;
  created_at: string;
  actor_type: string;
};

/**
 * The happy path, in order. `could_not_deliver` and `cancelled` are deliberately
 * NOT rail steps: they share rank 7 with `delivered`, so rendering them by order
 * would mark every earlier step done and tell an operator that a delivery
 * cancelled while still `assigned` had reached the drop-off.
 */
const RAIL: readonly FulfillmentState[] = [
  "scheduled",
  "assigned",
  "en_route_to_pickup",
  "at_pickup",
  "picked_up",
  "in_transit",
  "at_dropoff",
  "delivered",
];

const STOPPED_STATES: readonly FulfillmentState[] = ["could_not_deliver", "cancelled"];

/**
 * What each recorded command proves the delivery REACHED.
 *
 * `complete_photo_or_pin_delivery` is the command name stored on live rows; the
 * TypeScript vocabulary calls the same transition `complete_direct_handoff`.
 * Both are mapped, because an event written last month cannot be renamed and a
 * timeline that skipped it would show a delivered delivery as never finished.
 */
const EVENT_REACHED_STATE: Record<string, FulfillmentState> = {
  create_delivery_from_capture: "scheduled",
  assign_delivery: "assigned",
  replace_delivery_assignment: "assigned",
  unassign_delivery_before_pickup: "scheduled",
  start_route_to_pickup: "en_route_to_pickup",
  arrive_at_pickup: "at_pickup",
  complete_pickup: "picked_up",
  start_route_to_dropoff: "in_transit",
  arrive_at_dropoff: "at_dropoff",
  complete_photo_or_pin_delivery: "delivered",
  complete_direct_handoff_delivery: "delivered",
  complete_signature_delivery: "delivered",
  complete_leave_at_door_delivery: "delivered",
};

/** Plain-language history lines. Never a bare command name, never "photo or PIN". */
const EVENT_LABELS: Record<string, string> = {
  create_delivery_from_capture: "Couranr created the delivery",
  assign_delivery: "Couranr assigned a driver and vehicle",
  replace_delivery_assignment: "Couranr replaced the assignment",
  unassign_delivery_before_pickup: "Couranr took this off the driver before pickup",
  complete_assignment: "The assignment closed",
  start_route_to_pickup: "The driver started the route to pickup",
  arrive_at_pickup: "The driver arrived at pickup",
  report_pickup_discrepancy: "The driver reported a problem with the shipment",
  resolve_pickup_discrepancy_safe_to_continue: "Couranr Operations cleared the issue",
  complete_pickup: "The driver completed pickup",
  start_route_to_dropoff: "The driver started the route to drop-off",
  arrive_at_dropoff: "The driver arrived at drop-off",
  complete_photo_or_pin_delivery: "Delivered with a recipient PIN handoff",
  complete_direct_handoff_delivery: "Delivered with a recipient PIN handoff",
  complete_signature_delivery: "Delivered with a signature",
  complete_leave_at_door_delivery: "Delivered, left at the door",
};

const ACTOR_LABELS: Record<string, string> = {
  merchant: "the sender",
  customer: "the recipient",
  driver: "the driver",
  operations: "Couranr Operations",
  system: "Couranr",
};

/**
 * A command this build has not seen yet still gets a readable line — and still
 * must not surface the legacy `photo_or_pin` wording, which is a storage name
 * rather than something a person is ever told.
 */
export function humanizeCommand(command: string): string {
  const known = EVENT_LABELS[command];
  if (known) return known;
  return command.replace(/photo_or_pin/g, "recipient_pin").replace(/_/g, " ");
}

type StepStatus = "done" | "current" | "upcoming" | "unconfirmed";

const STATUS_WORDS: Record<StepStatus, string> = {
  done: "Done",
  current: "Now",
  upcoming: "Not started",
  unconfirmed: "Not recorded",
};

function reachedOrderFromEvents(events: readonly ExecutionEvent[]): number {
  let furthest = -1;
  for (const e of events) {
    const state = EVENT_REACHED_STATE[e?.command];
    if (!state) continue;
    const order = FULFILLMENT_ORDER[state];
    if (order > furthest) furthest = order;
  }
  return furthest;
}

export function DeliveryExecutionTimeline({
  current,
  events,
}: {
  current: string;
  events?: ExecutionEvent[];
}) {
  const list = Array.isArray(events) ? events : [];
  // The state arrives as a plain string from an API projection. An unrecognised
  // value is reported as unrecognised rather than being coerced to `scheduled`,
  // which would show an operator a confident and wrong picture.
  const known = isFulfillmentState(current);
  const state = known ? (current as FulfillmentState) : null;
  const stopped = state !== null && STOPPED_STATES.includes(state);

  // A stopped delivery is placed by its EVENTS, not by its rank: `cancelled`
  // ranks alongside `delivered`, and inferring from rank would claim every
  // earlier step completed.
  const furthestRecorded = stopped ? reachedOrderFromEvents(list) : -1;

  function statusFor(step: FulfillmentState): StepStatus {
    if (state === null) return "upcoming";
    if (stopped) return FULFILLMENT_ORDER[step] <= furthestRecorded ? "done" : "unconfirmed";
    const stepOrder = FULFILLMENT_ORDER[step];
    const currentOrder = FULFILLMENT_ORDER[state];
    if (stepOrder < currentOrder) return "done";
    if (stepOrder === currentOrder) return "current";
    return "upcoming";
  }

  return (
    <Stack gap={4}>
      <ol className="cr-stack cr-stack--2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {RAIL.map((step) => {
          const status = statusFor(step);
          return (
            <li
              key={step}
              className="cr-cluster cr-cluster--3"
              aria-current={status === "current" ? "step" : undefined}
              style={{ alignItems: "center" }}
            >
              <StepMarker status={status} />
              <Text
                as="span"
                strong={status === "current"}
                muted={status === "upcoming" || status === "unconfirmed"}
              >
                {FULFILLMENT_LABELS[step]}
              </Text>
              {/* §7: colour and position never carry the meaning on their own. */}
              {status === "current" ? (
                <Badge tone={FULFILLMENT_TONES[step]}>Now</Badge>
              ) : (
                <VisuallyHidden>{STATUS_WORDS[status]}</VisuallyHidden>
              )}
            </li>
          );
        })}

        {stopped && state !== null ? (
          <li className="cr-cluster cr-cluster--3" aria-current="step" style={{ alignItems: "center" }}>
            <StepMarker status="current" />
            <Text as="span" strong>
              {FULFILLMENT_LABELS[state]}
            </Text>
            <Badge tone={FULFILLMENT_TONES[state]}>Now</Badge>
          </li>
        ) : null}
      </ol>

      {stopped ? (
        <Text size="xs" muted>
          This delivery stopped here. Steps above are marked from what Couranr recorded, so any step
          with no recorded event is shown as not recorded rather than assumed.
        </Text>
      ) : null}

      {state === null ? (
        <Text size="xs" muted>
          Couranr does not recognise the state “{String(current)}” for this delivery. Contact Couranr
          Support rather than acting on the steps above.
        </Text>
      ) : null}

      {list.length > 0 ? (
        <Stack gap={2}>
          <Text size="sm" strong>
            What Couranr recorded
          </Text>
          {list.map((e, i) => (
            <Text key={`${e.command}-${e.created_at}-${i}`} size="xs" muted>
              {formatWhen(e.created_at)} — {humanizeCommand(e.command)} ({actorLabel(e.actor_type)})
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function actorLabel(actorType: string): string {
  return ACTOR_LABELS[actorType] ?? actorType;
}

/** An unparseable timestamp renders as a dash rather than "Invalid Date". */
function formatWhen(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function StepMarker({ status }: { status: StepStatus }) {
  const filled = status === "done" || status === "current";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        flex: "0 0 auto",
        borderRadius: "var(--couranr-radius-pill)",
        fontSize: "0.7rem",
        lineHeight: 1,
        color: filled ? "var(--couranr-text-inverse)" : "var(--couranr-text-muted)",
        background:
          status === "done"
            ? "var(--couranr-success)"
            : status === "current"
              ? "var(--couranr-route-blue)"
              : "var(--couranr-surface-sunken)",
        border:
          status === "unconfirmed"
            ? "1px dashed var(--couranr-border-strong)"
            : "1px solid var(--couranr-border-strong)",
      }}
    >
      {status === "done" ? "✓" : status === "unconfirmed" ? "?" : ""}
    </span>
  );
}
