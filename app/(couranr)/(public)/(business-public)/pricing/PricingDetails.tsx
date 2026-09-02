"use client";

import * as React from "react";
import { Button } from "@/components/couranr/primitives";
import {
  CANCELLATION_CENTS,
  OVERNIGHT_WINDOW_COPY,
  RETURN_PRICING_COPY,
  dollars,
} from "@/lib/couranr/public/governed";

/**
 * PUB-008's registry-required "expanded pricing details" state — a real
 * client-side disclosure over the full approved-charge schedule (SUR-001
 * weight bands and waiting, OVN-001 overnight as request-only, CAN-001
 * cancellation, REF-003 return, SUR-004 Route Saver).
 *
 * Overnight is listed with its surcharge but explicitly request-only: OVN-002
 * (the enablement mechanism) is unresolved, so there is no way to book it and
 * this page must not imply one.
 *
 * V3: the three bordered Cards became one ruled schedule. §27.1 caps this page
 * at zero grid-dominant sections outside the two it names, and three cards of
 * tables inside a disclosure was a card grid hiding behind a button. The
 * cancellation and return copy now renders from `governed.ts` instead of being
 * typed in — the return rule was once `1499` and `70%` as literals, which
 * agreed with REF-001 only until REF-003 retired it.
 */

type Row = { label: string; value: React.ReactNode };

function Schedule({ heading, rows }: { heading: string; rows: Row[] }) {
  return (
    <div className="cr-mkt-schedule__group">
      <h3 className="cr-type-label">{heading}</h3>
      <dl className="cr-mkt-schedule">
        {rows.map((r) => (
          <div key={r.label} className="cr-mkt-schedule__row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PricingDetails(props: {
  weightRows: { label: string; price: string }[];
  overnightCents: number;
  waitingIncludedMinutes: number;
  waitingPerMinuteCents: number;
  routeSaverStatusCopy: string;
  trafficIncludedMinutes: number;
  trafficPerMinuteCents: number;
  trafficReviewOverMinutes: number;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="cr-mkt-disclosure">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        aria-controls="cr-pricing-schedule"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide the full schedule" : "Show the full schedule"}
      </Button>

      {/* Rendered but hidden rather than unmounted, so the button's
          aria-controls always points at a real element. */}
      <div id="cr-pricing-schedule" hidden={!open} className="cr-mkt-disclosure__body">
        <Schedule
          heading="Weight and handling"
          rows={[
            ...props.weightRows.map((r) => ({ label: r.label, value: r.price })),
            { label: "Over 200 lb", value: "Couranr review and manual quote" },
          ]}
        />

        <Schedule
          heading="Time and waiting"
          rows={[
            {
              label: "Waiting time",
              value: `First ${props.waitingIncludedMinutes} minutes included, then ${dollars(
                props.waitingPerMinuteCents,
              )}/minute`,
            },
            {
              label: `Overnight (${OVERNIGHT_WINDOW_COPY})`,
              value: `+${dollars(
                props.overnightCents,
              )} — request-only, when Couranr enables and confirms; never stacks with rush`,
            },
            {
              label: "Predicted traffic delay",
              value: `First ${props.trafficIncludedMinutes} minutes included, then ${dollars(
                props.trafficPerMinuteCents,
              )}/minute, quoted up front. Over ${props.trafficReviewOverMinutes} minutes Couranr reviews it. Once you accept a quote, later traffic never changes it.`,
            },
            {
              label: "Tolls and parking",
              value: "Actual documented cost, with no markup, shown separately",
            },
            { label: "Tips", value: "Separate, and 100% to the driver" },
            { label: "Tax", value: "Separate from the delivery subtotal" },
          ]}
        />

        <Schedule
          heading="Cancellation and returns"
          rows={[
            {
              label: "Before Couranr confirmation",
              value: `${dollars(
                CANCELLATION_CENTS.afterAuthorizationBeforeConfirmation,
              )} — the authorization is released`,
            },
            {
              label: "After confirmation, before arrival",
              value: dollars(CANCELLATION_CENTS.afterConfirmationBeforeArrival),
            },
            {
              label: "After arrival, pickup unavailable",
              value: `${dollars(
                CANCELLATION_CENTS.afterArrivalUnavailable,
              )} failed-attempt fee plus approved waiting`,
            },
            { label: "Return after pickup", value: RETURN_PRICING_COPY },
            {
              label: "If Couranr caused it",
              value: `${dollars(CANCELLATION_CENTS.couranrCaused)} — you are not charged for a cancellation, a failed pickup or a corrective return that was our fault`,
            },
          ]}
        />

        <Schedule
          heading="Route Saver"
          rows={[{ label: "Multi-stop runs", value: props.routeSaverStatusCopy }]}
        />
      </div>
    </div>
  );
}
