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
import { Field, Input, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchDispatchPanel } from "./client";
import {
  canUnassignBeforePickup,
  isDiscrepancyReason,
  isFulfillmentState,
  DISCREPANCY_REASON_LABELS,
  FULFILLMENT_LABELS,
  type FulfillmentState,
} from "@/lib/couranr/driver/states";
import {
  fetchMerchantProof,
  fetchOperationsProofUrl,
  resolveDiscrepancySafeToContinue,
  unassignBeforePickup,
  type ProofMetadataView,
} from "./client";
import { DeliveryExecutionTimeline, type ExecutionEvent } from "./DeliveryExecutionTimeline";
import { HandoffCodePanel } from "./HandoffCodePanel";
import { formatProofWhen, proofStageLabel, proofTypeLabel } from "./MerchantProofPanel";

/**
 * OPS-003 — the execution half of the delivery workspace.
 *
 * Everything Couranr Operations may do to a delivery that is already assigned,
 * and nothing else. There is no state selector, no "advance this delivery" and
 * no proof-method control: each transition belongs to the actor who performs it
 * — the driver's commands are the driver's, and a screen that let an operator
 * stand in for them would produce an audit trail that names the wrong person.
 *
 * The three Operations actions here are narrow on purpose:
 *   - unassign BEFORE pickup, with a mandatory reason;
 *   - clear a reported pickup issue as safe to continue;
 *   - open proof media under a short-lived signed URL.
 *
 * Each is refused by SQL as well as by this screen. The panel avoids inviting a
 * 409; the database is what actually decides.
 */

/**
 * The open pickup issue, supplied by the caller.
 *
 * A PROP RATHER THAN A FETCH, because no read endpoint returns a discrepancy —
 * `couranr_pickup_discrepancies` is written by two commands and read by neither
 * route. Clearing one needs its id AND its current version, and inventing a
 * version to make a button work is exactly the kind of confident guess this
 * codebase has already paid for. Without this prop the blocker is still shown
 * (see `derivedBlockerOpen`); only the action is withheld.
 */
export type OpenPickupDiscrepancy = {
  discrepancyId: string;
  /** The row's current version. The command refuses on a mismatch. */
  version: number;
  /** A `DISCREPANCY_REASONS` value. Anything else is rendered verbatim. */
  reason?: string;
  reportedAt?: string;
};

const MAX_REASON = 200;
const MAX_NOTE = 1000;

export function OperationsExecutionPanel({
  deliveryId,
  fulfillmentState,
  deliveryVersion: deliveryVersionProp,
  events,
  discrepancy,
  onChanged,
}: {
  deliveryId: string;
  fulfillmentState: string;
  /**
   * Optional, and normally omitted. Unassignment is an optimistic-concurrency
   * write, so the version it compares against must be the CURRENT one — a
   * value threaded down from a parent that loaded a minute ago is exactly the
   * stale input that check exists to catch. When absent the panel reads the
   * live version itself.
   */
  deliveryVersion?: number;
  events?: ExecutionEvent[];
  discrepancy?: OpenPickupDiscrepancy | null;
  onChanged?: () => void;
}) {
  /*
   * The live delivery version. `fetchDispatchPanel` already returns it, so
   * this costs the read the panel would make anyway and removes the chance of
   * unassigning against a version the operator's screen has outgrown.
   */
  const [liveVersion, setLiveVersion] = React.useState<number | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void fetchDispatchPanel(deliveryId).then((r) => {
      if (cancelled || isApiFailure(r)) return;
      const v = r.value.delivery?.version;
      if (typeof v === "number") setLiveVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId]);
  const deliveryVersion = liveVersion ?? deliveryVersionProp ?? 0;

  const eventList = Array.isArray(events) ? events : [];
  const known = isFulfillmentState(fulfillmentState);
  const state: FulfillmentState | null = known ? (fulfillmentState as FulfillmentState) : null;

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Delivery execution"
          description="Where this delivery has actually got to, from what Couranr recorded."
          actions={
            state ? (
              <Badge tone="info">{FULFILLMENT_LABELS[state]}</Badge>
            ) : (
              <Badge tone="warning">Unrecognised state</Badge>
            )
          }
        />
        <DeliveryExecutionTimeline current={fulfillmentState} events={eventList} />
      </Card>

      <DiscrepancyBlocker
        discrepancy={discrepancy ?? null}
        events={eventList}
        onResolved={onChanged}
      />

      {/*
        Both codes are issued from here because Operations covers for a merchant
        who cannot — a recipient who never received their code, a driver at a
        counter where nobody knows what a PIN is. They stay two separate panels
        with two separate warnings: a single "issue codes" control is how the
        driver ends up holding the recipient's credential.
      */}
      <HandoffCodePanel deliveryId={deliveryId} kind="merchant_pickup" surface="operations" />
      <HandoffCodePanel deliveryId={deliveryId} kind="recipient_dropoff" surface="operations" />

      <UnassignBeforePickup
        deliveryId={deliveryId}
        state={state}
        deliveryVersion={deliveryVersion}
        onUnassigned={onChanged}
      />

      <OperationsProofPanel deliveryId={deliveryId} />
    </Stack>
  );
}

