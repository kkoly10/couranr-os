"use client";

import * as React from "react";
import { Button, Card, Heading, Stack, Table, TableScroll, Text } from "@/components/couranr/primitives";
import { OVERNIGHT_WINDOW_COPY, dollars } from "@/lib/couranr/public/governed";

/**
 * PUB-008's registry-required "expanded pricing details" state — a real
 * client-side disclosure over the full approved-charge schedule (SUR-001
 * weight bands and waiting, OVN-001 overnight as request-only, CAN-001
 * cancellation, REF-001 return, SUR-002 Route Saver).
 *
 * Overnight is listed with its surcharge but explicitly request-only: OVN-002
 * (the enablement mechanism) is unresolved, so there is no way to book it and
 * this page must not imply one.
 */
export function PricingDetails(props: {
  weightRows: { label: string; price: string }[];
  overnightCents: number;
  waitingIncludedMinutes: number;
  waitingPerMinuteCents: number;
  routeSaverFromCents: number;
  routeSaverMinStops: number;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <section aria-labelledby="pd-h" className="cr-mkt-section">
      <Heading level={2} id="pd-h">
        All approved charges
      </Heading>
      <div>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide the full schedule" : "Show the full schedule"}
        </Button>
      </div>

      {open ? (
        <div className="cr-mkt-price-grid">
          <Card>
            <Stack gap={3}>
              <Heading level={3}>Weight and handling</Heading>
              <TableScroll>
                <Table>
                  <tbody>
                    {props.weightRows.map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td>{r.price}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Over 200 lb</td>
                      <td>Couranr review and manual quote</td>
                    </tr>
                  </tbody>
                </Table>
              </TableScroll>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Heading level={3}>Time and waiting</Heading>
              <TableScroll>
                <Table>
                  <tbody>
                    <tr>
                      <td>Waiting time</td>
                      <td>
                        First {props.waitingIncludedMinutes} minutes included, then{" "}
                        {dollars(props.waitingPerMinuteCents)}/minute
                      </td>
                    </tr>
                    <tr>
                      <td>Overnight ({OVERNIGHT_WINDOW_COPY})</td>
                      <td>
                        +{dollars(props.overnightCents)} — request-only, when Couranr
                        enables and confirms; never stacks with Rush
                      </td>
                    </tr>
                    <tr>
                      <td>Tolls and parking</td>
                      <td>At cost</td>
                    </tr>
                    <tr>
                      <td>Tips</td>
                      <td>100% to the driver</td>
                    </tr>
                  </tbody>
                </Table>
              </TableScroll>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Heading level={3}>Cancellation and returns</Heading>
              <TableScroll>
                <Table>
                  <tbody>
                    <tr>
                      <td>Before Couranr confirmation</td>
                      <td>{dollars(0)} — the authorization is released</td>
                    </tr>
                    <tr>
                      <td>After confirmation, before arrival</td>
                      <td>{dollars(800)}</td>
                    </tr>
                    <tr>
                      <td>After arrival, pickup unavailable</td>
                      <td>{dollars(1500)} failed-attempt fee plus approved waiting</td>
                    </tr>
                    <tr>
                      <td>Return after pickup</td>
                      <td>70% of the original delivery charge, minimum {dollars(1499)}</td>
                    </tr>
                  </tbody>
                </Table>
              </TableScroll>
              <Text muted size="sm">
                Route Saver: from {dollars(props.routeSaverFromCents)} per stop for{" "}
                {props.routeSaverMinStops}+ stops from one pickup, with the route
                order controlled by Couranr. Arranged with Couranr Operations.
              </Text>
            </Stack>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
