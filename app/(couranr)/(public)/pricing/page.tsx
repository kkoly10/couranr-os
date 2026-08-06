import Link from "next/link";
import type { Metadata } from "next";
import {
  Badge,
  Card,
  Heading,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import {
  ADDITIONAL_STOP_CENTS,
  BASE_PRICE_CENTS,
  INCLUDED_LOADED_MILES,
  MANUAL_QUOTE_OVER_MILES,
  MANUAL_REVIEW_OVER_LB,
  MILE_TIERS,
  ROUTE_SAVER_FROM_CENTS_PER_STOP,
  ROUTE_SAVER_MIN_STOPS,
  SERVICE_LEVEL_CENTS,
  SIGNATURE_CENTS,
  WAITING_INCLUDED_MINUTES,
  WAITING_PER_MINUTE_CENTS,
  WEIGHT_BANDS,
  dollars,
} from "@/lib/couranr/public/governed";
import { PricingDetails } from "./PricingDetails";

/**
 * PUB-008 — the pricing page. Every number renders from
 * lib/couranr/public/governed.ts (registry-tested; PRC-001, MIL-001/002,
 * SUR-001/002, OVN-001, CAN-001, REF-001).
 *
 * Registry-required states: Standard (default), expanded pricing details
 * (PricingDetails disclosure), manual-quote notice (always visible).
 *
 * What must NOT appear, and why: no product prices or commission model (only
 * delivery and approved operating charges are Couranr's); no tax line
 * (TAX-001 unresolved); no rounded example totals (PRC-004 unresolved); no
 * bookable overnight (OVN-002 unresolved — request-only per OVN-001); no
 * internal driver-cost benchmarks (PRC-002).
 */

export const metadata: Metadata = {
  title: "Pricing — Couranr",
  description: `Delivery starts at ${dollars(BASE_PRICE_CENTS)} for the first ${INCLUDED_LOADED_MILES} loaded miles, with published mileage tiers and approved operating charges. No monthly fee during the pilot.`,
};

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* Hero — the registry's three mandatory statements all appear here:
          first 3 miles $22.99; no monthly fee during pilot; subject to
          Couranr confirmation. */}
      <section className="cr-mkt-hero" aria-labelledby="p-h">
        <p className="cr-mkt-eyebrow">Simple per-delivery pricing</p>
        <h1 id="p-h" className="cr-mkt-h1">
          Clear pricing before approval.
        </h1>
        <p className="cr-mkt-sub">
          No monthly fee during the pilot. Your business or your customer can pay.
          Every estimate remains subject to Couranr confirmation.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      <section aria-labelledby="p-cards-h">
        <h2 id="p-cards-h" className="cr-visually-hidden-h">
          Delivery pricing
        </h2>
        <div className="cr-mkt-price-grid">
          <Card className="cr-mkt-price-featured">
            <Stack gap={3}>
              <Badge tone="info">Standard delivery</Badge>
              <div className="cr-mkt-price-hero">{dollars(BASE_PRICE_CENTS)}</div>
              <Text muted>
                Includes the first {INCLUDED_LOADED_MILES} loaded miles.
              </Text>
              <ul className="cr-mkt-checklist">
                <li>Deterministic server-side estimate</li>
                <li>Business or customer can pay</li>
                <li>Pickup and delivery proof included</li>
                <li>Couranr review before confirmation</li>
              </ul>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Heading level={3}>Additional loaded miles</Heading>
              <Text muted size="sm">
                Tiered by distance — not one flat rate. Mile {INCLUDED_LOADED_MILES + 1}{" "}
                is the first billable mile.
              </Text>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Miles</th>
                      <th scope="col">Per mile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MILE_TIERS.map((t) => (
                      <tr key={t.fromMile}>
                        <td>
                          {t.fromMile}–{t.toMile}
                        </td>
                        <td>{dollars(t.perMileCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Heading level={3}>Common additions</Heading>
              <Text muted size="sm">
                Only applied when selected or required.
              </Text>
              <TableScroll>
                <Table>
                  <tbody>
                    <tr>
                      <td>Priority</td>
                      <td>+{dollars(SERVICE_LEVEL_CENTS.priority)}</td>
                    </tr>
                    <tr>
                      <td>Rush</td>
                      <td>+{dollars(SERVICE_LEVEL_CENTS.rush)}</td>
                    </tr>
                    <tr>
                      <td>Additional stop</td>
                      <td>+{dollars(ADDITIONAL_STOP_CENTS)}</td>
                    </tr>
                    <tr>
                      <td>Signature on delivery</td>
                      <td>+{dollars(SIGNATURE_CENTS)}</td>
                    </tr>
                    <tr>
                      <td>Photo or PIN proof</td>
                      <td>Included</td>
                    </tr>
                  </tbody>
                </Table>
              </TableScroll>
            </Stack>
          </Card>
        </div>
      </section>

      {/* Required state: manual-quote notice — always visible. */}
      <section className="cr-mkt-manual-notice" aria-labelledby="p-manual-h">
        <Stack gap={1}>
          <Heading level={3} id="p-manual-h">
            Manual quote notice
          </Heading>
          <Text size="sm">
            Requests over {MANUAL_QUOTE_OVER_MILES} loaded miles, over{" "}
            {MANUAL_REVIEW_OVER_LB} lb, or with unusual handling requirements are
            captured for Couranr review instead of receiving an automatic final
            quote. Out-of-area requests are captured for review too — never silently
            rejected.
          </Text>
        </Stack>
      </section>

      {/* Required state: expanded pricing details. */}
      <PricingDetails
        weightRows={WEIGHT_BANDS.map((b) => ({
          label: `${b.fromLb}–${b.toLb} lb`,
          price: `+${dollars(b.cents)}`,
        }))}
        overnightCents={SERVICE_LEVEL_CENTS.overnight}
        waitingIncludedMinutes={WAITING_INCLUDED_MINUTES}
        waitingPerMinuteCents={WAITING_PER_MINUTE_CENTS}
        routeSaverFromCents={ROUTE_SAVER_FROM_CENTS_PER_STOP}
        routeSaverMinStops={ROUTE_SAVER_MIN_STOPS}
      />

      <section className="cr-mkt-section" aria-labelledby="p-payer-h">
        <Heading level={2} id="p-payer-h">
          Who pays
        </Heading>
        <Text muted>
          Your business or your customer can pay any delivery — chosen per delivery,
          with no split payments during the MVP. Payment is authorized first and
          captured only after Couranr confirms the schedule and vehicle.
        </Text>
      </section>

      <section className="cr-mkt-closing" aria-labelledby="p-close-h">
        <h2 id="p-close-h" className="cr-mkt-h2-inverse">
          Know the estimate before anyone approves.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--inverse cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>
    </div>
  );
}
