"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Button, Text } from "@/components/couranr/primitives";
import type { AssignedDeliveryView, DeliveryAddressView } from "./client";
import type { LocationState } from "./useLocationCapture";
import {
  DRIVER_COMMAND_LABELS,
  FULFILLMENT_LABELS,
  isDrivingState,
  isFulfillmentState,
  isProofMethod,
  nextDriverCommand,
} from "@/lib/couranr/driver/states";

/**
 * DRV-005 — Driving Mode.
 *
 * Authority: Master Package §Driving Mode — active during travel states,
 * routine alerts silent, blocking and safety alerts remain visible, typing
 * discouraged. So this screen is one destination, one link out to navigation,
 * and one arrival button. Everything that needs a keyboard lives on the full
 * delivery screen, which the driver reaches by stopping.
 *
 * WHAT IS DELIBERATELY ABSENT: a state picker, a proof-method picker, a second
 * next action. `nextDriverCommand` yields exactly one legal command and this
 * renders that one — a driver choosing between buttons at 45 mph is the failure
 * mode the single-action rule exists to prevent.
 *
 * The safe-stop brief and support messaging are Phase 8–9 and are not built
 * here. A disabled control for them would promise a capability that does not
 * exist.
 */

export type DrivingModeProps = {
  assigned: AssignedDeliveryView;
  /** Runs the ONE arrival command. The parent owns the request and its version. */
  onArrive: () => void | Promise<void>;
  location: LocationState;
  /** True while the arrival request is in flight. */
  busy?: boolean;
  /** A failed arrival, already sanitized by the caller. */
  error?: string | null;
  /**
   * A reported problem still open with Couranr Operations. Blocking and safety
   * alerts stay visible in Driving Mode — this is the one thing that outranks
   * the destination.
   */
  discrepancyOpen?: boolean;
  /** Rendered only when the parent supplies it. */
  onReportIssue?: () => void;
};

