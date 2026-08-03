"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { VEHICLE_CLASS_LABELS } from "@/lib/couranr/dispatch/states";
import {
  DRIVER_COMMAND_LABELS,
  FULFILLMENT_LABELS,
  FULFILLMENT_ORDER,
  FULFILLMENT_STATES,
  FULFILLMENT_TONES,
  isDrivingState,
  PROOF_METHOD_LABELS,
  isFulfillmentState,
  isProofMethod,
  nextDriverCommand,
  type DriverCommand,
  type FulfillmentState,
} from "@/lib/couranr/driver/states";
import {
  arriveAtDropoff,
  arriveAtPickup,
  fetchMyAssignment,
  startRouteToDropoff,
  startRouteToPickup,
  type AssignedDeliveryView,
  type DeliveryAddressView,
  type DriverAssignmentResponse,
  type DriverCompletionReceipt,
} from "./client";
import { locationBody, useLocationCapture, type LocationState } from "./useLocationCapture";
import { DrivingMode } from "./DrivingMode";
import { DropoffProof } from "./DropoffProof";
import { LocationBlock, PickupFlow, readDeliveryVersion } from "./PickupFlow";

/**
 * DRV-002 — the assigned delivery, as the driver sees it.
 *
 * Renders ONLY what the sanitized projection carries. There is no second fetch
 * that could widen it: money, tenant and audit handles never leave the server,
 * so they cannot be displayed by accident even if someone adds a row to this
 * layout later.
 *
 * FOUR OUTCOMES, and the fourth is the one this repo has got wrong before. The
 * server answers with a three-way discriminated union — active, recently
 * completed, or nothing — and a FAILED request is none of them. A failure is
 * rendered as an alarming, retryable error with a support reference; "nothing
 * assigned" is a calm empty state. Collapsing the two is how a driver who had a
 * live delivery a second ago gets told they have no work.
 *
 * ONE ACTION, EVER. `nextDriverCommand` returns the single command the database
 * would accept from the current state, and only that one is offered. There is
 * no state selector, no proof-method selector and no way to reassign — a driver
 * cannot choose their own work, and a screen that offers two next actions
 * invites picking the wrong one while moving.
 */