/* ------------------------------------------------------------- blocker -- */

/**
 * Whether the recorded events leave a pickup issue open.
 *
 * Used only to DISPLAY the blocker when the caller passed no identified issue.
 * An event carries no version, so it can never enable the clearing action —
 * showing a button that would 409 is worse than showing none.
 */
function derivedBlockerOpen(events: readonly ExecutionEvent[]): boolean {
  let open = false;
  for (const e of events) {
    if (e?.command === "report_pickup_discrepancy") open = true;
    else if (e?.command === "resolve_pickup_discrepancy_safe_to_continue") open = false;
  }
  return open;
}

function DiscrepancyBlocker({
  discrepancy,
  events,
  onResolved,
}: {
  discrepancy: OpenPickupDiscrepancy | null;
  events: readonly ExecutionEvent[];
  onResolved?: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cleared, setCleared] = React.useState(false);

  const derived = derivedBlockerOpen(events);
  if (!discrepancy && !derived) return null;

  async function clearIssue() {
    if (!discrepancy || busy) return;
    setBusy(true);
    setError(null);
    const r = await resolveDiscrepancySafeToContinue(discrepancy.discrepancyId, {
      expectedVersion: discrepancy.version,
      note: note.trim() === "" ? undefined : note.trim(),
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setConfirming(false);
    setCleared(true);
    onResolved?.();
  }

  if (cleared) {
    return (
      <Card>
        <CardHeader title="Pickup issue" actions={<Badge tone="success">Cleared</Badge>} />
        <Alert tone="success" title="Cleared as safe to continue">
          The driver can complete this pickup. Couranr recorded who cleared it and when.
        </Alert>
      </Card>
    );
  }

  const reasonLabel =
    discrepancy?.reason && isDiscrepancyReason(discrepancy.reason)
      ? DISCREPANCY_REASON_LABELS[discrepancy.reason]
      : discrepancy?.reason
        ? String(discrepancy.reason).replace(/_/g, " ")
        : null;

  return (
    <Card>
      <CardHeader
        title="Pickup issue"
        description="The driver stopped and reported a problem with the shipment."
        actions={<Badge tone="danger">Pickup blocked</Badge>}
      />

      <Stack gap={4}>
        <Alert tone="danger" title="This pickup cannot be completed">
          Couranr will not let the driver complete this pickup while the issue is open. They are
          waiting on Couranr Operations, not on the sender.
        </Alert>

        {reasonLabel ? (
          <Stack gap={1}>
            <Text size="xs" muted>
              What the driver reported
            </Text>
            <Text strong>{reasonLabel}</Text>
            {discrepancy?.reportedAt ? (
              <Text size="xs" muted>
                Reported {formatProofWhen(discrepancy.reportedAt)}
              </Text>
            ) : null}
          </Stack>
        ) : null}

        {error ? (
          <Alert tone="danger" title="That issue was not cleared">
            {error}
          </Alert>
        ) : null}

        {!discrepancy ? (
          // The events say an issue is open but the caller passed no identified
          // one, so there is nothing to clear against. Saying so beats a button
          // that cannot work.
          <Alert tone="warning" title="Open this delivery's issue record to clear it">
            Couranr recorded an open pickup issue for this delivery. Clearing it needs the issue
            record itself, which this panel was not given.
          </Alert>
        ) : confirming ? (
          <Stack gap={3}>
            <Alert tone="warning" title="Clear this as safe to continue?">
              This tells the driver the shipment is safe to carry as it is. It does not change the
              price, the vehicle or the schedule, and it cannot be undone.
            </Alert>
            <Cluster gap={3}>
              <Button
                variant="destructive"
                loading={busy}
                loadingLabel="Clearing…"
                onClick={() => void clearIssue()}
              >
                Clear as safe to continue
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Keep it blocked
              </Button>
            </Cluster>
          </Stack>
        ) : (
          <Stack gap={3}>
            <Field
              label="Note for the record"
              hint={`What you checked, and with whom. ${Math.max(0, MAX_NOTE - note.length)} characters left.`}
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={3}
                  maxLength={MAX_NOTE}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                />
              )}
            </Field>
            <Cluster gap={3}>
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Clear as safe to continue
              </Button>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/* ------------------------------------------------------------ unassign -- */

function UnassignBeforePickup({
  deliveryId,
  state,
  deliveryVersion,
  onUnassigned,
}: {
  deliveryId: string;
  state: FulfillmentState | null;
  deliveryVersion: number;
  onUnassigned?: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // The window closes at `at_pickup`: from the moment the driver is standing at
  // the sender, what is being decided is custody rather than the schedule. The
  // SQL enforces it too — this only avoids offering a control that would fail.
  const allowed = state !== null && canUnassignBeforePickup(state);

  async function submit() {
    if (busy || reason.trim() === "") return;
    setBusy(true);
    setError(null);
    const r = await unassignBeforePickup(deliveryId, {
      expectedVersion: deliveryVersion,
      reason: reason.trim(),
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setDone(true);
    setReason("");
    onUnassigned?.();
  }

  return (
    <Card>
      <CardHeader
        title="Take this off the driver"
        description="Before pickup only. The delivery returns to the queue for a new assignment."
        actions={allowed ? <Badge tone="warning">Available</Badge> : <Badge tone="neutral">Closed</Badge>}
      />

      <Stack gap={4}>
        {done ? (
          <Alert tone="success" title="Unassigned">
            This delivery is back in the queue and needs a driver. Reload the workspace to assign one.
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="danger" title="That was not completed">
            {error}
          </Alert>
        ) : null}

        {!allowed ? (
          <Text size="sm" muted>
            {state === null
              ? "Couranr does not recognise this delivery's state, so this action is not offered."
              : `This delivery is ${FULFILLMENT_LABELS[state].toLowerCase()}. A driver can only be taken off before they reach the sender.`}
          </Text>
        ) : done ? null : (
          <Stack gap={3}>
            <Field
              label="Why is this being taken off the driver?"
              required
              hint={`Recorded against the delivery. ${Math.max(0, MAX_REASON - reason.length)} characters left.`}
            >
              {(a) => (
                <Input
                  {...a}
                  value={reason}
                  maxLength={MAX_REASON}
                  onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
                />
              )}
            </Field>
            <Cluster gap={3}>
              <Button
                variant="destructive"
                loading={busy}
                loadingLabel="Unassigning…"
                // Mandatory, not merely encouraged: this silently removes work
                // from someone who was counting on it, and an unassignment with
                // no recorded reason is unreviewable a week later.
                disabled={reason.trim() === ""}
                onClick={() => void submit()}
              >
                Unassign this delivery
              </Button>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/* --------------------------------------------------------------- proof -- */

function OperationsProofPanel({ deliveryId }: { deliveryId: string }) {
  const [proof, setProof] = React.useState<ProofMetadataView[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const [mediaError, setMediaError] = React.useState<string | null>(null);
  /** Seconds only — the URL itself is used and dropped inside the handler. */
  const [expirySeconds, setExpirySeconds] = React.useState<number | null>(null);
  /** Guards against an older read landing after a newer one — see below. */
  const latestRead = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++latestRead.current;
    setLoading(true);
    // The metadata list has one reader for both audiences: that route resolves
    // an Operations caller as `operations` before it looks for a membership, so
    // Operations gets the same list without a second endpoint. The MEDIA is
    // where the audiences differ, and that is a separate, Operations-only call.
    const r = await fetchMerchantProof(deliveryId);
    // A second load supersedes this one; a slow first response must not
    // overwrite a newer list.
    if (mine !== latestRead.current) return;
    setLoading(false);
    if (isApiFailure(r)) {
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

  /**
   * Opens the image and keeps nothing.
   *
   * The signed URL is a bearer capability for the object: anyone holding it can
   * read the photo until it expires. So it is never put in state, never written
   * to the DOM as an href, never logged and never passed to a parent — it exists
   * for the length of this function and then only inside the browser's tab.
   */
  async function openMedia(proofId: string) {
    if (openingId) return;
    setOpeningId(proofId);
    setMediaError(null);
    setExpirySeconds(null);
    const r = await fetchOperationsProofUrl(proofId);
    setOpeningId(null);
    if (isApiFailure(r)) {
      setMediaError(withReference(r));
      return;
    }
    // A 200 that carries no URL is not a link. `window.open(undefined)` opens a
    // blank tab, which reads as "the photo is missing" rather than "this did not
    // work" — the harness produced exactly that from a mis-shaped response.
    if (typeof r.value.url !== "string" || r.value.url === "") {
      setMediaError("Couranr did not return a link for that image. Try again.");
      return;
    }
    // `noopener` in the feature string would make window.open return null per
    // the HTML standard, which is indistinguishable from a blocked pop-up — so
    // the opener is severed on the handle instead and null means blocked.
    const opened = window.open(r.value.url, "_blank");
    if (!opened) {
      setMediaError(
        "Your browser blocked the new tab. Allow pop-ups for this page, then open the image again."
      );
      return;
    }
    try {
      // Best-effort reverse-tabnabbing defence. The image is served from another
      // origin, so this crosses an origin boundary; if a browser refuses it the
      // tab is already open and failing here would be worse than not severing.
      opened.opener = null;
    } catch {
      /* the tab is open either way */
    }
    setExpirySeconds(r.value.expiresInSeconds);
  }

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
        description="Operations can open the images. Every link is short-lived and is not saved."
        actions={
          items.length > 0 ? (
            <Badge tone="success">{items.length === 1 ? "1 record" : `${items.length} records`}</Badge>
          ) : null
        }
      />

      <Stack gap={4}>
        {mediaError ? (
          <Alert tone="danger" title="That image did not open">
            {mediaError}
          </Alert>
        ) : null}

        {expirySeconds !== null ? (
          <Text size="xs" muted role="status">
            That link works for about {describeSeconds(expirySeconds)} and Couranr does not keep it.
            Open the image again if it expires.
          </Text>
        ) : null}

        {items.length === 0 ? (
          <Text size="sm" muted>
            Nothing recorded for this delivery yet. Couranr read this successfully — proof is
            recorded as the driver completes pickup and delivery.
          </Text>
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
                <Cluster gap={2} justify="between">
                  <Stack gap={1}>
                    <Cluster gap={2}>
                      <Text as="span" strong>
                        {proofTypeLabel(p.proofType)}
                      </Text>
                      <Badge tone="neutral">{proofStageLabel(p.proofStage)}</Badge>
                      {p.hasMedia ? (
                        <Badge tone="info">Image attached</Badge>
                      ) : (
                        <Badge tone="neutral">No image</Badge>
                      )}
                    </Cluster>
                    <Text size="xs" muted>
                      Recorded {formatProofWhen(p.finalizedAt)}
                    </Text>
                  </Stack>

                  {p.hasMedia ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={openingId === p.proofId}
                      loadingLabel="Opening…"
                      onClick={() => void openMedia(p.proofId)}
                    >
                      Open image in a new tab
                    </Button>
                  ) : null}
                </Cluster>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/** The TTL is chosen server-side by viewer role; this only reads it back. */
function describeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}
