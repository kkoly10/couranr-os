"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/couranr/primitives";
import { EmptyState, ErrorState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  fetchMyAssignment,
  type AssignedDeliveryView,
  type DriverAssignmentResponse,
  type DriverCompletionReceipt,
} from "./client";
import {
  DRIVER_COMMAND_LABELS,
  FULFILLMENT_LABELS,
  FULFILLMENT_TONES,
  PROOF_METHOD_LABELS,
  isDrivingState,
  isFulfillmentState,
  isProofMethod,
  nextDriverCommand,
} from "@/lib/couranr/driver/states";

type CardState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "loaded"; response: DriverAssignmentResponse };

/**
 * DRV-001 — one canonical current-work card.
 *
 * This is intentionally backed only by /api/couranr/driver/assignment. The
 * legacy /api/driver/my-deliveries feed is not a second source of Driver truth.
 */
export function DriverAssignmentCard() {
  const [state, setState] = React.useState<CardState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      const r = await fetchMyAssignment();
      if (cancelled) return;
      if (isApiFailure(r)) {
        setState({ kind: "failed", message: withReference(r) });
        return;
      }
      setState({ kind: "loaded", response: r.value });
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === "loading") {
    if (attempt === 0) {
      return (
        <section className="cr-driver-assignment cr-driver-assignment--loading" data-testid="drv001-assignment">
          <h2 className="cr-driver-card-title">Couranr assignment</h2>
          <p className="cr-driver-muted" role="status">Checking your assignment…</p>
        </section>
      );
    }
    return (
      <Shell>
        <p className="cr-driver-muted" role="status">Checking your assignment again…</p>
      </Shell>
    );
  }

  if (state.kind === "failed") {
    return (
      <Shell>
        <ErrorState
          title="Your assignment could not be loaded"
          body={`This is a loading problem, not an empty schedule — do not assume Couranr has no work for you. ${state.message}`}
          action={{ label: "Try again", onClick: retry }}
        />
      </Shell>
    );
  }

  switch (state.response.status) {
    case "active":
      return (
        <Shell>
          <ActiveAssignment assigned={state.response.assigned} />
        </Shell>
      );
    case "recently_completed":
      return (
        <Shell>
          <CompletionReceipt receipt={state.response.receipt} />
        </Shell>
      );
    case "none":
      return (
        <Shell>
          <EmptyState
            title="No delivery assigned to you"
            body="Couranr assigns work — there is nothing to accept or claim."
          />
        </Shell>
      );
    default: {
      const unexpected: never = state.response;
      void unexpected;
      return (
        <Shell>
          <ErrorState
            title="Your assignment could not be read"
            body="Couranr sent something this app version does not understand. Reload, and contact Couranr Support if it keeps happening."
            action={{ label: "Try again", onClick: retry }}
          />
        </Shell>
      );
    }
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="cr-driver-assignment" data-testid="drv001-assignment">
      <div className="cr-driver-assignment__heading">
        <h2 className="cr-driver-card-title">Couranr assignment</h2>
      </div>
      {children}
    </section>
  );
}

function ActiveAssignment({ assigned }: { assigned: AssignedDeliveryView }) {
  const fulfillment = isFulfillmentState(assigned.fulfillmentState)
    ? assigned.fulfillmentState
    : null;
  const proofMethod = isProofMethod(assigned.proof?.method) ? assigned.proof.method : null;
  const command =
    fulfillment && proofMethod ? nextDriverCommand(fulfillment, proofMethod) : null;
  const href = `/driver/deliveries/${assigned.deliveryId}`;
  const vehicle = assigned.assignment?.vehicle?.name;

  return (
    <div className="cr-driver-assignment__body">
      <div className="cr-driver-assignment__status">
        {fulfillment ? (
          <Badge tone={FULFILLMENT_TONES[fulfillment]}>{FULFILLMENT_LABELS[fulfillment]}</Badge>
        ) : (
          <Badge tone="neutral">Assigned by Couranr</Badge>
        )}
      </div>

      <div className="cr-driver-assignment__window">
        Pickup {pickupWindow(assigned)}
      </div>

      <div className="cr-driver-route" aria-label="Delivery route">
        <div className="cr-driver-route__stop">
          <span className="cr-driver-route__dot" aria-hidden="true" />
          <div>
            <span className="cr-driver-route__label">Pickup</span>
            <strong>{shortAddress(assigned.pickup)}</strong>
          </div>
        </div>
        <div className="cr-driver-route__line" aria-hidden="true" />
        <div className="cr-driver-route__stop">
          <span className="cr-driver-route__dot cr-driver-route__dot--end" aria-hidden="true" />
          <div>
            <span className="cr-driver-route__label">Drop-off</span>
            <strong>{shortAddress(assigned.dropoff)}</strong>
          </div>
        </div>
      </div>

      <div className="cr-driver-assignment__meta">
        {assigned.merchant?.name ? <span>{assigned.merchant.name}</span> : null}
        <span>{vehicle ? vehicle : "Vehicle not recorded"}</span>
      </div>

      <div className="cr-driver-actions">
        {command ? (
          <Link href={href} className="cr-button cr-button--primary cr-driver-primary-action">
            {DRIVER_COMMAND_LABELS[command]}
          </Link>
        ) : null}

        {fulfillment && isDrivingState(fulfillment) ? (
          <Link href={`${href}?mode=driving`} className="cr-button cr-button--secondary">
            Driving Mode
          </Link>
        ) : null}

        <Link href={href} className="cr-button cr-button--ghost">
          Open assigned delivery
        </Link>
      </div>
    </div>
  );
}

function CompletionReceipt({ receipt }: { receipt: DriverCompletionReceipt }) {
  const method = isProofMethod(receipt.proofMethod) ? receipt.proofMethod : null;
  const delivered = moment(receipt.deliveredAt);

  return (
    <div className="cr-driver-assignment__body">
      <Badge tone="success">Delivered</Badge>
      <h3 className="cr-driver-assignment__complete-title">Delivery completed</h3>
      <p className="cr-driver-muted">
        {delivered ? `Delivered ${delivered}.` : "Delivered."}
        {method ? ` Proof: ${PROOF_METHOD_LABELS[method]}.` : ""}
      </p>
      <div className="cr-driver-proof-badges">
        <Badge tone={receipt.pickupProofComplete ? "success" : "warning"}>
          {receipt.pickupProofComplete ? "Pickup proof complete" : "Pickup proof incomplete"}
        </Badge>
        <Badge tone={receipt.deliveryProofComplete ? "success" : "warning"}>
          {receipt.deliveryProofComplete ? "Delivery proof complete" : "Delivery proof incomplete"}
        </Badge>
      </div>
      <p className="cr-driver-muted">
        Couranr closes a delivery once it is complete. Contact Couranr Support if something about
        this delivery needs to be corrected.
      </p>
    </div>
  );
}

function moment(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function pickupWindow(a: AssignedDeliveryView): string {
  const from = moment(a.scheduledPickupStart);
  const to = moment(a.scheduledPickupEnd);
  const tz = a.timezone ? ` (${a.timezone})` : "";
  if (from && to) return `${from} – ${to}${tz}`;
  if (from) return `${from}${tz}`;
  return "time to be confirmed by Couranr";
}

function shortAddress(a: AssignedDeliveryView["pickup"]): string {
  return [a?.line1, a?.city].filter(Boolean).join(", ") || "Address on delivery details";
}
