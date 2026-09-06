"use client";

import * as React from "react";
import jsQR from "jsqr";
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
import { Field, Input } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  PIN_OUTCOME_MESSAGES,
  requiresLargeShipmentProof,
  type PinOutcome,
} from "@/lib/couranr/driver/states";
import {
  parsePickupCredentialPayload,
} from "@/lib/couranr/driver/pickupCredential";
import {
  completePickup,
  fetchMyProof,
  verifyPickupCode,
  type AssignedDeliveryView,
} from "./client";
import { PickupDiscrepancy } from "./PickupDiscrepancy";
import { locationBody, type LocationState } from "./useLocationCapture";
import { useProofUpload, type ProofUploadState } from "./useProofUpload";

/**
 * DRV-003 Pickup Handoff V2.
 *
 * Sender declares -> Couranr freezes -> driver confirms physical custody.
 *
 * The happy path asks the driver for only information that did not already
 * exist in the order:
 *   1) sender-held pickup credential (QR or six-digit fallback),
 *   2) one pickup photo,
 *   3) current location/time, captured by Couranr,
 *   4) explicit confirmation that the physical pickup matches expectation.
 *
 * Package count, sender identity and assigned vehicle are not re-entered.
 * A mismatch routes to DRV-004 and cannot silently rewrite the sender facts.
 */

const MAX_PIN_LENGTH = 6;

/** Kept exported for existing callers/tests; V2 no longer asks the driver for it. */
export function parsePackageCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null;
}

