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
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  DISCREPANCY_REASONS,
  DISCREPANCY_REASON_LABELS,
  isDiscrepancyReason,
  type DiscrepancyReason,
} from "@/lib/couranr/driver/states";
import { reportDiscrepancy } from "./client";
import { useLocationCapture } from "./useLocationCapture";
import { useProofUpload } from "./useProofUpload";

/**
 * DRV-004 — the driver reports that the shipment is not what they were sent for.
 *
 * RAISING IS ALL A DRIVER CAN DO WITH IT. This screen has exactly one mutation:
 * open an issue. Nothing here clears one, approves a requote, changes the
 * vehicle or overrides the price — `couranr_report_pickup_discrepancy` can only
 * insert an `open` row, and only the Operations-gated safe-to-continue command
 * moves it. That asymmetry is the product decision: the person under time
 * pressure at a loading dock is not the person who decides the shipment is fine
 * to carry, so this component renders no control that would let them.
 *
 * While an issue is open the SQL refuses `complete_pickup` outright, so the
 * paused state below is a description of what the database is already doing
 * rather than a client-side courtesy.
 */

/** Half the route's 1000-character bound — a driver is typing this one-handed. */
const MAX_NOTES = 500;

export function PickupDiscrepancy({
  deliveryId,
  open,
  onReported,
}: {
  deliveryId: string;
  /** Whether the reporting form is shown. A REPORTED issue ignores this — see below. */
  open: boolean;
  onReported: () => void;
}) {
  const [reason, setReason] = React.useState<DiscrepancyReason | "">("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  /** The reason as ACCEPTED by the server, so the paused state cannot echo an edit. */
  const [reportedReason, setReportedReason] = React.useState<DiscrepancyReason | null>(null);

  /*
   * This component owns its own fix rather than taking one as a prop, because
   * its props are fixed by the integration contract. It is used for the
   * evidence photo only — see the guard on that field.
   */
  const location = useLocationCapture();

  /*
   * The photo is captured BEFORE the report exists, so it carries no
   * `discrepancyId` and cannot: the row it would reference has not been
   * inserted yet. It is still recorded against this delivery with the
   * `pickup_discrepancy` stage, which is how Operations finds it. Uploading
   * after the report would link it, but that would mean rendering an upload
   * control inside the paused state, and the paused state must offer the driver
   * nothing to press.
   */
  const evidence = useProofUpload({
    deliveryId,
    stage: "pickup_discrepancy",
    proofType: "discrepancy_evidence",
    location,
  });

  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const uploadBusy =
    evidence.status === "reading" ||
    evidence.status === "authorizing" ||
    evidence.status === "uploading" ||
    evidence.status === "finalizing" ||
    evidence.status === "queued" ||
    evidence.finalized;

  async function submit() {
    if (reason === "" || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const r = await reportDiscrepancy(deliveryId, {
      reason,
      // An untouched notes box is ABSENT, not an empty observation.
      notes: notes.trim() === "" ? undefined : notes.trim(),
    });
    setSubmitting(false);
    if (isApiFailure(r)) {
      setSubmitError(withReference(r));
      return;
    }
    setReportedReason(reason);
    onReported();
  }

  /*
   * PAUSED BEATS COLLAPSED. Once an issue is open, this renders regardless of
   * `open`: a parent that closes its disclosure must not be able to hide the
   * fact that the pickup cannot be completed. A driver who sees the form
   * disappear concludes the report did not go through and completes the pickup.
   */
  if (reportedReason !== null) {
    return <PausedByReview reason={reportedReason} photoRecorded={evidence.finalized} />;
  }

  if (!open) return null;

  return (
    <Card>
      <CardHeader
        title="Report a problem with this pickup"
        description="Reporting pauses this pickup. Couranr Operations decides what happens next — nothing you do here resolves it."
      />
      <Stack gap={4}>
        <Field label="What is wrong?" required hint="Pick the closest match. Add anything else in the notes.">
          {(a) => (
            <Select
              {...a}
              value={reason}
              // Narrowed through the shared guard rather than cast: a value the
              // vocabulary does not contain is not a reason, and the route
              // would refuse it anyway.
              onChange={(e) => setReason(isDiscrepancyReason(e.target.value) ? e.target.value : "")}
            >
              <option value="">Choose what is wrong</option>
              {DISCREPANCY_REASONS.map((r) => (
                <option key={r} value={r}>
                  {DISCREPANCY_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="What you can see"
          hint={`Facts help Operations decide faster. ${Math.max(0, MAX_NOTES - notes.length)} characters left.`}
        >
          {(a) => (
            <Textarea
              {...a}
              rows={3}
              maxLength={MAX_NOTES}
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
            />
          )}
        </Field>

        <Field
          label="Photo of the problem"
          hint="Optional. One photo showing what does not match."
        >
          {(a) => (
            <Stack gap={2}>
              <input
                {...a}
                type="file"
                accept="image/*"
                className="cr-input"
                /*
                 * A photo is a claim about where it was taken, so it is blocked
                 * without a usable fix — never sent with 0/0 or a stale one.
                 * The REPORT itself is not blocked: it carries no coordinates
                 * at all, and refusing a safety report because a phone cannot
                 * see the sky in a basement dock would leave the driver with
                 * completing the pickup as their only move.
                 */
                disabled={!location.usable || uploadBusy}
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;
                  setSelectedName(file.name);
                  if (evidence.status !== "idle") evidence.reset();
                  void evidence.upload(file);
                }}
              />

              <Cluster gap={2}>
                {/* Selected is not recorded. Only the server reading the stored
                    object back makes it proof. */}
                {evidence.finalized ? (
                  <Badge tone="success">Recorded</Badge>
                ) : evidence.status === "queued" ? (
                  <Badge tone="warning">Saved — waiting to sync</Badge>
                ) : selectedName ? (
                  <Badge tone="warning">Selected — not recorded yet</Badge>
                ) : (
                  <Badge tone="neutral">No photo</Badge>
                )}
                {selectedName ? (
                  <Text as="span" size="xs" muted>
                    {selectedName}
                  </Text>
                ) : null}
              </Cluster>

              {!location.usable ? (
                <Cluster gap={2}>
                  <Text as="span" size="xs" muted>
                    {location.message}
                  </Text>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={location.status === "requesting"}
                    loadingLabel="Finding…"
                    onClick={location.request}
                  >
                    {location.status === "not_requested" ? "Share location" : "Try again"}
                  </Button>
                </Cluster>
              ) : null}

              {uploadBusy ? (
                <Text size="xs" muted>
                  Recording this photo with Couranr…
                </Text>
              ) : null}

              {evidence.status === "failed" ? (
                <Alert tone="danger" title="That photo was not recorded">
                  {evidence.error ?? "Take the photo again."}
                </Alert>
              ) : null}
            </Stack>
          )}
        </Field>

        <Alert tone="warning" title="Do not complete this pickup">
          If the shipment is not what Couranr sent you for, report it and wait. Couranr Operations
          will contact you.
        </Alert>

        {submitError ? (
          <Alert tone="danger" title="That report was not sent">
            {submitError}
          </Alert>
        ) : null}

        <Cluster gap={3}>
          <Button
            variant="secondary"
            loading={submitting}
            loadingLabel="Reporting…"
            // The photo is optional, so it is deliberately not a condition here.
            disabled={reason === ""}
            onClick={() => void submit()}
          >
            Report this problem
          </Button>
        </Cluster>
      </Stack>
    </Card>
  );
}

/**
 * The paused state.
 *
 * NO CONTROLS AT ALL, by construction. There is no "mark it fine", no requote
 * approval, no vehicle change and no way to withdraw the report — every one of
 * those is an Operations decision, and a button here would either lie about
 * what it does or hand the decision to the wrong person.
 */
function PausedByReview({
  reason,
  photoRecorded,
}: {
  reason: DiscrepancyReason;
  photoRecorded: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="This pickup is paused"
        description="Couranr has your report."
        actions={<Badge tone="warning">Under Couranr review</Badge>}
      />
      <Stack gap={3}>
        <Alert tone="warning" title="Reported to Couranr Operations">
          Couranr is reviewing this. You cannot complete pickup until Operations clears it.
        </Alert>

        <Stack gap={1}>
          <Text size="xs" muted>
            What you reported
          </Text>
          <Text strong>{DISCREPANCY_REASON_LABELS[reason]}</Text>
        </Stack>

        <Cluster gap={2}>
          {photoRecorded ? (
            <Badge tone="success">Photo recorded</Badge>
          ) : (
            <Badge tone="neutral">No photo recorded</Badge>
          )}
        </Cluster>

        <Text size="sm" muted>
          Only Couranr Operations can clear this. Contact Couranr Operations if the shipment cannot
          wait where it is.
        </Text>
      </Stack>
    </Card>
  );
}
