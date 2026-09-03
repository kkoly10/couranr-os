"use client";

import * as React from "react";
import { Alert, Badge, Card, CardHeader, Table, TableScroll, Text } from "@/components/couranr/primitives";
import {
  REVIEW_REASON_LABELS,
  formatCents,
  type DeliveryRequestView,
} from "@/lib/couranr/requests/view";

/**
 * MER-006 quote panel.
 *
 * Displays the SERVER's numbers only. It performs no arithmetic beyond
 * formatting integer cents for display — the subtotal shown is the one the
 * server computed and persisted, never a sum recalculated in the browser.
 *
 * It says "subtotal", never "total" or "amount due": PRC-004 (rounding) and
 * TAX-001 (tax) are unresolved and this release makes no payment decision.
 */
export function QuoteSummary({ request }: { request: DeliveryRequestView }) {
  const q = request.quote;

  if (q.status === "manual_review_required") {
    return (
      <Card>
        <CardHeader
          title="Couranr will confirm your price"
          description="This delivery needs a person to look at it before a price is set."
        />
        <Alert tone="info" title="Pending Couranr review">
          <ul className="cr-list">
            {q.reviewReasons.length === 0 ? (
              <li>Couranr will review this request and follow up with a price.</li>
            ) : (
              q.reviewReasons.map((code) => (
                <li key={code}>{REVIEW_REASON_LABELS[code] ?? code}</li>
              ))
            )}
          </ul>
        </Alert>
        <Text size="sm" muted style={{ marginTop: "var(--couranr-space-3)" }}>
          You can still submit this request. Couranr review happens before any
          delivery is scheduled.
        </Text>
      </Card>
    );
  }

  if (q.status === "invalid" && q.reviewReasons.includes("shipment_prohibited")) {
    return (
      <Card>
        <CardHeader
          title="Couranr can't carry this shipment"
          description="Based on what you confirmed, this delivery includes something Couranr is not able to transport."
        />
        <Alert tone="danger" title="No estimate">
          No price is shown because Couranr cannot perform this delivery. If any
          detail above is wrong, correct it and recalculate — otherwise this
          request cannot proceed.
        </Alert>
      </Card>
    );
  }

  if (q.status !== "estimated") {
    return (
      <Card>
        <CardHeader title="No estimate yet" />
        <Text muted size="sm">
          Add the shipment details and Couranr will calculate an estimate.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Delivery estimate"
        description="Calculated by Couranr from the details you entered."
        actions={<Badge tone="success">Estimated</Badge>}
      />

      <TableScroll>
        <Table numeric caption="Estimate breakdown">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.lineItems.map((li, i) => (
              <tr key={`${li.code}-${i}`}>
                <th scope="row">{li.label}</th>
                <td>{li.quantity}</td>
                <td>{formatCents(li.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Delivery subtotal
              </th>
              <td>{formatCents(q.deliverySubtotalCents)}</td>
            </tr>
          </tfoot>
        </Table>
      </TableScroll>

      <Text size="sm" muted style={{ marginTop: "var(--couranr-space-3)" }}>
        This is a delivery subtotal. Couranr confirms the final amount and how it
        is charged before anything is collected — submitting this request does
        not charge you.
      </Text>

      {q.policyVersion ? (
        <Text size="xs" muted style={{ marginTop: "var(--couranr-space-2)" }}>
          Pricing policy {q.policyVersion}
        </Text>
      ) : null}
    </Card>
  );
}
