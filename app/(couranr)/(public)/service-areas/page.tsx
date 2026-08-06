import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Grid, Heading, Stack, Text } from "@/components/couranr/primitives";
import { MARKETED_MARKETS, MARKETS_PUBLIC_COPY } from "@/lib/couranr/public/governed";

/**
 * PUB-010 — service areas. MKT-001's four named markets plus "surrounding
 * areas", and SVC-001's review-based behavior for everything else.
 *
 * WHAT IS DELIBERATELY ABSENT: any radius, polygon, ZIP list, coverage map or
 * eligibility checker. SVC-002 (the precise boundary) is an UNRESOLVED owner
 * decision — inventing a boundary here is forbidden, and out-of-area requests
 * are captured for Couranr review, never rejected (SVC-001
 * `silent_zip_rejection: false`). Maryland is excluded from initial marketing
 * and does not appear. Required states: primary market, surrounding area,
 * extended-distance review — all three rendered.
 */

export const metadata: Metadata = {
  title: "Service areas — Couranr",
  description: MARKETS_PUBLIC_COPY,
};

export default function Page() {
  return (
    <div className="cr-mkt">
      <section className="cr-mkt-hero" aria-labelledby="sa-h">
        <p className="cr-mkt-eyebrow">Where Couranr operates</p>
        <h1 id="sa-h" className="cr-mkt-h1">
          Local, and honest about it.
        </h1>
        <p className="cr-mkt-sub">{MARKETS_PUBLIC_COPY}</p>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      <section className="cr-mkt-section" aria-labelledby="sa-mkts-h">
        <Heading level={2} id="sa-mkts-h">
          Launch markets
        </Heading>
        <Grid columns={4}>
          {MARKETED_MARKETS.map((m) => (
            <Card key={m}>
              <Stack gap={2}>
                <Badge tone="info">Primary market</Badge>
                <Heading level={3}>{m}</Heading>
              </Stack>
            </Card>
          ))}
        </Grid>
      </section>

      <section className="cr-mkt-section" aria-labelledby="sa-around-h">
        <Heading level={2} id="sa-around-h">
          Surrounding areas
        </Heading>
        <Text muted>
          Deliveries that start or end near a launch market are usually workable.
          Request an estimate with your real addresses — pricing is computed on the
          actual driving distance, not on which town name you typed.
        </Text>
      </section>

      <section className="cr-mkt-section" aria-labelledby="sa-ext-h">
        <Heading level={2} id="sa-ext-h">
          Outside the area? We look before we answer.
        </Heading>
        <Card>
          <Stack gap={2}>
            <Badge tone="warning">Extended-distance review</Badge>
            <Text muted size="sm">
              Couranr never silently rejects a request by ZIP code. Longer or
              out-of-area requests are captured and reviewed by Couranr Operations,
              and you get a real answer — a workable quote or a clear no — instead of
              a form that refuses to submit.
            </Text>
          </Stack>
        </Card>
      </section>

      <section className="cr-mkt-closing" aria-labelledby="sa-close-h">
        <h2 id="sa-close-h" className="cr-mkt-h2-inverse">
          If your delivery starts here, start the estimate.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
          <Link href="/sign-up" className="cr-button cr-button--inverse cr-button--lg">
            Create your business account
          </Link>
        </div>
      </section>
    </div>
  );
}
