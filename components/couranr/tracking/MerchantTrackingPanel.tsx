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
import { Input } from "@/components/couranr/forms";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";

type LinkState = { url: string; expiresAt: string };

/**
 * Manual recipient handoff for the secure PUB-006 token.
 *
 * No SMS/email provider is involved. The merchant copies the one-time raw link
 * and sends it through the customer channel they already use. Leaving this
 * component loses the raw token by design; replacing it revokes the prior link.
 */
export function MerchantTrackingPanel({
  requestId,
  businessAccountId,
  canManage,
}: {
  requestId: string;
  businessAccountId: string | null;
  canManage: boolean;
}) {
  const [link, setLink] = React.useState<LinkState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function createLink() {
    if (!businessAccountId || busy) return;
    setBusy(true);
    setCopied(false);
    setError(null);

    const r = await call<{ token: string; expiresAt: string }>(
      `/api/couranr/delivery-requests/${requestId}/tracking-link`,
      { method: "POST", body: { businessAccountId } }
    );

    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }

    const token = String(r.value.token ?? "");
    if (!token) {
      setError("Couranr did not create a tracking link. Try again.");
      return;
    }

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const url = origin
      ? new URL(`/track/${encodeURIComponent(token)}`, origin).toString()
      : `/track/${encodeURIComponent(token)}`;

    setLink({ url, expiresAt: String(r.value.expiresAt ?? "") });
  }

  async function copyLink() {
    if (!link) return;
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Copy failed. Select the tracking link and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Recipient tracking"
        description="Share a secure delivery-specific link. It does not expose the driver's phone number."
        actions={<Badge tone="info">Secure link</Badge>}
      />
      <Stack gap={3}>
        {!canManage ? (
          <Alert tone="info" title="Tracking link controls are read only">
            An owner, manager, or dispatcher can create the recipient tracking link.
          </Alert>
        ) : null}

        {error ? <Alert tone="danger" title="Tracking link unavailable">{error}</Alert> : null}

        {link ? (
          <Stack gap={2}>
            <Input
              aria-label="Recipient tracking link"
              value={link.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Cluster gap={2}>
              <Button variant="primary" type="button" onClick={() => void copyLink()}>
                Copy tracking link
              </Button>
              <Button
                variant="secondary"
                type="button"
                loading={busy}
                loadingLabel="Replacing…"
                disabled={!canManage}
                onClick={() => void createLink()}
              >
                Replace link
              </Button>
            </Cluster>
            {copied ? (
              <Alert tone="success" title="Tracking link copied">
                Send it directly to the recipient through the customer channel you already use.
              </Alert>
            ) : null}
            <Text size="xs" muted>
              Couranr does not store or show this raw link again. Replacing it immediately disables
              the previous link. {expiryCopy(link.expiresAt)}
            </Text>
          </Stack>
        ) : canManage ? (
          <Stack gap={2}>
            <Alert tone="info" title="Share progress without exposing private driver details">
              The recipient can see sanitized delivery progress and authorized proof. They cannot
              use this link to message the driver directly or change the delivery.
            </Alert>
            <Button
              variant="primary"
              type="button"
              loading={busy}
              loadingLabel="Creating…"
              onClick={() => void createLink()}
            >
              Create tracking link
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

function expiryCopy(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "The server controls when this link expires.";
  return `This link expires ${date.toLocaleDateString()}.`;
}
