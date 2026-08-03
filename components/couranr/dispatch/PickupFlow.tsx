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
import { CheckboxRow, Field, Input, Textarea } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  PIN_OUTCOME_MESSAGES,
  requiresLargeShipmentProof,
  type PinOutcome,
} from "@/lib/couranr/driver/states";
import { completePickup, fetchMyProof, verifyPickupCode, type AssignedDeliveryView } from "./client";
import { PickupDiscrepancy } from "./PickupDiscrepancy";
import { locationBody, type LocationState } from "./useLocationCapture";
import { useProofUpload, type ProofUploadState } from "./useProofUpload";

/**
 * DRV-003 — the pickup, as the driver performs it.
 *
 * This screen collects evidence; it does not decide anything. Every requirement
 * below is also asserted inside `couranr_complete_pickup`, so the button being
 * enabled is a courtesy and the database is the authority. What the screen adds
 * is that the driver can SEE which requirement is still missing before they
 * press anything — the alternative is a 409 at the loading dock with a message
 * they cannot act on.
 *
 * Three rules are load-bearing here and each has its own comment below:
 *   - a selected file is not proof, only `.finalized` is;
 *   - an empty package-count field stays empty, and 0 is a real answer;
 *   - nothing mutates without a usable location fix.
 */

const MAX_PIN_LENGTH = 6;
/** Matches `observed_package_count`'s integer column and the route's bound. */
const MAX_PACKAGES = 9999;

/** Tone per closed outcome. `locked` is the only one the driver cannot retry. */
const PIN_OUTCOME_TONE: Record<PinOutcome, "success" | "warning" | "danger"> = {
  accepted: "success",
  invalid: "warning",
  locked: "danger",
  expired: "warning",
};

/**
 * The delivery version the optimistic-concurrency check needs.
 *
 * The projection now copies `couranr_deliveries.version`, so this reads a
 * DECLARED field — but it still validates, because the value crosses the
 * network and a malformed one must not become an `expectedVersion`.
 *
 * FAILS CLOSED, and that is the whole point: `null` blocks the action with a
 * visible reason rather than sending a guess. Guessing 1 would let a driver
 * overwrite a delivery someone else had already moved, which is the exact thing
 * the version exists to prevent.
 *
 * This function was correct while the projection was not, and the result was a
 * surface that rendered perfectly and could not be used. A fail-closed read is
 * only safe when something actually supplies the value — see the projection's
 * `version` note.
 */
export function readDeliveryVersion(assigned: AssignedDeliveryView): number | null {
  const raw: unknown = assigned?.version;
  // The fallback is `null`, NEVER 1. A fabricated 1 matches a freshly created
  // delivery, so guessing would pass every test and silently clobber a live one
  // the driver never observed. `tests/couranr-dispatch.test.ts` pins this.
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/**
 * An empty field is ABSENT, not zero.
 *
 * `Number("")` is 0, so a bare coercion would record "I collected no packages"
 * as the driver's own observation on a form they never filled in. An explicit
 * "0" is a legitimate answer and stays submittable — that is a real
 * discrepancy the merchant needs to see, not a validation error.
 */
export function parsePackageCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PACKAGES ? n : null;
}

