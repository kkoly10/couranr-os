"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { openRefundReview } from "./client";

/**
 * Terminal-delivery reachability for OPS-011.
 *
 * This button only opens a delivery-charge review. It never decides whether a
 * refund is owed and carries no money amount. The refund queue remains the only
 * Operations surface that can approve/deny and settle provider money.
 */
export function OperationsRefundReviewEntry({
  requestId,
  fulfillmentState,
  paymentState,
}: {
  requestId: string;
  fulfillmentState: string;
  paymentState: string | null;
}) {
  const [busy, setBusy] = React.useState(false);
  const [opened, setOpened] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const terminalEligible =
    fulfillmentState === "returned" || fulfillmentState === "could_not_deliver";
  const capturedCharge = paymentState === "captured";

  if (!terminalEligible || !capturedCharge) return null;

  async function openReview() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await openRefundReview({
      deliveryRequestId: requestId,
      detail:
        fulfillmentState === "returned"
          ? "Operations opened a delivery-charge review after the return completed. Determine delivery-service refund eligibility separately from merchandise."
          : "Operations opened a delivery-charge review after the delivery could not be completed. Determine delivery-service refund eligibility separately from merchandise.",
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    setOpened(true);
  }

  return (
    <Card>
      <CardHeader
        title="Delivery-charge refund review"
        description="A return or failed delivery does not automatically mean a refund is owed. Open a review so Operations can decide from the recorded delivery evidence."
      />
      <Stack gap={3}>
        <Text size="sm" muted>
          This action creates a review only. It does not refund merchandise,
          move money, or decide the amount of any Couranr delivery-charge refund.
        </Text>

        {error ? <Alert tone="danger" title="Refund review could not be opened">{error}</Alert> : null}
        {opened ? (
          <Alert tone="success" title="Refund review opened">
            The delivery is now reachable from the Operations refund queue.
          </Alert>
        ) : null}

        <Cluster gap={3}>
          {!opened ? (
            <Button
              variant="secondary"
              loading={busy}
              loadingLabel="Opening review…"
              onClick={() => void openReview()}
            >
              Open delivery-charge refund review
            </Button>
          ) : null}
          <Link href="/operations/refunds">Open refund queue</Link>
        </Cluster>
      </Stack>
    </Card>
  );
}