export function DrivingMode({
  assigned,
  onArrive,
  location,
  busy = false,
  error = null,
  discrepancyOpen = false,
  onReportIssue,
}: DrivingModeProps) {
  const state = isFulfillmentState(assigned.fulfillmentState) ? assigned.fulfillmentState : null;
  const driving = state !== null && isDrivingState(state) ? state : null;
  const proofMethod = isProofMethod(assigned.proof?.method) ? assigned.proof.method : null;

  // `nextDriverCommand` consults the proof method only at `at_dropoff`, which
  // Driving Mode never renders — but an unrecognized method still blocks the
  // action rather than being papered over with a plausible default.
  const command = driving && proofMethod ? nextDriverCommand(driving, proofMethod) : null;

  const detailHref = `/driver/deliveries/${assigned.deliveryId}`;

  if (!driving) {
    // Reached whenever the mode outlives the movement — an arrival succeeds and
    // the URL still says `?mode=driving`. Saying so beats showing a stale
    // destination the driver has already reached.
    return (
      <div style={frame} data-testid="drv005-driving-mode">
        <Alert tone="info" title="You are not on the road for this delivery">
          Driving Mode covers the parts of a delivery where you are moving. Open the delivery to
          continue.
        </Alert>
        <div style={{ marginTop: 16 }}>
          <Link href={detailHref} style={linkOut}>
            Open the delivery
          </Link>
        </div>
      </div>
    );
  }

  const toPickup = driving === "en_route_to_pickup";
  const destination: DeliveryAddressView = toPickup ? assigned.pickup : assigned.dropoff;
  const destinationLabel = toPickup ? "Pickup" : "Drop-off";
  const contactName = toPickup ? assigned.merchant?.name : assigned.recipient?.name;
  const addressText = fullAddress(destination);

  const locationMessageId = "drv005-location-message";

  return (
    <div style={frame} data-testid="drv005-driving-mode">
      {/* Blocking and safety alerts first, and they never collapse. */}
      {discrepancyOpen ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="danger" title="Couranr Operations is handling a reported problem">
            Wait for Couranr before changing anything about this delivery. You do not decide whether
            it is safe to continue.
          </Alert>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="danger" title="That did not go through">
            {error}
          </Alert>
        </div>
      ) : null}

      {/* The one thing readable at a glance. */}
      <p style={statusText}>{FULFILLMENT_LABELS[driving]}</p>

      <p style={destinationKicker}>{destinationLabel}</p>
      <p style={destinationText}>{addressText || "Address on the delivery screen"}</p>

      {destination?.instructions ? (
        <p style={instructionsText}>{destination.instructions}</p>
      ) : null}

      <div style={{ marginTop: 20 }}>
        {addressText ? (
          // Navigation is handed off to the driver's map app. Couranr does not
          // draw a route and does not follow one.
          <a
            style={navButton}
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              addressText
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Maps
          </a>
        ) : null}
      </div>

      <div style={{ marginTop: 24 }}>
        {command ? (
          <Button
            variant="primary"
            block
            loading={busy}
            loadingLabel="Recording…"
            disabled={!location.usable}
            aria-describedby={location.usable ? undefined : locationMessageId}
            onClick={() => {
              // Defence in depth against a refactor that drops `disabled`:
              // React already suppresses onClick on a disabled button, so this
              // line is unreachable today and cannot be proven from the DOM. It
              // stays because a location is EVIDENCE of an arrival, and a
              // substituted or stale coordinate is worse than no arrival at all.
              if (!location.usable) return;
              void onArrive();
            }}
          >
            {DRIVER_COMMAND_LABELS[command]}
          </Button>
        ) : (
          <Alert tone="warning" title="Couranr cannot confirm the next step here">
            Open the delivery to continue.
          </Alert>
        )}
      </div>

      <div style={{ marginTop: 16 }} id={locationMessageId}>
        {location.usable ? (
          <Text size="sm" muted>
            {location.message}
          </Text>
        ) : (
          <Alert tone="warning" title="Couranr needs your location to record this">
            {location.message}
            <div style={{ marginTop: 12 }}>
              <Button
                variant="secondary"
                onClick={location.request}
                loading={location.status === "requesting"}
                loadingLabel="Finding you…"
              >
                Use my location
              </Button>
            </div>
          </Alert>
        )}
      </div>

      {onReportIssue ? (
        <div style={{ marginTop: 16 }}>
          <Button variant="secondary" block onClick={onReportIssue}>
            Report a blocking issue
          </Button>
        </div>
      ) : null}

      <div style={secondaryInfo}>
        {contactName ? (
          <Text size="sm" muted>
            {destinationLabel} contact: {contactName}
          </Text>
        ) : null}
        <Text size="sm" muted>
          Pickup window {pickupWindow(assigned)}.
        </Text>
        {/* Said plainly, because a screen that shows a map and asks for
            location is read as one that follows you. It does not. */}
        <Text size="sm" muted>
          Couranr records a location only when you press a button on this screen. Nothing here
          tracks you while you drive.
        </Text>
        <Link href={detailHref} style={linkOut}>
          Leave Driving Mode
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ format */

function fullAddress(a: DeliveryAddressView): string {
  const street = [a?.line1, a?.line2].filter(Boolean).join(" ");
  const locality = [a?.city, a?.region, a?.postalCode].filter(Boolean).join(" ");
  return [street, locality].filter(Boolean).join(", ");
}

function moment(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function pickupWindow(a: AssignedDeliveryView): string {
  const from = moment(a.scheduledPickupStart);
  const to = moment(a.scheduledPickupEnd);
  if (from && to) return `${from}–${to}`;
  return from ?? to ?? "confirmed by Couranr";
}

/* ------------------------------------------------------------------ styles */

const frame: React.CSSProperties = {
  padding: 20,
  maxWidth: 560,
  margin: "0 auto",
};

const statusText: React.CSSProperties = {
  fontSize: 30,
  lineHeight: 1.15,
  fontWeight: 800,
  letterSpacing: "-0.01em",
};

const destinationKicker: React.CSSProperties = {
  marginTop: 20,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const destinationText: React.CSSProperties = {
  marginTop: 4,
  fontSize: 22,
  lineHeight: 1.3,
  fontWeight: 650,
};

const instructionsText: React.CSSProperties = {
  marginTop: 8,
  fontSize: 16,
  color: "#374151",
};

const navButton: React.CSSProperties = {
  display: "inline-block",
  padding: "14px 20px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 650,
  fontSize: 17,
  textDecoration: "none",
};

const secondaryInfo: React.CSSProperties = {
  marginTop: 28,
  paddingTop: 16,
  borderTop: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const linkOut: React.CSSProperties = {
  color: "#374151",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "underline",
};