export function readDeliveryVersion(assigned: AssignedDeliveryView): number | null {
  const raw: unknown = assigned?.version;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

const PIN_OUTCOME_TONE: Record<PinOutcome, "success" | "warning" | "danger"> = {
  accepted: "success",
  invalid: "warning",
  locked: "danger",
  expired: "warning",
};

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
  const version = readDeliveryVersion(assigned);

  const [pin, setPin] = React.useState("");
  const [pinOutcome, setPinOutcome] = React.useState<PinOutcome | null>(null);
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinRequestError, setPinRequestError] = React.useState<string | null>(null);
  const [qrBusy, setQrBusy] = React.useState(false);
  const [qrError, setQrError] = React.useState<string | null>(null);
  const [manualCodeOpen, setManualCodeOpen] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [discrepancyFormOpen, setDiscrepancyFormOpen] = React.useState(false);
  const [discrepancyReported, setDiscrepancyReported] = React.useState(false);

  /* Existing finalized proof survives a reload. */
  const [recorded, setRecorded] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let live = true;
    void fetchMyProof(deliveryId).then((result) => {
      if (!live || isApiFailure(result)) return;
      const byType: Record<string, string> = {};
      for (const proof of result.value.proof ?? []) {
        if (proof.proofStage === "pickup" && !byType[proof.proofType]) {
          byType[proof.proofType] = proof.proofId;
        }
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
  const securementPhoto = useProofUpload({
    deliveryId,
    stage: "pickup",
    proofType: "securement_photo",
    location,
    recordedProofId: recorded.securement_photo ?? null,
  });

  const large = requiresLargeShipmentProof({
    vehicleClass: assigned.vehicleRequirement.vehicleClass,
    declaredWeightLb: assigned.shipment.declaredWeightLb,
    packageCount: assigned.shipment.packageCount,
  });

  const blockers: string[] = [];
  if (pinOutcome !== "accepted") blockers.push("Verify the pickup with the sender.");
  if (!location.usable) blockers.push(location.message);
  if (!shipmentPhoto.finalized) blockers.push("Take one photo showing everything you are collecting.");
  if (large && !securementPhoto.finalized) {
    blockers.push("Take a photo showing the large load secured.");
  }
  if (version === null) {
    blockers.push("Reload this delivery so Couranr can confirm its current version.");
  }
  if (discrepancyReported) {
    blockers.push("Couranr Operations must review the pickup issue before you continue.");
  }
  const ready = blockers.length === 0;

  async function verifyCode(code: string) {
    if (!/^\d{6}$/.test(code) || pinBusy) return;
    setPinBusy(true);
    setPinRequestError(null);
    const result = await verifyPickupCode(deliveryId, code);
    setPinBusy(false);
    setPin("");
    if (isApiFailure(result)) {
      setPinRequestError(withReference(result));
      return;
    }
    setPinOutcome(result.value.outcome);
  }

  async function scanQrFile(file: File | null) {
    if (!file || qrBusy || pinOutcome === "accepted") return;
    setQrBusy(true);
    setQrError(null);

    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const image = context.getImageData(0, 0, width, height);
      const decoded = jsQR(image.data, width, height, {
        inversionAttempts: "attemptBoth",
      });

      if (!decoded?.data) {
        setQrError("Couranr could not read a QR code. Try again or enter the six-digit code.");
        return;
      }

      /*
       * Wrong-delivery QR is rejected LOCALLY. It never reaches verify and
       * therefore cannot burn another delivery's attempt counter.
       */
      const parsed = parsePickupCredentialPayload(decoded.data, deliveryId);
      if (!parsed) {
        setQrError("That is not the pickup QR for this delivery. Ask the sender to show the Couranr pickup verification.");
        return;
      }
      await verifyCode(parsed.code);
    } catch {
      setQrError("Couranr could not read that image. Try again or enter the six-digit code.");
    } finally {
      setQrBusy(false);
    }
  }

  async function submit() {
    if (!ready || version === null) return;
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setSubmitError(location.message);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const result = await completePickup(deliveryId, {
      expectedVersion: version,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
    });
    setSubmitting(false);
    if (isApiFailure(result)) {
      setSubmitError(withReference(result));
      return;
    }
    onCompleted();
  }

  return (
    <Stack gap={6}>
      <ExpectedPickup assigned={assigned} large={large} />

      <Card>
        <CardHeader
          title="Verify pickup"
          description="Ask the sender to show their Couranr pickup QR. The six-digit code underneath is the fallback."
          actions={
            pinOutcome === "accepted" ? <Badge tone="success">Verified</Badge> : <Badge tone="neutral">1 of 2</Badge>
          }
        />
        <Stack gap={3}>
          {pinOutcome === "accepted" ? (
            <Alert tone="success" title="Sender verified">
              Pickup verification accepted. You do not need to scan or enter it again.
            </Alert>
          ) : (
            <>
              <Field
                label="Scan pickup QR"
                hint="Use your camera to capture the QR shown by the sender. The image stays on this device."
              >
                {(a) => (
                  <input
                    {...a}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="cr-input"
                    disabled={qrBusy || pinBusy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      void scanQrFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                )}
              </Field>
              {qrBusy ? <Text size="xs" muted>Reading pickup QR…</Text> : null}
              {qrError ? <Alert tone="warning" title="QR not verified">{qrError}</Alert> : null}

              <Button
                variant="ghost"
                onClick={() => setManualCodeOpen((open) => !open)}
                aria-expanded={manualCodeOpen}
              >
                {manualCodeOpen ? "Hide six-digit fallback" : "Enter six-digit code instead"}
              </Button>
              {manualCodeOpen ? (
                <Stack gap={3}>
                  <Field label="Pickup code">
                    {(a) => (
                      <Input
                        {...a}
                        value={pin}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={MAX_PIN_LENGTH}
                        placeholder="000000"
                        disabled={pinBusy}
                        onChange={(e) =>
                          setPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))
                        }
                      />
                    )}
                  </Field>
                  <Button
                    variant="secondary"
                    loading={pinBusy}
                    loadingLabel="Checking…"
                    disabled={pin.length !== MAX_PIN_LENGTH}
                    onClick={() => void verifyCode(pin)}
                  >
                    Verify code
                  </Button>
                </Stack>
              ) : null}
            </>
          )}

          {pinOutcome && pinOutcome !== "accepted" ? (
            <Alert tone={PIN_OUTCOME_TONE[pinOutcome]} title="Pickup verification">
              {PIN_OUTCOME_MESSAGES[pinOutcome]}
            </Alert>
          ) : null}
          {pinRequestError ? (
            <Alert tone="danger" title="Couranr could not check the pickup verification">
              {pinRequestError}
            </Alert>
          ) : null}
        </Stack>
      </Card>

      {!location.usable ? (
        <LocationBlock location={location} />
      ) : (
        <Cluster gap={2}>
          <Badge tone="success">Location captured</Badge>
          <Text size="xs" muted>
            Couranr records the location and server time with the pickup evidence
            {location.fix?.accuracyM != null
              ? ` · about ${Math.round(location.fix.accuracyM)} m accuracy`
              : ""}.
          </Text>
        </Cluster>
      )}

      <Card>
        <CardHeader
          title="Pickup photo"
          description="Take one photo showing everything you are taking. This is the normal pickup proof."
          actions={<Badge tone={shipmentPhoto.finalized ? "success" : "neutral"}>2 of 2</Badge>}
        />
        <PhotoField
          label="Photo of the pickup"
          hint="Fit the full pickup in the frame when possible."
          upload={shipmentPhoto}
          blocked={!location.usable}
          blockedReason={location.message}
        />

        {large ? (
          <Stack gap={3} style={{ marginTop: "var(--couranr-space-4)" }}>
            <Alert tone="info" title="Large or unusual load">
              Couranr needs one extra securement photo for this load. You do not need to fill out a loading report.
            </Alert>
            <PhotoField
              label="Photo of the secured load"
              hint="Show the straps, tie-downs, ramp or other securement before driving."
              upload={securementPhoto}
              blocked={!location.usable}
              blockedReason={location.message}
            />
          </Stack>
        ) : null}
      </Card>

      {discrepancyReported ? null : (
        <Button
          variant="secondary"
          disabled={discrepancyFormOpen}
          onClick={() => setDiscrepancyFormOpen(true)}
        >
          Something is different
        </Button>
      )}
      <PickupDiscrepancy
        deliveryId={deliveryId}
        open={discrepancyFormOpen}
        onReported={() => setDiscrepancyReported(true)}
      />

      <Card>
        <CardHeader
          title="Confirm custody"
          description="Use this only when the pickup in front of you matches what Couranr expected."
        />
        <Stack gap={3}>
          {!ready ? (
            <Alert tone="warning" title="Still needed">
              <ul className="cr-list">
                {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success" title="Ready to confirm pickup">
              Sender verification, pickup photo and location are recorded.
            </Alert>
          )}

          {submitError ? (
            <Alert tone="danger" title="Pickup was not confirmed">{submitError}</Alert>
          ) : null}

          <Button
            variant="primary"
            loading={submitting}
            loadingLabel="Confirming…"
            disabled={!ready}
            onClick={() => void submit()}
          >
            Confirm pickup
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}

function ExpectedPickup({
  assigned,
  large,
}: {
  assigned: AssignedDeliveryView;
  large: boolean;
}) {
  const shipment = assigned.shipment;
  const description = shipment.description ?? "Pickup details were created before Couranr added the new pickup summary.";
  return (
    <Card>
      <CardHeader
        title="What to pick up"
        description="This came from the sender's confirmed order. You only need to report it if what you see is different."
        actions={large ? <Badge tone="warning">Large load</Badge> : undefined}
      />
      <Stack gap={2}>
        <Text strong>{description}</Text>
        <Cluster gap={2}>
          {shipment.packageCount != null ? (
            <Badge tone="neutral">
              {shipment.packageCount} {shipment.packageCount === 1 ? "package" : "packages"}
            </Badge>
          ) : null}
          {shipment.declaredWeightLb != null ? (
            <Badge tone="neutral">{shipment.declaredWeightLb} lb declared</Badge>
          ) : null}
          {shipment.orderReference ? (
            <Badge tone="info">Ref {shipment.orderReference}</Badge>
          ) : null}
        </Cluster>
        {shipment.handlingNotes ? (
          <Alert tone="info" title="Handling note">{shipment.handlingNotes}</Alert>
        ) : null}
        {assigned.pickup.instructions ? (
          <Text size="sm" muted>Pickup instructions: {assigned.pickup.instructions}</Text>
        ) : null}
        {assigned.assignment.vehicle ? (
          <Text size="xs" muted>
            Assigned vehicle: {assigned.assignment.vehicle.name}. If you are using a different vehicle, report a problem instead of confirming pickup.
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

export function LocationBlock({ location }: { location: LocationState }) {
  const tone = location.usable
    ? "success"
    : location.status === "requesting"
      ? "info"
      : "warning";
  return (
    <Card elevation="quiet">
      <CardHeader
        title="Location"
        description="Couranr records where and when custody changes. Your coordinates are not something you need to type."
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
      <Alert tone={tone} title={location.usable ? "Location captured" : "Location needed"}>
        {location.message}
      </Alert>
    </Card>
  );
}

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

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedName(file.name);
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
            capture="environment"
            className="cr-input"
            disabled={blocked || busy}
            onChange={onPick}
          />
          <Cluster gap={2}>
            {upload.finalized ? (
              <Badge tone="success">Recorded</Badge>
            ) : selectedName ? (
              <Badge tone="warning">Recording…</Badge>
            ) : (
              <Badge tone="neutral">Not recorded</Badge>
            )}
            {selectedName ? <Text size="xs" muted>{selectedName}</Text> : null}
          </Cluster>
          {blocked ? <Text size="xs" muted>{blockedReason}</Text> : null}
          {busy ? <Text size="xs" muted>Saving this photo with Couranr…</Text> : null}
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