export function PickupFlow({
  assigned,
  location,
  onCompleted,
}: {
  assigned: AssignedDeliveryView;
  location: LocationState;
  onCompleted: () => void;
}) {
  const deliveryId = assigned.deliveryId;
  const vehicle = assigned.assignment.vehicle;

  const [pin, setPin] = React.useState("");
  const [pinOutcome, setPinOutcome] = React.useState<PinOutcome | null>(null);
  const [pinBusy, setPinBusy] = React.useState(false);
  /** A transport failure is NOT a closed outcome — different fact, different copy. */
  const [pinRequestError, setPinRequestError] = React.useState<string | null>(null);

  const [packageCountText, setPackageCountText] = React.useState("");
  const [staffFirstName, setStaffFirstName] = React.useState("");
  const [vehicleConfirmed, setVehicleConfirmed] = React.useState(false);

  const [loadingParticipants, setLoadingParticipants] = React.useState("");
  const [loadingEquipment, setLoadingEquipment] = React.useState("");
  const [existingDamage, setExistingDamage] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const [discrepancyFormOpen, setDiscrepancyFormOpen] = React.useState(false);
  /**
   * Set once Couranr has ACCEPTED a report, never on opening the form.
   * `couranr_complete_pickup` refuses outright while a discrepancy row is
   * `open`, so this mirrors a decision the database has already made.
   */
  const [discrepancyReported, setDiscrepancyReported] = React.useState(false);

  /*
   * What Couranr ALREADY holds for this pickup.
   *
   * Without this the requirements lived only in this component's state, so a
   * reload at a loading dock demanded photographs that were already stored and
   * that the server would have accepted — the driver's only way out was to
   * re-do work they had already done. A failed read deliberately leaves the
   * requirements unmet rather than clearing them: telling a driver a photo is
   * recorded when Couranr cannot confirm it is the worse error of the two.
   */
  const [recorded, setRecorded] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let live = true;
    void fetchMyProof(deliveryId).then((r) => {
      if (!live || isApiFailure(r)) return;
      const byType: Record<string, string> = {};
      for (const p of r.value.proof ?? []) {
        if (p.proofStage === "pickup" && !byType[p.proofType]) byType[p.proofType] = p.proofId;
      }
      setRecorded(byType);
    });
    return () => {
      live = false;
    };
  }, [deliveryId]);

  const shipmentPhoto = useProofUpload({
    deliveryId,
    stage: "pickup",
    proofType: "shipment_photo",
    location,
    recordedProofId: recorded.shipment_photo ?? null,
  });
  const conditionPhoto = useProofUpload({
    deliveryId,
    stage: "pickup",
    proofType: "condition_photo",
    location,
    recordedProofId: recorded.condition_photo ?? null,
  });
  // Constructed unconditionally — a hook cannot be called behind an `if` — and
  // only RENDERED when the shipment triggers the large-or-unusual rules.
  const securementPhoto = useProofUpload({
    deliveryId,
    stage: "pickup",
    proofType: "securement_photo",
    location,
    recordedProofId: recorded.securement_photo ?? null,
  });

  /*
   * Derived from what the SERVER stored, never from a browser assertion. A
   * driver who could declare "this is not unusual" would skip the securement
   * photo on exactly the load that most needs it. `couranr_complete_pickup`
   * derives the same flag from the same three inputs.
   */
  const large = requiresLargeShipmentProof({
    vehicleClass: assigned.vehicleRequirement.vehicleClass,
    declaredWeightLb: assigned.shipment.declaredWeightLb,
    packageCount: assigned.shipment.packageCount,
  });

  const packageCount = parsePackageCount(packageCountText);
  const version = readDeliveryVersion(assigned);
  const locationBlocked = !location.usable;

  /*
   * The one list. Each entry names a thing the driver can go and do; none of
   * them says "invalid input", because at a loading dock that is not an
   * instruction. Order follows the order of the form.
   */
  const blockers: string[] = [];
  if (pinOutcome !== "accepted") {
    blockers.push("Verify the pickup code the sender gives you.");
  }
  if (locationBlocked) blockers.push(location.message);
  if (!shipmentPhoto.finalized) blockers.push("Record a photo of the shipment.");
  if (!conditionPhoto.finalized) blockers.push("Record a photo of the shipment's condition.");
  if (packageCount === null) blockers.push("Enter how many packages you are collecting.");
  if (staffFirstName.trim() === "") {
    blockers.push("Enter the first name of the person handing the shipment over.");
  }
  if (!vehicle) {
    blockers.push("Couranr Operations has not recorded a vehicle for this assignment.");
  } else if (!vehicleConfirmed) {
    blockers.push(`Confirm you are loading ${vehicle.name}.`);
  }
  if (large) {
    if (!securementPhoto.finalized) blockers.push("Record a photo showing how the load is secured.");
    if (loadingParticipants.trim() === "") blockers.push("Record who loaded the shipment.");
    if (loadingEquipment.trim() === "") blockers.push("Record what equipment was used to load it.");
    if (existingDamage.trim() === "") {
      blockers.push("Record any damage the shipment already has, or write “None”.");
    }
    if (!acknowledged) blockers.push("Confirm you checked the load before driving.");
  }
  if (version === null) {
    blockers.push(
      "Couranr could not confirm this delivery's current version. Reload this page and try again."
    );
  }
  if (discrepancyReported) {
    // Listed last because it outranks everything above it: no amount of extra
    // evidence reopens this pickup. Only Couranr Operations can.
    blockers.push(
      "You reported a problem with this pickup. Couranr Operations decides what happens next — do not load or complete it until they tell you to."
    );
  }

  const ready = blockers.length === 0;

  async function submitPin() {
    setPinBusy(true);
    setPinRequestError(null);
    const r = await verifyPickupCode(deliveryId, pin);
    /*
     * Cleared unconditionally, on every path. The code is single-use evidence
     * of a handoff and leaving it in a field is the one place it could be
     * shoulder-read, restored by form autofill, or resubmitted by a stray
     * Enter. It is never written to localStorage or sessionStorage either.
     */
    setPin("");
    setPinBusy(false);
    if (isApiFailure(r)) {
      // Not an outcome. "We could not check" and "that code is wrong" lead the
      // driver to do completely different things.
      setPinRequestError(withReference(r));
      return;
    }
    setPinOutcome(r.value.outcome);
  }

  async function submit() {
    if (!ready || !vehicle || version === null || packageCount === null) return;

    // Throws rather than defaulting when there is no fix; the guard above means
    // that cannot happen, and this is the belt to that braces.
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setSubmitError(location.message);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const r = await completePickup(deliveryId, {
      expectedVersion: version,
      observedPackageCount: packageCount,
      staffFirstName: staffFirstName.trim(),
      confirmedVehicleId: vehicle.id,
      // Sent only when the rules apply, so an ordinary pickup does not record
      // three empty strings as if someone had answered them.
      loadingParticipants: large ? loadingParticipants.trim() : null,
      loadingEquipment: large ? loadingEquipment.trim() : null,
      existingDamage: large ? existingDamage.trim() : null,
      driverAcknowledged: large ? acknowledged : null,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
    });
    setSubmitting(false);
    if (isApiFailure(r)) {
      setSubmitError(withReference(r));
      return;
    }
    onCompleted();
  }

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="Pickup code"
          description="The sender reads you a six-digit code. Couranr checks it — you never type it into their phone."
        />
        <Stack gap={3}>
          <Field
            label="Six-digit pickup code"
            required
            hint="Ask the person handing the shipment over for the code Couranr sent them."
          >
            {(a) => (
              <Input
                {...a}
                value={pin}
                // Digits only, and never wider than the code itself, so a
                // mistyped character cannot be mistaken for a wrong code.
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))
                }
                inputMode="numeric"
                autoComplete="off"
                maxLength={MAX_PIN_LENGTH}
                disabled={pinBusy || pinOutcome === "accepted" || pinOutcome === "locked"}
                placeholder="000000"
              />
            )}
          </Field>

          <Cluster gap={3}>
            <Button
              variant="primary"
              loading={pinBusy}
              loadingLabel="Checking…"
              disabled={pin.length !== MAX_PIN_LENGTH || pinOutcome === "accepted"}
              onClick={() => void submitPin()}
            >
              Check code
            </Button>
            {pinOutcome === "accepted" ? <Badge tone="success">Code accepted</Badge> : null}
          </Cluster>

          {/* The closed outcome only. No attempt count, no generation, no lock
              window — a driver acts on "ask for a new code", not on "3 of 5". */}
          {pinOutcome ? (
            <Alert tone={PIN_OUTCOME_TONE[pinOutcome]} title="Pickup code">
              {PIN_OUTCOME_MESSAGES[pinOutcome]}
            </Alert>
          ) : null}

          {pinRequestError ? (
            <Alert tone="danger" title="Couranr could not check that code">
              {pinRequestError}
            </Alert>
          ) : null}
        </Stack>
      </Card>

      <LocationBlock location={location} />

      <Card>
        <CardHeader
          title="What you are collecting"
          description="Record what is actually in front of you, not what the order says."
        />
        <Stack gap={4}>
          <Grid columns={2}>
            <Field
              label="Packages you are collecting"
              required
              hint={
                assigned.shipment.packageCount != null
                  ? `The sender declared ${assigned.shipment.packageCount}. Enter what you actually see.`
                  : "Enter what you actually see."
              }
            >
              {(a) => (
                <Input
                  {...a}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_PACKAGES}
                  step={1}
                  // Held as text so an empty field stays EMPTY. A numeric state
                  // would have to pick a value for "nothing typed", and every
                  // available choice is a lie.
                  value={packageCountText}
                  onChange={(e) => setPackageCountText(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="First name of the person handing it over"
              required
              hint="First name is enough. Couranr does not record anything else about them."
            >
              {(a) => (
                <Input
                  {...a}
                  value={staffFirstName}
                  onChange={(e) => setStaffFirstName(e.target.value)}
                  maxLength={200}
                  autoComplete="off"
                />
              )}
            </Field>
          </Grid>

          <PhotoField
            label="Photo of the shipment"
            hint="One photo showing everything you are taking."
            upload={shipmentPhoto}
            blocked={locationBlocked}
            blockedReason={location.message}
          />
          <PhotoField
            label="Photo of its condition"
            hint="Show the packaging as you found it — including anything already damaged."
            upload={conditionPhoto}
            blocked={locationBlocked}
            blockedReason={location.message}
          />
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Vehicle"
          description="Couranr assigned this vehicle. Confirm it is the one you are loading."
        />
        {vehicle ? (
          <CheckboxRow
            label={`I am loading this shipment into ${vehicle.name}.`}
            hint="If you are in a different vehicle, report a problem below instead of confirming."
            checked={vehicleConfirmed}
            onChange={(e) => setVehicleConfirmed(e.target.checked)}
          />
        ) : (
          <Alert tone="warning" title="No vehicle is recorded for this assignment">
            Couranr Operations has to record the vehicle before this pickup can be completed.
            Contact Couranr Operations.
          </Alert>
        )}
      </Card>

      {large ? (
        <Card>
          <CardHeader
            title="Large or unusual shipment"
            description="Couranr requires extra evidence for this load. These are required by the shipment Couranr committed to, not by anything you selected."
          />
          <Stack gap={4}>
            <PhotoField
              label="Photo showing the load secured"
              hint="Show the straps, ramp or tie-downs holding the load in place."
              upload={securementPhoto}
              blocked={locationBlocked}
              blockedReason={location.message}
            />

            <Field
              label="Who loaded the shipment"
              required
              hint="For example: two staff from the sender and me."
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={2}
                  maxLength={1000}
                  value={loadingParticipants}
                  onChange={(e) => setLoadingParticipants(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Equipment used to load it"
              required
              hint="For example: pallet jack, ramp, dolly, or by hand."
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={2}
                  maxLength={1000}
                  value={loadingEquipment}
                  onChange={(e) => setLoadingEquipment(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Damage the shipment already has"
              required
              hint="Write “None” if there is none. This is what protects you if damage is claimed later."
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={2}
                  maxLength={1000}
                  value={existingDamage}
                  onChange={(e) => setExistingDamage(e.target.value)}
                />
              )}
            </Field>

            <CheckboxRow
              label="I checked the load is secure before driving."
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
          </Stack>
        </Card>
      ) : null}

      {/*
        The escape hatch sits ABOVE the completion button on purpose. A driver
        who has decided the shipment is wrong should meet "report it" before
        they meet "complete it", not after.

        DRV-004 renders nothing until `open`, and once a report is accepted it
        renders its paused state regardless — so this parent cannot hide the
        fact that the pickup is stopped by closing its own disclosure.
      */}
      {discrepancyReported ? null : (
        <Cluster gap={3}>
          <Button
            variant="secondary"
            disabled={discrepancyFormOpen}
            onClick={() => setDiscrepancyFormOpen(true)}
          >
            Report a problem with this pickup
          </Button>
        </Cluster>
      )}
      <PickupDiscrepancy
        deliveryId={deliveryId}
        open={discrepancyFormOpen}
        onReported={() => setDiscrepancyReported(true)}
      />

      <Card>
        <CardHeader title="Complete pickup" />
        <Stack gap={3}>
          {/*
            The reasons are listed rather than hidden behind a disabled button.
            A control that will not respond and will not say why reads as a
            broken app, and the driver's next move is to call someone.
          */}
          {ready ? null : (
            <Alert tone="warning" title="Still needed before you can complete this pickup">
              <ul className="cr-list">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}

          {submitError ? (
            <Alert tone="danger" title="That pickup could not be completed">
              {submitError}
            </Alert>
          ) : null}

          <Cluster gap={3}>
            <Button
              variant="primary"
              loading={submitting}
              loadingLabel="Completing…"
              disabled={!ready}
              onClick={() => void submit()}
            >
              Complete pickup
            </Button>
          </Cluster>
        </Stack>
      </Card>
    </Stack>
  );
}

/* ------------------------------------------------------------------ parts -- */

/**
 * The location panel, shared with DRV-002.
 *
 * It lives here rather than in `AssignedDeliveryDetail` only because that file
 * imports this one; moving it the other way would make the two modules
 * circular.
 *
 * The fix is never requested on mount. A permission prompt that appears the
 * moment a screen loads gets dismissed reflexively, and in most browsers a
 * dismissal is sticky.
 */
export function LocationBlock({ location }: { location: LocationState }) {
  const tone = location.usable ? "success" : location.status === "requesting" ? "info" : "warning";
  return (
    <Card elevation="quiet">
      <CardHeader
        title="Location"
        description="Couranr records where each step happened. It is evidence for the merchant, not tracking."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={location.status === "requesting"}
            loadingLabel="Finding…"
            onClick={location.request}
          >
            {location.status === "not_requested" ? "Share location" : "Try again"}
          </Button>
        }
      />
      <Stack gap={2}>
        <Alert tone={tone} title={location.usable ? "Location captured" : "Location needed"}>
          {location.message}
        </Alert>
        {/* Accuracy, not coordinates. A driver acts on "this fix is vague";
            reading their own latitude back to them tells them nothing. */}
        {location.fix?.accuracyM != null ? (
          <Text size="xs" muted>
            Accurate to about {Math.round(location.fix.accuracyM)} m.
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * One photo requirement.
 *
 * SELECTED IS NOT RECORDED. The badge distinguishes them because they are
 * genuinely different states: the bytes only become proof once the server has
 * read the stored object back and compared its real size and type against what
 * it authorized. A truncated upload returns HTTP 200 and lands in `failed`
 * here, never in "Recorded".
 */
function PhotoField({
  label,
  hint,
  upload,
  blocked,
  blockedReason,
}: {
  label: string;
  hint: string;
  upload: ProofUploadState;
  blocked: boolean;
  blockedReason: string;
}) {
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const busy =
    upload.status === "reading" ||
    upload.status === "authorizing" ||
    upload.status === "uploading" ||
    upload.status === "finalizing";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSelectedName(file.name);
    // Re-taking a photo clears the previous result first, so a stale
    // `finalized` cannot survive next to a newly chosen file.
    if (upload.status !== "idle") upload.reset();
    void upload.upload(file);
  }

  return (
    <Field label={label} required hint={hint}>
      {(a) => (
        <Stack gap={2}>
          <input
            {...a}
            type="file"
            accept="image/*"
            className="cr-input"
            // A photo carries the location it was taken at. Blocking here keeps
            // a fix from being silently omitted; the completion command would
            // refuse without one anyway.
            disabled={blocked || busy}
            onChange={onPick}
          />

          <Cluster gap={2}>
            {upload.finalized ? (
              <Badge tone="success">Recorded</Badge>
            ) : selectedName ? (
              <Badge tone="warning">Selected — not recorded yet</Badge>
            ) : (
              <Badge tone="neutral">Not recorded</Badge>
            )}
            {selectedName ? (
              <Text as="span" size="xs" muted>
                {selectedName}
              </Text>
            ) : null}
          </Cluster>

          {blocked ? (
            <Text size="xs" muted>
              {blockedReason}
            </Text>
          ) : null}

          {busy ? (
            <Text size="xs" muted>
              Recording this photo with Couranr…
            </Text>
          ) : null}

          {upload.status === "failed" ? (
            <Alert tone="danger" title="That photo was not recorded">
              {upload.error ?? "Take the photo again."}
            </Alert>
          ) : null}
        </Stack>
      )}
    </Field>
  );
}

