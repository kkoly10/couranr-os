"use client";

import * as React from "react";
import {
  Badge,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchMerchantProof, type ProofMetadataView } from "./client";

/**
 * MER-007 — what proof exists for the sender's own delivery.
 *
 * METADATA ONLY, AND THE ABSENCES ARE THE FEATURE. PHO-001's authorized media
 * viewers are Couranr Operations, the assigned driver and the person receiving
 * the delivery; the sender is deliberately not among them. So there is no "Open
 * photo" control here, no URL, no object path and no bucket — and no sibling
 * route that would return one, because for this audience the server does not
 * expose one.
 *
 * A FAILED READ IS NOT "NO PROOF". Those are different facts and a merchant acts
 * differently on each: one is a reason to call Couranr, the other is a reason to
 * call their driver. This repo has already shipped a screen that rendered a
 * failed lookup as "you have no business", so the failure state here is an
 * ErrorState with a retry and never an empty list.
 */

/** Server-side vocabulary. An unknown value is shown verbatim, never blank. */
const STAGE_LABELS: Record<string, string> = {
  pickup: "At pickup",
  pickup_discrepancy: "Reported problem at pickup",
  dropoff: "At drop-off",
};

const TYPE_LABELS: Record<string, string> = {
  shipment_photo: "Photo of the shipment",
  condition_photo: "Photo of the condition",
  securement_photo: "Photo of how the load was secured",
  discrepancy_evidence: "Photo of the reported problem",
  delivery_photo: "Photo at delivery",
  signature: "Signature",
  recipient_pin: "Recipient PIN handoff",
};

export function proofStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? String(stage).replace(/_/g, " ");
}

export function proofTypeLabel(proofType: string): string {
  return TYPE_LABELS[proofType] ?? String(proofType).replace(/_/g, " ");
}

/** An unparseable timestamp renders as a dash rather than "Invalid Date". */
export function formatProofWhen(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function MerchantProofPanel({ deliveryId }: { deliveryId: string }) {
  const [proof, setProof] = React.useState<ProofMetadataView[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  /** Guards against an older read landing after a newer one — see below. */
  const latestRead = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++latestRead.current;
    setLoading(true);
    const r = await fetchMerchantProof(deliveryId);
    // A second load (a retry, or a changed delivery) supersedes this one. Without
    // this, a slow first response can overwrite a newer list and show one
    // delivery's proof under another's id.
    if (mine !== latestRead.current) return;
    setLoading(false);
    if (isApiFailure(r)) {
      // Not knowing and knowing there is none are different facts. The list is
      // cleared so a stale success cannot be read as a current one.
      setProof(null);
      setError(withReference(r));
      return;
    }
    setError(null);
    setProof(Array.isArray(r.value.proof) ? r.value.proof : []);
  }, [deliveryId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <LoadingState label="Loading proof of delivery">
        <CardSkeleton lines={3} />
      </LoadingState>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Proof of delivery" />
        <ErrorState
          title="Couranr could not load the proof for this delivery"
          body={`${error} This does not mean no proof was captured.`}
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </Card>
    );
  }

  const items = proof ?? [];

  return (
    <Card>
      <CardHeader
        title="Proof of delivery"
        description="What Couranr recorded for this delivery."
        actions={
          items.length > 0 ? (
            <Badge tone="success">{items.length === 1 ? "1 record" : `${items.length} records`}</Badge>
          ) : null
        }
      />

      <Stack gap={4}>
        {items.length === 0 ? (
          <EmptyState
            title="No proof recorded yet"
            body="Proof is recorded as the driver completes pickup and delivery. Couranr read this successfully — there is nothing recorded so far."
          />
        ) : (
          <Stack gap={3}>
            {items.map((p) => (
              <div
                key={p.proofId}
                style={{
                  borderTop: "1px solid var(--couranr-border)",
                  paddingTop: "var(--couranr-space-3)",
                }}
              >
                <Cluster gap={2}>
                  <Text as="span" strong>
                    {proofTypeLabel(p.proofType)}
                  </Text>
                  <Badge tone="neutral">{proofStageLabel(p.proofStage)}</Badge>
                  {/* A record with no media is normal — a signature or a PIN
                      handoff carries no image — so this states the fact rather
                      than implying something is missing. */}
                  {p.hasMedia ? (
                    <Badge tone="info">Image attached</Badge>
                  ) : (
                    <Badge tone="neutral">No image</Badge>
                  )}
                </Cluster>
                <Text size="xs" muted>
                  Recorded {formatProofWhen(p.finalizedAt)}
                </Text>
              </div>
            ))}
          </Stack>
        )}

        <Text size="xs" muted>
          Proof images are available to Couranr Operations and to the person receiving the delivery,
          not to the sender. Contact Couranr Support if you need one reviewed.
        </Text>
      </Stack>
    </Card>
  );
}
