"use client";

import * as React from "react";
import { Alert, Badge, Card, CardHeader, Grid, Stack, Text } from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchMyAssignment } from "./client";
import { VEHICLE_CLASS_LABELS } from "@/lib/couranr/dispatch/states";

/**
 * DRV-002 — the assigned delivery, as the driver sees it.
 *
 * Renders ONLY what the sanitized projection carries. There is no second fetch
 * that could widen it, and no field here that the projection does not name:
 * money, tenant and audit handles never leave the server, so they cannot be
 * displayed by accident even if someone adds a row to this layout later.
 *
 * "No assignment" and "that delivery is not yours" render identically, because
 * the server answers both the same way. Distinguishing them here would leak
 * the existence of a delivery this driver does not hold.
 *
 * No execution actions. Start route, arrival, pickup PIN, photos and proof are
 * the next slice; showing a disabled button for them now would promise a
 * capability that does not exist.
 */
export function AssignedDeliveryDetail({ deliveryId }: { deliveryId?: string }) {
  const [assigned, setAssigned] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchMyAssignment(deliveryId);
      if (cancelled) return;
      setLoading(false);
      if (isApiFailure(r)) {
        setError(withReference(r));
        return;
      }
      setAssigned(r.value.assigned);
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId]);

  if (loading) {
    return (
      <LoadingState label="Loading your delivery">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  if (error) {
    return <ErrorState title="This delivery could not be loaded" body={error} />;
  }

  if (!assigned) {
    return (
      <EmptyState
        title="No delivery assigned to you"
        body="Couranr assigns work. When a delivery is assigned to you it appears here."
      />
    );
  }

  const a = assigned;

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Your delivery"
          actions={<Badge tone="success">{String(a.fulfillmentState).replace(/_/g, " ")}</Badge>}
        />
        <Alert tone="info" title="Assigned by Couranr">
          Pickup between {new Date(a.scheduledPickupStart).toLocaleString()} and{" "}
          {new Date(a.scheduledPickupEnd).toLocaleString()} ({a.timezone}).
        </Alert>
        <Grid columns={3}>
          <Detail label="Service level" value={a.serviceLevel} />
          <Detail
            label="Vehicle"
            value={
              a.assignment?.vehicle
                ? `${a.assignment.vehicle.name} (${
                    VEHICLE_CLASS_LABELS[a.assignment.vehicle.vehicleClass] ??
                    a.assignment.vehicle.vehicleClass
                  })`
                : "—"
            }
          />
          <Detail
            label="Declared weight"
            value={a.shipment?.declaredWeightLb != null ? `${a.shipment.declaredWeightLb} lb` : "—"}
          />
        </Grid>
      </Card>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Pickup" description="Collect from the business." />
          <Stack gap={1}>
            <AddressLines a={a.pickup} />
            <Text size="sm" muted>
              {a.merchant?.name}
              {a.merchant?.phone ? ` · ${a.merchant.phone}` : ""}
            </Text>
          </Stack>
        </Card>
        <Card>
          <CardHeader title="Drop-off" description="Hand off to the recipient." />
          <Stack gap={1}>
            <AddressLines a={a.dropoff} />
            <Text size="sm" muted>
              {a.recipient?.name}
              {a.recipient?.phone ? ` · ${a.recipient.phone}` : ""}
            </Text>
          </Stack>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Proof required" />
        <Grid columns={3}>
          <Detail label="Method" value={String(a.proof?.method ?? "").replace(/_/g, " ")} />
          <Detail label="Signature" value={a.proof?.signatureRequired ? "Required" : "Not required"} />
          <Detail
            label="Packages"
            value={a.shipment?.packageCount != null ? a.shipment.packageCount : "Not recorded"}
          />
        </Grid>
        <Text size="xs" muted>
          Couranr will enable pickup and drop-off steps here. Nothing has been collected yet.
        </Text>
      </Card>
    </Stack>
  );
}

function AddressLines({ a }: { a: any }) {
  const lines = [
    [a?.line1, a?.line2].filter(Boolean).join(", "),
    [a?.city, a?.region, a?.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean);
  return (
    <>
      {lines.map((l, i) => (
        <Text key={i} size="sm">
          {l}
        </Text>
      ))}
      {a?.instructions ? (
        <Text size="sm" muted>
          Notes: {a.instructions}
        </Text>
      ) : null}
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text strong>{value}</Text>
    </div>
  );
}
