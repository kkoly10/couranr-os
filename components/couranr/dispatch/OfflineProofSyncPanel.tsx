"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { EmptyState } from "@/components/couranr/states";
import {
  listOfflineProofs,
  onOfflineProofQueueChanged,
  syncOfflineProof,
  syncPendingOfflineProofs,
  type OfflineProofSummary,
} from "./offlineProofQueue";

function proofLabel(type: string) {
  if (type === "shipment_photo") return "Pickup photo";
  if (type === "securement_photo") return "Securement photo";
  if (type === "delivery_photo") return "Drop-off photo";
  if (type === "signature") return "Signature";
  if (type === "discrepancy_evidence") return "Discrepancy evidence";
  return "Delivery proof";
}

function safeError(code: string | null) {
  if (!code) return "Waiting to retry.";
  if (code === "local_evidence_corrupt") return "The encrypted local evidence can no longer be verified.";
  if (code === "retry_limit") return "Couranr could not verify this proof after repeated retries.";
  if (code.startsWith("storage_")) return "The photo could not reach Couranr storage yet.";
  if (code.startsWith("http_5") || code === "http_0") return "Couranr is temporarily unreachable.";
  return "Couranr could not safely attach this proof to the delivery.";
}

/** DRV-007 — encrypted, local-only proof queue and reconciliation. */
export function OfflineProofSyncPanel({ deliveryId }: { deliveryId: string }) {
  const [items, setItems] = React.useState<OfflineProofSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [verifiedCount, setVerifiedCount] = React.useState(0);
  const [storageError, setStorageError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setItems(await listOfflineProofs(deliveryId));
      setStorageError(null);
    } catch {
      setStorageError("This browser cannot open Couranr's encrypted offline proof store.");
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

  React.useEffect(() => {
    void load();
    return onOfflineProofQueueChanged(() => void load());
  }, [load]);

  React.useEffect(() => {
    const onOnline = async () => {
      setOnline(true);
      const outcomes = await syncPendingOfflineProofs(deliveryId);
      setVerifiedCount((n) => n + outcomes.filter((o) => o.kind === "verified").length);
      await load();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (navigator.onLine) void onOnline();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [deliveryId, load]);

  async function retry(id: string) {
    if (!online || busyId) return;
    setBusyId(id);
    const outcome = await syncOfflineProof(id);
    if (outcome.kind === "verified") setVerifiedCount((n) => n + 1);
    setBusyId(null);
    await load();
  }

  if (loading) {
    return (
      <Card>
        <CardHeader title="Offline proof sync" />
        <Text muted>Checking this device for proof waiting to sync…</Text>
      </Card>
    );
  }

  return (
    <Stack gap={5}>
      <Card>
        <CardHeader
          title="Offline proof sync"
          description="Photos saved during a connection problem stay encrypted on this device until Couranr verifies them."
          actions={<Badge tone={online ? "success" : "warning"}>{online ? "Online" : "Offline"}</Badge>}
        />
        <Stack gap={3}>
          <Text size="sm" muted>
            Couranr never stores your sign-in token, signed upload URL, upload token, or server object path in this queue.
          </Text>
          <a className="cr-link" href={`/driver/deliveries/${deliveryId}`}>Back to delivery</a>
        </Stack>
      </Card>

      {verifiedCount > 0 ? (
        <Alert tone="success" title="Proof verified">
          {verifiedCount} queued proof {verifiedCount === 1 ? "item has" : "items have"} been verified by Couranr.
        </Alert>
      ) : null}

      {storageError ? <Alert tone="danger" title="Offline proof storage unavailable">{storageError}</Alert> : null}

      {!storageError && items.length === 0 ? (
        <EmptyState
          title="No proof waiting to sync"
          body="Anything Couranr has already verified is removed from this device queue."
        />
      ) : null}

      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader
            title={proofLabel(item.envelope.proofType)}
            description={`Captured ${new Date(item.envelope.capturedAt).toLocaleString()}`}
            actions={
              <Badge tone={item.state === "terminal" ? "danger" : item.state === "retrying" ? "info" : "warning"}>
                {item.state === "terminal" ? "Operations attention" : item.state === "retrying" ? "Retrying" : "Pending sync"}
              </Badge>
            }
          />
          <Stack gap={3}>
            <Cluster gap={2}>
              <Badge tone="neutral">{item.envelope.stage}</Badge>
              <Text size="xs" muted>{item.envelope.byteSize.toLocaleString()} bytes · {item.attempts} retries</Text>
            </Cluster>

            {item.state === "terminal" ? (
              <Alert tone="danger" title="This proof needs Couranr Operations">
                {safeError(item.lastErrorCode)}{" "}
                {item.alertReported
                  ? "Operations has been notified."
                  : "Couranr will notify Operations as soon as this device is online."}
              </Alert>
            ) : (
              <Alert tone={online ? "info" : "warning"} title={online ? "Ready to sync" : "Waiting for a connection"}>
                {online ? safeError(item.lastErrorCode) : "Keep this page or the delivery open. Couranr retries when the connection returns."}
              </Alert>
            )}

            {item.state !== "terminal" ? (
              <Button
                variant="secondary"
                loading={busyId === item.id}
                loadingLabel="Syncing…"
                disabled={!online || busyId !== null}
                onClick={() => void retry(item.id)}
              >
                Retry now
              </Button>
            ) : null}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
