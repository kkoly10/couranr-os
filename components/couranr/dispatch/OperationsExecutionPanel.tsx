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
import { Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchDispatchPanel } from "./client";
import {
  canUnassignBeforePickup,
  isDiscrepancyReason,
  isFulfillmentState,
  DISCREPANCY_REASON_LABELS,
  DROPOFF_EXCEPTION_REASON_LABELS,
  FULFILLMENT_LABELS,
  type FulfillmentState,
} from "@/lib/couranr/driver/states";
import {
  fetchMerchantProof,
  fetchOperationsProofUrl,
  fetchReturnCustody,
  requireReturnFromBrowser,
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
 * The open issue, supplied by the caller OR read from the panel endpoint.
 *
 * This began as a prop-only shape because no read endpoint returned a
 * discrepancy — `couranr_pickup_discrepancies` was written by two commands and
 * read by no route, which made the Operations safe-to-continue route
 * unreachable from any browser. `getDispatchPanel` now returns the open row
 * (id, version, reason, stage, note, timestamps), and this panel reads it from
 * the same fetch it already makes for the live delivery version. A caller-
 * supplied prop still wins, so existing wiring keeps its meaning.
 */
export type OpenPickupDiscrepancy = {
  discrepancyId: string;
  /** The row's current version. The command refuses on a mismatch. */
  version: number;
  /** A `DISCREPANCY_REASONS` value. Anything else is rendered verbatim. */
  reason?: string;
  /** 'pickup' (blocks complete_pickup while open) or 'dropoff' (§31 evidence). */
  stage?: string;
  /** The driver's own words, shown to Operations verbatim. */
  note?: string | null;
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
   * The live delivery version, the OPEN issue and the delivery's own event
   * history. `fetchDispatchPanel` already returns all three, so this costs
   * the read the panel would make anyway — and it is what finally makes the
   * safe-to-continue command reachable: clearing an issue needs the row's id
   * AND current version, which no browser could previously obtain.
   */
  const [liveVersion, setLiveVersion] = React.useState<number | null>(null);
  const [fetchedDiscrepancy, setFetchedDiscrepancy] =
    React.useState<OpenPickupDiscrepancy | null>(null);
  const [fetchedEvents, setFetchedEvents] = React.useState<ExecutionEvent[] | null>(null);
  const [panelGeneration, setPanelGeneration] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    void fetchDispatchPanel(deliveryId).then((r) => {
      if (cancelled || isApiFailure(r)) return;
      const v = r.value.delivery?.version;
      if (typeof v === "number") setLiveVersion(v);
      // The panel endpoint's two evidence fields. DispatchPanelView is owned
      // by the client module; until its type gains them the shape is read
      // through a local view of the same JSON.
      const extra = r.value as typeof r.value & {
        openDiscrepancy?: {
          id: string;
          version: number;
          reason: string;
          stage: string;
          note: string | null;
          reportedAt: string | null;
        } | null;
        deliveryEvents?: PanelDeliveryEvent[];
      };
      setFetchedDiscrepancy(
        extra.openDiscrepancy
          ? {
              discrepancyId: extra.openDiscrepancy.id,
              version: extra.openDiscrepancy.version,
              reason: extra.openDiscrepancy.reason,
              stage: extra.openDiscrepancy.stage,
              note: extra.openDiscrepancy.note,
              reportedAt: extra.openDiscrepancy.reportedAt ?? undefined,
            }
          : null
      );
      setFetchedEvents(Array.isArray(extra.deliveryEvents) ? extra.deliveryEvents : []);
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId, panelGeneration]);
  const deliveryVersion = liveVersion ?? deliveryVersionProp ?? 0;

  // A caller-supplied prop wins; the panel's own read fills the gap that made
  // safe-to-continue unreachable.
  const effectiveDiscrepancy = discrepancy ?? fetchedDiscrepancy;
  const eventList: ExecutionEvent[] =
    Array.isArray(events) && events.length > 0 ? events : fetchedEvents ?? [];
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
        <WaitingEvidence events={eventList} fulfillmentState={fulfillmentState} />
      </Card>

      <DiscrepancyBlocker
        discrepancy={effectiveDiscrepancy ?? null}
        events={eventList}
        onResolved={() => {
          // Re-read the panel so the cleared issue and its event show without
          // a manual reload, then let the parent refresh its own reads.
          setPanelGeneration((g) => g + 1);
          onChanged?.();
        }}
      />

      <ReturnCustodyDecision
        deliveryId={deliveryId}
        state={state}
        deliveryVersion={deliveryVersion}
        discrepancy={effectiveDiscrepancy ?? null}
        onChanged={() => {
          setPanelGeneration((g) => g + 1);
          onChanged?.();
        }}
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
      {state === "return_required" || state === "returning" ? (
        <HandoffCodePanel deliveryId={deliveryId} kind="merchant_return" surface="operations" />
      ) : null}

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

/* ---------------------------------------------------- waiting evidence -- */

/** A delivery event as the panel endpoint returns it. */
type PanelDeliveryEvent = ExecutionEvent & {
  id?: string;
  from_state?: string | null;
  to_state?: string | null;
  metadata?: Record<string, unknown>;
};

const DROPOFF_COMPLETIONS = [
  "complete_direct_handoff_delivery",
  "complete_photo_or_pin_delivery",
  "complete_signature_delivery",
  "complete_leave_at_door_delivery",
] as const;

type WaitingSpan = {
  label: string;
  arrivedAt: string;
  endedAt: string | null;
  minutes: number | null;
  ongoing: boolean;
};

/**
 * Arrival -> completion gaps, derived from RECORDED events only.
 *
 * SUR-003: waiting time is governed-authority-only — Couranr records the
 * evidence and a human reviews it; nothing on any screen assesses a charge.
 * That is why this returns timestamps and a gap, never a figure of money.
 */
function deriveWaitingSpans(
  events: readonly ExecutionEvent[],
  fulfillmentState: string
): WaitingSpan[] {
  const list = events.filter((e) => e && typeof e.created_at === "string");
  const spans: WaitingSpan[] = [];

  const build = (
    label: string,
    arriveCommand: string,
    endCommands: readonly string[],
    ongoingState: string
  ) => {
    const arrivals = list.filter((e) => e.command === arriveCommand);
    const arrived = arrivals[arrivals.length - 1];
    if (!arrived) return;
    const ended =
      list.find(
        (e) => endCommands.includes(e.command) && e.created_at >= arrived.created_at
      ) ?? null;
    const start = new Date(arrived.created_at).getTime();
    const end = ended ? new Date(ended.created_at).getTime() : Date.now();
    const valid = Number.isFinite(start) && Number.isFinite(end) && end >= start;
    spans.push({
      label,
      arrivedAt: arrived.created_at,
      endedAt: ended?.created_at ?? null,
      minutes: valid ? Math.round((end - start) / 60000) : null,
      ongoing: !ended && fulfillmentState === ongoingState,
    });
  };

  build("Pickup", "arrive_at_pickup", ["complete_pickup"], "at_pickup");
  build("Drop-off", "arrive_at_dropoff", DROPOFF_COMPLETIONS, "at_dropoff");
  return spans;
}

function WaitingEvidence({
  events,
  fulfillmentState,
}: {
  events: readonly ExecutionEvent[];
  fulfillmentState: string;
}) {
  const spans = deriveWaitingSpans(events, fulfillmentState);
  if (spans.length === 0) return null;
  return (
    <Stack gap={1}>
      <Text size="sm" strong>
        Arrival and waiting evidence
      </Text>
      {spans.map((s) => (
        <Text key={s.label} size="xs" muted>
          {s.label}: arrived {formatProofWhen(s.arrivedAt)}
          {s.endedAt
            ? ` — completed ${formatProofWhen(s.endedAt)}${
                s.minutes !== null ? ` (${s.minutes} min on site)` : ""
              }`
            : s.ongoing
              ? s.minutes !== null
                ? ` — still on site (${s.minutes} min so far)`
                : " — still on site"
              : " — completion not recorded"}
        </Text>
      ))}
      {/* SUR-003: governed authority only. Evidence, never a charge. */}
      <Text size="xs" muted>
        Recorded as evidence for Couranr review only. No waiting charge is assessed from this
        display.
      </Text>
    </Stack>
  );
}


/* ------------------------------------------------------- return custody -- */

const RETURN_REASON_OPTIONS = [
  ["recipient_unavailable", "Recipient unavailable"],
  ["address_or_access_problem", "Address or access problem"],
  ["weather_or_safety", "Weather or conditions are unsafe"],
  ["damage_or_condition", "Damage or condition concern"],
  ["customer_request", "Customer requested return"],
  ["merchant_request", "Sender requested return"],
  ["couranr_caused", "Couranr caused the corrective return — payer owes $0"],
  ["other", "Other governed return reason"],
] as const;

function ReturnCustodyDecision({
  deliveryId,
  state,
  deliveryVersion,
  discrepancy,
  onChanged,
}: {
  deliveryId: string;
  state: FulfillmentState | null;
  deliveryVersion: number;
  discrepancy: OpenPickupDiscrepancy | null;
  onChanged?: () => void;
}) {
  const [existing, setExisting] = React.useState<{
    return_state: "required" | "returning" | "returned";
    reason: string;
    pricing_status: "couranr_covered" | "pending_route_quote" | "pending_current_location";
    payer_responsibility: "couranr" | "payer";
    payer_owes_cents: number | null;
  } | null>(null);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void fetchReturnCustody(deliveryId).then((r) => {
      if (!live || isApiFailure(r)) return;
      setExisting(r.value.return);
    });
    return () => { live = false; };
  }, [deliveryId]);

  React.useEffect(() => {
    if (reason || discrepancy?.stage !== "dropoff") return;
    const suggested =
      discrepancy.reason === "recipient_unavailable" ||
      discrepancy.reason === "address_or_access_problem" ||
      discrepancy.reason === "weather_or_safety"
        ? discrepancy.reason
        : discrepancy.reason === "visible_damage" || discrepancy.reason === "unsafe_packaging"
          ? "damage_or_condition"
          : "other";
    setReason(suggested);
  }, [discrepancy, reason]);

  if (existing) {
    return (
      <Card>
        <CardHeader
          title="Return custody"
          description="This return is a separate physical custody path."
          actions={
            <Badge tone={existing.return_state === "returned" ? "success" : "warning"}>
              {existing.return_state === "required"
                ? "Return required"
                : existing.return_state === "returning"
                  ? "Returning"
                  : "Returned"}
            </Badge>
          }
        />
        <Stack gap={2}>
          <Text size="sm">
            Reason: {RETURN_REASON_OPTIONS.find(([value]) => value === existing.reason)?.[1] ??
              existing.reason.replace(/_/g, " ")}
          </Text>
          {existing.pricing_status === "couranr_covered" ? (
            <Alert tone="info" title="Couranr-covered corrective return">
              REF-003 pins the payer amount to $0 for a Couranr-caused return.
            </Alert>
          ) : (
            <Alert tone="warning" title="Return price is not assessed yet">
              REF-003 requires a new Pricing V2 physical route. Couranr has not called a route
              provider or charged the payer from this custody decision. The retired 70% / $14.99
              formula is not used.
            </Alert>
          )}
        </Stack>
      </Card>
    );
  }

  const custodyState =
    state === "picked_up" || state === "in_transit" || state === "at_dropoff";
  const hasDropoffEvidence = discrepancy?.stage === "dropoff";
  if (!custodyState || !hasDropoffEvidence) return null;

  async function submit() {
    if (busy || !reason || deliveryVersion < 1) return;
    setBusy(true);
    setError(null);
    const r = await requireReturnFromBrowser(deliveryId, {
      expectedVersion: deliveryVersion,
      reason,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setExisting(r.value.return);
    setConfirming(false);
    onChanged?.();
  }

  return (
    <Card>
      <CardHeader
        title="Return custody"
        description="Use this only when the shipment must physically go back to the original sender."
        actions={<Badge tone="warning">Operations decision</Badge>}
      />
      <Stack gap={4}>
        <Alert tone="warning" title="This keeps driver custody active">
          Requiring a return does not close the assignment and does not move money. The driver
          remains responsible for the shipment until the sender return code and one condition
          photo are server-verified.
        </Alert>

        <Field label="Why is a physical return required?" required>
          {(a) => (
            <Select {...a} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {RETURN_REASON_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Operations note"
          hint="Optional internal context. Do not paste payment credentials or private card data."
        >
          {(a) => (
            <Textarea
              {...a}
              value={note}
              maxLength={2000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>

        {reason === "couranr_caused" ? (
          <Alert tone="info" title="Payer owes $0 for the return">
            The database derives this from the governed reason. No amount is sent from this screen.
          </Alert>
        ) : (
          <Alert tone="info" title="Pricing remains separate">
            This creates custody and an incident only. A non-Couranr return still needs its new
            Pricing V2 route; this action does not call Mapbox or charge anyone.
          </Alert>
        )}

        {error ? <Alert tone="danger" title="Return was not required">{error}</Alert> : null}

        {confirming ? (
          <Stack gap={3}>
            <Alert tone="warning" title="Require this physical return?">
              The driver will be routed back to the original pickup address and cannot close the
              delivery as delivered. Continue only after reviewing the driver&rsquo;s recorded issue.
            </Alert>
            <Cluster gap={3}>
              <Button
                variant="destructive"
                disabled={!reason}
                loading={busy}
                loadingLabel="Requiring return…"
                onClick={() => void submit()}
              >
                Require return to sender
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Keep current custody state
              </Button>
            </Cluster>
          </Stack>
        ) : (
          <Button variant="secondary" disabled={!reason} onClick={() => setConfirming(true)}>
            Review return decision
          </Button>
        )}
      </Stack>
    </Card>
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
    if (e?.command === "report_pickup_discrepancy" || e?.command === "report_dropoff_exception") {
      open = true;
    } else if (e?.command === "resolve_pickup_discrepancy_safe_to_continue") {
      open = false;
    }
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

  // The §31 drop-off exception uses the SAME row and the SAME clearing
  // command, but it is EVIDENCE, not a completion gate: nothing blocks the
  // driver's completion rules while it is open, so the copy must not claim a
  // block that does not exist.
  const isDropoff = discrepancy?.stage === "dropoff";
  const issueTitle = isDropoff ? "Drop-off issue" : "Pickup issue";

  if (cleared) {
    return (
      <Card>
        <CardHeader title={issueTitle} actions={<Badge tone="success">Cleared</Badge>} />
        <Alert tone="success" title="Cleared as safe to continue">
          {isDropoff
            ? "Couranr recorded who reviewed this drop-off issue and when."
            : "The driver can complete this pickup. Couranr recorded who cleared it and when."}
        </Alert>
      </Card>
    );
  }

  const reasonLabel =
    discrepancy?.reason && isDiscrepancyReason(discrepancy.reason)
      ? DISCREPANCY_REASON_LABELS[discrepancy.reason]
      : discrepancy?.reason
        ? DROPOFF_EXCEPTION_REASON_LABELS[discrepancy.reason] ??
          String(discrepancy.reason).replace(/_/g, " ")
        : null;

  return (
    <Card>
      <CardHeader
        title={issueTitle}
        description={
          isDropoff
            ? "The driver reported a problem while out with the shipment."
            : "The driver stopped and reported a problem with the shipment."
        }
        actions={
          isDropoff ? (
            <Badge tone="warning">Needs review</Badge>
          ) : (
            <Badge tone="danger">Pickup blocked</Badge>
          )
        }
      />

      <Stack gap={4}>
        {isDropoff ? (
          <Alert tone="warning" title="Recorded at drop-off — needs Couranr review">
            The driver recorded this problem after pickup. It does not change the delivery&rsquo;s
            state, price or completion rules; it is evidence for Couranr Operations to act on.
          </Alert>
        ) : (
          <Alert tone="danger" title="This pickup cannot be completed">
            Couranr will not let the driver complete this pickup while the issue is open. They are
            waiting on Couranr Operations, not on the sender.
          </Alert>
        )}

        {reasonLabel ? (
          <Stack gap={1}>
            <Text size="xs" muted>
              What the driver reported
            </Text>
            <Text strong>{reasonLabel}</Text>
            {discrepancy?.note ? <Text size="sm">&ldquo;{discrepancy.note}&rdquo;</Text> : null}
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
              {isDropoff
                ? "This records that Couranr Operations reviewed the driver's report. It does not change the price, the schedule or the completion rules, and it cannot be undone."
                : "This tells the driver the shipment is safe to carry as it is. It does not change the price, the vehicle or the schedule, and it cannot be undone."}
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
