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

/**
 * DRV-001 — the canonical current assignment.
 *
 * ADDITIVE on purpose. The dashboard below it still reads the legacy
 * `/api/driver/my-deliveries`, and this slice does not redesign the driver
 * screens; it adds the one thing managed dispatch produces. Styling stays
 * inline for the same reason — consistency with what is actually on the screen
 * today beats a half-converted page.
 *
 * FOUR OUTCOMES, FOUR TREATMENTS. `active`, `recently_completed` and `none`
 * are three distinct facts the server states explicitly, and a FAILED read is a
 * fourth that the server never states at all. Collapsing any of them was the
 * original defect: `{ assigned: null }` meant both "you have no work" and "we
 * could not find out", and this repo has already shipped a screen that rendered
 * a failed lookup as "you have no business". A driver who is told they have
 * nothing goes home.
 */

type CardState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "loaded"; response: DriverAssignmentResponse };

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
    // The FIRST load renders nothing rather than a skeleton: an empty-looking
    // assignment card on a driver's dashboard reads as "no work", and the
    // browser suite asserts on this card's text the moment it becomes visible.
    // A retry is different — the card is already on screen and must not vanish.
    if (attempt === 0) return null;
    return (
      <Shell>
        <p style={muted} role="status">
          Checking your assignment again…
        </p>
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

  const response = state.response;
  switch (response.status) {
    case "active":
      return (
        <Shell>
          <ActiveAssignment assigned={response.assigned} />
        </Shell>
      );
    case "recently_completed":
      return (
        <Shell>
          <CompletionReceipt receipt={response.receipt} />
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
      // A status this build does not know about is NOT "no work". Exhaustive by
      // construction: adding a member to the union fails the type-check here
      // rather than silently falling through to an empty state.
      const unexpected: never = response;
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

/** One place owns the card frame, so the browser test's hook cannot drift. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={card} data-testid="drv001-assignment">
      <h2 style={sectionTitle}>Couranr assignment</h2>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ status: active */

function ActiveAssignment({ assigned }: { assigned: AssignedDeliveryView }) {
  const fulfillment = isFulfillmentState(assigned.fulfillmentState)
    ? assigned.fulfillmentState
    : null;
  const proofMethod = isProofMethod(assigned.proof?.method) ? assigned.proof.method : null;

  // Both halves must be recognized before an action is offered. A state or a
  // method this build does not know is a reason to send the driver to the full
  // screen, never a reason to guess a command the server would refuse.
  const command = fulfillment && proofMethod ? nextDriverCommand(fulfillment, proofMethod) : null;

  const href = `/driver/deliveries/${assigned.deliveryId}`;
  const vehicle = assigned.assignment?.vehicle?.name;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ marginBottom: 12 }}>
        {fulfillment ? (
          <Badge tone={FULFILLMENT_TONES[fulfillment]}>{FULFILLMENT_LABELS[fulfillment]}</Badge>
        ) : (
          // Never echo a raw database enum at a driver — that is how
          // "photo_or_pin" reaches a screen. A neutral, true sentence instead.
          <Badge tone="neutral">Assigned by Couranr</Badge>
        )}
      </div>

      <div style={{ fontWeight: 650 }}>Pickup {pickupWindow(assigned)}</div>

      <div style={{ marginTop: 6, color: "#555" }}>
        {shortAddress(assigned.pickup)} → {shortAddress(assigned.dropoff)}
      </div>

      <div style={{ marginTop: 6, color: "#555" }}>
        {assigned.merchant?.name ? `From ${assigned.merchant.name}. ` : ""}
        {vehicle ? `Vehicle: ${vehicle}.` : "Vehicle: not recorded."}
      </div>

      <div style={actionRow}>
        {command ? (
          // The command runs on the delivery screen, not here. Every driver
          // transition records a location fix, and several also require proof —
          // firing one from a dashboard summary would either skip that evidence
          // or prompt for it in the wrong place.
          <Link href={href} style={primaryButton}>
            {DRIVER_COMMAND_LABELS[command]}
          </Link>
        ) : null}

        {fulfillment && isDrivingState(fulfillment) ? (
          <Link href={`${href}?mode=driving`} style={secondaryButton}>
            Driving Mode
          </Link>
        ) : null}

        <Link href={href} style={linkButton}>
          Open assigned delivery
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------- status: recently_completed */

/**
 * The receipt, and nothing beside it.
 *
 * Six fields survive completion and the absences are the point: no address, no
 * recipient contact, no proof media, no object path, no money. Anything more on
 * this screen would have to be fetched, and a finished delivery stops being
 * readable rather than lingering on a success screen — so there is nothing to
 * fetch it from.
 */
function CompletionReceipt({ receipt }: { receipt: DriverCompletionReceipt }) {
  const method = isProofMethod(receipt.proofMethod) ? receipt.proofMethod : null;
  const delivered = moment(receipt.deliveredAt);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <Badge tone="success">Delivered</Badge>
      </div>

      <div style={{ fontWeight: 650 }}>Delivery completed</div>
      <div style={{ marginTop: 6, color: "#555" }}>
        {delivered ? `Delivered ${delivered}.` : "Delivered."}
        {/* The stored method keeps its historical name; the driver is never
            shown it. "photo_or_pin" is a Recipient PIN handoff. */}
        {method ? ` Proof: ${PROOF_METHOD_LABELS[method]}.` : ""}
      </div>

      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Badge tone={receipt.pickupProofComplete ? "success" : "warning"}>
          {receipt.pickupProofComplete ? "Pickup proof complete" : "Pickup proof incomplete"}
        </Badge>
        <Badge tone={receipt.deliveryProofComplete ? "success" : "warning"}>
          {receipt.deliveryProofComplete ? "Delivery proof complete" : "Delivery proof incomplete"}
        </Badge>
      </div>

      <p style={{ ...muted, marginTop: 12 }}>
        Couranr closes a delivery once it is complete. The address, the recipient and the proof are
        no longer readable on this device. Contact Couranr Support if something about this delivery
        needs to be corrected.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ format */

function moment(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleString();
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
  return [a?.line1, a?.city].filter(Boolean).join(", ") || "address on the delivery screen";
}

/* ------------------------------------------------------------------ styles */

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 20,
  background: "#fff",
  marginTop: 24,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const muted: React.CSSProperties = { marginTop: 10, color: "#555" };

const actionRow: React.CSSProperties = {
  marginTop: 16,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
};

const buttonBase: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 10,
  fontWeight: 650,
  textDecoration: "none",
  display: "inline-block",
};

const primaryButton: React.CSSProperties = {
  ...buttonBase,
  background: "#16a34a",
  color: "#fff",
};

const secondaryButton: React.CSSProperties = {
  ...buttonBase,
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
};

const linkButton: React.CSSProperties = {
  color: "#111827",
  fontWeight: 600,
  textDecoration: "underline",
};