export function AssignedDeliveryDetail({
  deliveryId,
  drivingMode = false,
}: {
  deliveryId?: string;
  /** DRV-005. A presentation mode only — it grants nothing and skips no check. */
  drivingMode?: boolean;
}) {
  const [response, setResponse] = React.useState<DriverAssignmentResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failure, setFailure] = React.useState<string | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  /**
   * The version a command last reported, TIED TO THE DELIVERY IT CAME FROM.
   *
   * It is the authority once a command has run in this session, because the
   * projection is refetched afterwards and (today) carries no version of its own
   * — see `readDeliveryVersion`. The delivery id travels with it because this
   * component is reused across `/driver/deliveries/<id>` navigations and by
   * DRV-001's id-less lookup: a bare number would let delivery A's version be
   * sent as delivery B's `expectedVersion`.
   */
  const [knownVersion, setKnownVersion] = React.useState<{
    deliveryId: string;
    version: number;
  } | null>(null);

  const location = useLocationCapture();

  /**
   * Guards against a stale response landing after a newer one.
   *
   * `load` is called from an effect AND from every command handler, so two
   * requests can be in flight at once; without this the slower one wins and the
   * screen shows the state the delivery was in before the command ran.
   */
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    const r = await fetchMyAssignment(deliveryId);
    if (mine !== generation.current) return;
    setLoading(false);
    if (isApiFailure(r)) {
      // Never rendered as "no assignment". Not knowing and having none are
      // different facts and the driver acts differently on each.
      setResponse(null);
      setFailure(withReference(r));
      return;
    }
    setFailure(null);
    setResponse(r.value);
  }, [deliveryId]);

  React.useEffect(() => {
    // A different delivery invalidates the version we were holding. Dropping it
    // fails closed — the action blocks with a visible reason — where keeping it
    // would send a confidently wrong number.
    setKnownVersion(null);
    void load();
  }, [load]);

  if (loading) {
    return (
      <LoadingState label="Loading your delivery">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  if (failure) {
    return (
      <ErrorState
        title="Couranr could not load your delivery"
        body={`This is not the same as having no work assigned — Couranr could not reach your assignment. ${failure}`}
        action={{
          label: "Try again",
          onClick: () => {
            setLoading(true);
            void load();
          },
        }}
      />
    );
  }

  if (!response) {
    // Defensive: a 200 with a body this screen cannot read is a failure, not an
    // absence of work.
    return (
      <ErrorState
        title="Couranr could not load your delivery"
        body="The response could not be read. Try again, and contact Couranr Support if it keeps happening."
        action={{
          label: "Try again",
          onClick: () => {
            setLoading(true);
            void load();
          },
        }}
      />
    );
  }

  switch (response.status) {
    case "recently_completed":
      return <CompletionReceiptCard receipt={response.receipt} />;

    case "none":
      return (
        <EmptyState
          title="No delivery assigned to you"
          body="Couranr assigns work — there is nothing to accept or claim. When a delivery is assigned to you it appears here."
        />
      );

    case "active":
      return (
        <ActiveAssignment
          assigned={response.assigned}
          drivingMode={drivingMode}
          location={location}
          busy={busy}
          setBusy={setBusy}
          actionError={actionError}
          setActionError={setActionError}
          knownVersion={knownVersion}
          setKnownVersion={setKnownVersion}
          reload={load}
        />
      );

    default: {
      // Exhaustiveness: a status the contract does not declare fails closed
      // rather than falling through to "no work".
      const unexpected: never = response;
      void unexpected;
      return (
        <ErrorState
          title="Couranr could not load your delivery"
          body="Couranr returned something this app does not understand. Contact Couranr Support."
        />
      );
    }
  }
}

/* ------------------------------------------------------------- the active -- */

function ActiveAssignment({
  assigned,
  drivingMode,
  location,
  busy,
  setBusy,
  actionError,
  setActionError,
  knownVersion,
  setKnownVersion,
  reload,
}: {
  assigned: AssignedDeliveryView;
  /** DRV-005. Presentation only — it grants nothing and skips no check. */
  drivingMode: boolean;
  location: LocationState;
  busy: boolean;
  setBusy: (v: boolean) => void;
  actionError: string | null;
  setActionError: (v: string | null) => void;
  knownVersion: { deliveryId: string; version: number } | null;
  setKnownVersion: (v: { deliveryId: string; version: number } | null) => void;
  reload: () => Promise<void>;
}) {
  const state = isFulfillmentState(assigned.fulfillmentState) ? assigned.fulfillmentState : null;
  const method = isProofMethod(assigned.proof.method) ? assigned.proof.method : null;

  // Both arguments are required rather than optional: omitting the proof method
  // would silently yield null at `at_dropoff` and render a dead end.
  const command = state && method ? nextDriverCommand(state, method) : null;
  const vehicle = assigned.assignment.vehicle;

  // A version is only reused for the delivery that produced it.
  const version =
    knownVersion && knownVersion.deliveryId === assigned.deliveryId
      ? knownVersion.version
      : readDeliveryVersion(assigned);

  async function run(which: "start_route_to_pickup" | "start_route_to_dropoff") {
    if (version === null) return;
    setBusy(true);
    setActionError(null);
    const r =
      which === "start_route_to_pickup"
        ? await startRouteToPickup(assigned.deliveryId, version)
        : await startRouteToDropoff(assigned.deliveryId, version);
    setBusy(false);
    if (isApiFailure(r)) {
      setActionError(withReference(r));
      return;
    }
    setKnownVersion({ deliveryId: assigned.deliveryId, version: r.value.delivery.version });
    await reload();
  }

  async function arrive(which: "arrive_at_pickup" | "arrive_at_dropoff") {
    if (version === null) return;
    // Throws rather than defaulting when there is no fix. `Number(null)` is 0,
    // and 0/0 is a real point in the Gulf of Guinea the null check would accept.
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setActionError(location.message);
      return;
    }
    setBusy(true);
    setActionError(null);
    const r =
      which === "arrive_at_pickup"
        ? await arriveAtPickup(assigned.deliveryId, version, fix)
        : await arriveAtDropoff(assigned.deliveryId, version, fix);
    setBusy(false);
    if (isApiFailure(r)) {
      setActionError(withReference(r));
      return;
    }
    setKnownVersion({ deliveryId: assigned.deliveryId, version: r.value.delivery.version });
    await reload();
  }

  /*
   * Driving Mode REPLACES the detail rather than sitting beside it. The point
   * is fewer things to read while moving, so rendering both would defeat it.
   *
   * Honoured only while the delivery is actually travelling: `?mode=driving`
   * on a stationary delivery falls through to the full detail rather than
   * hiding the controls the driver stopped in order to use.
   */
  if (drivingMode && state !== null && isDrivingState(state)) {
    return (
      <DrivingMode
        assigned={assigned}
        location={location}
        busy={busy}
        error={actionError}
        onArrive={() =>
          arrive(state === "en_route_to_pickup" ? "arrive_at_pickup" : "arrive_at_dropoff")
        }
      />
    );
  }

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Your delivery"
          description="Assigned by Couranr."
          actions={
            state ? (
              <Badge tone={FULFILLMENT_TONES[state]}>{FULFILLMENT_LABELS[state]}</Badge>
            ) : (
              <Badge tone="warning">State unrecognised</Badge>
            )
          }
        />
        <Stack gap={4}>
          <Alert tone="info" title="Scheduled pickup window">
            {formatWindow(assigned.scheduledPickupStart, assigned.scheduledPickupEnd)}
            {assigned.timezone ? ` (${assigned.timezone})` : ""}
          </Alert>
          {state ? <LifecycleTimeline current={state} /> : null}
        </Stack>
      </Card>

      {/*
        No Driving Mode surface here. DRV-005 owns it as its own component,
        reached at `/driver/deliveries/<id>?mode=driving`; a second reduced view
        on this screen would be a second place for the destination and the
        single action to disagree. This screen is the full detail, which is what
        a driver opens when they have stopped.
      */}

      <Grid columns={2}>
        <Card>
          <CardHeader title="Pickup" description="Collect from the business." />
          <Stack gap={3}>
            <AddressLines address={assigned.pickup} />
            <Contact label="Merchant contact" name={assigned.merchant.name} phone={assigned.merchant.phone} />
          </Stack>
        </Card>
        <Card>
          <CardHeader title="Drop-off" description="Hand off to the recipient." />
          <Stack gap={3}>
            <AddressLines address={assigned.dropoff} />
            <Contact label="Recipient" name={assigned.recipient.name} phone={assigned.recipient.phone} />
          </Stack>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Shipment" />
        <Grid columns={3}>
          <Detail
            label="Packages"
            value={assigned.shipment.packageCount != null ? assigned.shipment.packageCount : "Not recorded"}
          />
          <Detail
            label="Declared weight"
            value={
              assigned.shipment.declaredWeightLb != null
                ? `${assigned.shipment.declaredWeightLb} lb`
                : "Not recorded"
            }
          />
          <Detail
            label="Additional stops"
            value={assigned.shipment.additionalStops != null ? assigned.shipment.additionalStops : "None"}
          />
          <Detail label="Service level" value={assigned.serviceLevel || "—"} />
          <Detail
            label="Vehicle required"
            value={
              assigned.vehicleRequirement.vehicleClass
                ? VEHICLE_CLASS_LABELS[assigned.vehicleRequirement.vehicleClass] ??
                  assigned.vehicleRequirement.vehicleClass
                : "—"
            }
          />
          <Detail
            label="Capacity required"
            value={
              assigned.vehicleRequirement.maxPayloadLb != null
                ? `${assigned.vehicleRequirement.maxPayloadLb} lb`
                : "—"
            }
          />
        </Grid>
      </Card>

      <Card>
        <CardHeader
          title="Proof and vehicle"
          description="Couranr fixed the proof method when this delivery was created. It cannot be changed here or on the road."
        />
        <Grid columns={3}>
          {/* Never "photo or PIN": a photograph is not an alternative to the
              recipient PIN, and nothing driver-facing says it is. */}
          <Detail
            label="Proof method"
            value={method ? PROOF_METHOD_LABELS[method] : "Not recognised"}
          />
          <Detail
            label="Signature"
            value={assigned.proof.signatureRequired ? "Required" : "Not required"}
          />
          <Detail
            label="Assigned vehicle"
            value={
              vehicle
                ? `${vehicle.name} (${VEHICLE_CLASS_LABELS[vehicle.vehicleClass] ?? vehicle.vehicleClass})`
                : "Not recorded"
            }
          />
        </Grid>
      </Card>

      <NextAction
        assigned={assigned}
        state={state}
        command={command}
        version={version}
        location={location}
        busy={busy}
        actionError={actionError}
        onStart={run}
        onArrive={arrive}
        reload={reload}
      />
    </Stack>
  );
}

/* ------------------------------------------------------- the single action -- */

/**
 * The ONE legal next action for the current state.
 *
 * Nothing here renders a control for a future state. A disabled "Complete
 * handoff" button shown at `at_pickup` promises a capability that does not
 * exist yet and teaches the driver to press things that do nothing.
 */
function NextAction({
  assigned,
  state,
  command,
  version,
  location,
  busy,
  actionError,
  onStart,
  onArrive,
  reload,
}: {
  assigned: AssignedDeliveryView;
  state: FulfillmentState | null;
  command: DriverCommand | null;
  version: number | null;
  location: LocationState;
  busy: boolean;
  actionError: string | null;
  onStart: (c: "start_route_to_pickup" | "start_route_to_dropoff") => Promise<void>;
  onArrive: (c: "arrive_at_pickup" | "arrive_at_dropoff") => Promise<void>;
  reload: () => Promise<void>;
}) {
  if (!state) {
    return (
      <Card>
        <CardHeader title="Next step" />
        <Alert tone="warning" title="Couranr does not recognise this delivery's state">
          Contact Couranr Operations before doing anything with this shipment.
        </Alert>
      </Card>
    );
  }

  if (!command) {
    return (
      <Card>
        <CardHeader title="Next step" />
        <Alert tone="info" title="Nothing for you to do right now">
          {FULFILLMENT_LABELS[state]}. Couranr Operations will contact you if anything changes.
        </Alert>
      </Card>
    );
  }

  const versionBlocker =
    version === null
      ? "Couranr could not confirm this delivery's current version. Reload this page and try again."
      : null;

  switch (command) {
    case "complete_pickup":
      // The pickup is a form, not a button — DRV-003 owns every requirement.
      // Keyed on the delivery so a switch of assignment REMOUNTS it: a verified
      // pickup code and two finalized photos belong to one delivery and must
      // never carry over to the next one.
      return (
        <PickupFlow
          key={assigned.deliveryId}
          assigned={assigned}
          location={location}
          onCompleted={() => void reload()}
        />
      );

    case "start_route_to_pickup":
    case "start_route_to_dropoff": {
      const blockers = versionBlocker ? [versionBlocker] : [];
      return (
        <ActionCard blockers={blockers} error={actionError}>
          <Button
            variant="primary"
            loading={busy}
            disabled={blockers.length > 0}
            onClick={() => void onStart(command)}
          >
            {DRIVER_COMMAND_LABELS[command]}
          </Button>
        </ActionCard>
      );
    }

    case "arrive_at_pickup":
    case "arrive_at_dropoff": {
      // Arrival IS a location claim, so it is blocked outright without a usable
      // fix rather than being sent with nulls or a previous step's coordinates.
      const blockers: string[] = [];
      if (!location.usable) blockers.push(location.message);
      if (versionBlocker) blockers.push(versionBlocker);
      return (
        <Stack gap={4}>
          <LocationBlock location={location} />
          <ActionCard blockers={blockers} error={actionError}>
            <Button
              variant="primary"
              loading={busy}
              disabled={blockers.length > 0}
              onClick={() => void onArrive(command)}
            >
              {DRIVER_COMMAND_LABELS[command]}
            </Button>
          </ActionCard>
        </Stack>
      );
    }

    case "complete_direct_handoff_delivery":
    case "complete_signature_delivery":
    case "complete_leave_at_door_delivery":
      /*
       * The drop-off is a form too, and DRV-006 owns all three of its shapes.
       * It re-derives the command from the delivery's own immutable proof
       * method, so this screen hands over the delivery rather than a decision
       * about how to finish it — there is no method to pass and nothing here
       * could override one. Keyed for the same reason the pickup is: a verified
       * recipient code belongs to one delivery.
       */
      return (
        <DropoffProof
          key={assigned.deliveryId}
          assigned={assigned}
          location={location}
          onCompleted={() => void reload()}
        />
      );

    default: {
      const unexpected: never = command;
      void unexpected;
      return null;
    }
  }
}

function ActionCard({
  blockers,
  error,
  children,
}: {
  blockers: string[];
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title="Next step" description="This is the only step Couranr will accept now." />
      <Stack gap={3}>
        {blockers.length > 0 ? (
          // A fixed title rather than one built from the command label —
          // "before you can I have arrived at pickup" is what that produced.
          <Alert tone="warning" title="Still needed before this step">
            <ul className="cr-list">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="That step could not be completed">
            {error}
          </Alert>
        ) : null}
        <Cluster gap={3}>{children}</Cluster>
      </Stack>
    </Card>
  );
}

/* -------------------------------------------------------------- timeline --- */

/**
 * The happy path, in order. The two terminal exceptions share rank 7 with
 * `delivered`, so they are not listed alongside it — showing both would imply a
 * delivery had two outcomes.
 */
const MAINLINE: FulfillmentState[] = FULFILLMENT_STATES.filter(
  (s) => s !== "could_not_deliver" && s !== "cancelled"
).sort((a, b) => FULFILLMENT_ORDER[a] - FULFILLMENT_ORDER[b]);

function timelineStates(current: FulfillmentState): FulfillmentState[] {
  if (current === "could_not_deliver" || current === "cancelled") {
    return MAINLINE.filter((s) => s !== "delivered").concat(current);
  }
  return MAINLINE.slice();
}

function LifecycleTimeline({ current }: { current: FulfillmentState }) {
  const steps = timelineStates(current);
  const currentRank = FULFILLMENT_ORDER[current];

  return (
    <ol className="cr-stack cr-stack--2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s) => {
        const done = FULFILLMENT_ORDER[s] < currentRank;
        const isCurrent = s === current;
        return (
          <li
            key={s}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--couranr-space-3)",
            }}
          >
            {/*
              §7 forbids colour-only status meaning, so the glyph carries the
              shape cue and the visually-hidden text carries the words. The
              previous renderer painted every state green, which told anyone
              scanning that a delivery sitting at the door was finished.
            */}
            <span
              aria-hidden="true"
              style={{
                width: 20,
                textAlign: "center",
                color: done
                  ? "var(--couranr-success)"
                  : isCurrent
                    ? "var(--couranr-text)"
                    : "var(--couranr-text-muted)",
              }}
            >
              {done ? "✓" : isCurrent ? "●" : "○"}
            </span>
            <Text as="span" size="sm" strong={isCurrent} muted={!done && !isCurrent}>
              {FULFILLMENT_LABELS[s]}
            </Text>
            {isCurrent ? <Badge tone={FULFILLMENT_TONES[s]}>Now</Badge> : null}
            <span className="cr-visually-hidden">
              {done ? "Completed" : isCurrent ? "Current step" : "Not started"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- receipt --- */

/**
 * What survives completion. Six fields, and the absences are the point: no
 * address, no recipient contact, no merchant note, no money. A finished
 * delivery stops being readable rather than lingering on a success screen.
 */
function CompletionReceiptCard({ receipt }: { receipt: DriverCompletionReceipt }) {
  const method = isProofMethod(receipt.proofMethod) ? receipt.proofMethod : null;
  return (
    <Card>
      <CardHeader
        title="Delivery completed"
        description="Couranr has your proof. The delivery details are no longer shown."
        actions={<Badge tone="success">{FULFILLMENT_LABELS.delivered}</Badge>}
      />
      <Grid columns={3}>
        <Detail label="Delivered" value={formatMoment(receipt.deliveredAt)} />
        <Detail label="Proof method" value={method ? PROOF_METHOD_LABELS[method] : "Recorded"} />
        <Detail
          label="Pickup proof"
          value={receipt.pickupProofComplete ? "Complete" : "Incomplete"}
        />
        <Detail
          label="Drop-off proof"
          value={receipt.deliveryProofComplete ? "Complete" : "Incomplete"}
        />
      </Grid>
      <Text size="xs" muted>
        Contact Couranr Operations if anything about this delivery needs correcting.
      </Text>
    </Card>
  );
}

/* ----------------------------------------------------------------- parts --- */

function AddressLines({ address }: { address: DeliveryAddressView }) {
  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const locality = [address.city, address.region, address.postalCode].filter(Boolean).join(" ");
  return (
    <Stack gap={1}>
      {street ? <Text strong>{street}</Text> : null}
      {locality ? <Text size="sm">{locality}</Text> : null}
      {!street && !locality ? (
        <Text size="sm" muted>
          No address recorded. Contact Couranr Operations.
        </Text>
      ) : null}
      {address.instructions ? (
        <Text size="sm" muted>
          Instructions: {address.instructions}
        </Text>
      ) : null}
    </Stack>
  );
}

function Contact({ label, name, phone }: { label: string; name: string; phone: string }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text strong>{name || "Not recorded"}</Text>
      {phone ? (
        <Text size="sm">
          <a href={`tel:${phone}`}>{phone}</a>
        </Text>
      ) : (
        <Text size="sm" muted>
          No phone number recorded.
        </Text>
      )}
    </div>
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

/** A malformed timestamp renders as an honest dash, never "Invalid Date". */
function formatMoment(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatWindow(start: string, end: string): string {
  const from = formatMoment(start);
  const to = formatMoment(end);
  if (from === "—" && to === "—") return "Couranr has not recorded a pickup window.";
  return `Between ${from} and ${to}.`;
}
