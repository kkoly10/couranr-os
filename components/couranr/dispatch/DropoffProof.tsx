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
import { CheckboxRow, Field, Input } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  COMPLETION_COMMAND,
  DRIVER_COMMAND_LABELS,
  FULFILLMENT_LABELS,
  PIN_OUTCOME_MESSAGES,
  PROOF_METHOD_LABELS,
  isFulfillmentState,
  isProofMethod,
  nextDriverCommand,
  type FulfillmentState,
  type PinOutcome,
  type ProofMethod,
} from "@/lib/couranr/driver/states";
import {
  completeDirectHandoff,
  completeLeaveAtDoor,
  completeSignature,
  fetchMyProof,
  verifyRecipientCode,
  type AssignedDeliveryView,
  type CompletionResult,
  type DriverCompletionReceipt,
} from "./client";
import { locationBody, type LocationState } from "./useLocationCapture";
import { useProofUpload, type ProofUploadState } from "./useProofUpload";
import { LocationBlock, readDeliveryVersion } from "./PickupFlow";

/**
 * DRV-006 — the drop-off, as the driver performs it.
 *
 * EXACTLY ONE FORM, CHOSEN BY THE DELIVERY. `assigned.proof.method` is an
 * immutable snapshot taken when the delivery was created, and it selects the
 * form here the same way it selects the completion command in
 * `COMPLETION_COMMAND`. There is no method selector and no fallback: a delivery
 * captured as `signature` cannot reach the leave-at-door path, because the map
 * has no other way in and the SQL refuses with `wrong_proof_method` regardless.
 * A driver choosing their own evidence standard at the door would be choosing
 * the weaker one for a shipment that was sold the stronger one.
 *
 * `photo_or_pin` is RECIPIENT PIN HANDOFF. The stored value keeps its
 * historical name because it sits on live rows, but a photograph is not an
 * alternative to the recipient PIN and no copy below suggests it is.
 *
 * Nothing here mutates without a usable location fix, and no completion call is
 * made until the proof it depends on is `.finalized` — a file that has been
 * chosen, or even uploaded, is not proof until the server has read the stored
 * object back.
 */

const MAX_PIN_LENGTH = 6;
const MAX_NAME = 200;

const VERSION_BLOCKER =
  "Couranr could not confirm this delivery's current version. Reload this page and try again.";

/** Tone per closed outcome. `locked` is the only one the driver cannot retry. */
const PIN_OUTCOME_TONE: Record<PinOutcome, "success" | "warning" | "danger"> = {
  accepted: "success",
  invalid: "warning",
  locked: "danger",
  expired: "warning",
};

type FormProps = {
  deliveryId: string;
  version: number | null;
  location: LocationState;
  recordedProof: Record<string, string>;
  onDone: (receipt: DriverCompletionReceipt | null) => void;
};

export function DropoffProof({
  assigned,
  location,
  onCompleted,
}: {
  assigned: AssignedDeliveryView;
  location: LocationState;
  onCompleted: () => void;
}) {
  const [receipt, setReceipt] = React.useState<DriverCompletionReceipt | null>(null);
  const [completed, setCompleted] = React.useState(false);
  const [recordedProof, setRecordedProof] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let live = true;
    void fetchMyProof(assigned.deliveryId).then((result) => {
      if (!live || isApiFailure(result)) return;
      const byType: Record<string, string> = {};
      for (const proof of result.value.proof ?? []) {
        if (proof.proofStage === "dropoff" && !byType[proof.proofType]) {
          byType[proof.proofType] = proof.proofId;
        }
      }
      setRecordedProof(byType);
    });
    return () => { live = false; };
  }, [assigned.deliveryId]);

  const state = isFulfillmentState(assigned.fulfillmentState) ? assigned.fulfillmentState : null;
  const method = isProofMethod(assigned.proof.method) ? assigned.proof.method : null;
  // Both arguments are required rather than optional: omitting the proof method
  // would silently yield null at `at_dropoff` and render a dead end.
  const command = state && method ? nextDriverCommand(state, method) : null;
  const version = readDeliveryVersion(assigned);

  const finish = React.useCallback(
    (r: DriverCompletionReceipt | null) => {
      setReceipt(r);
      setCompleted(true);
      onCompleted();
    },
    [onCompleted]
  );

  /*
   * The delivery is finished, so this screen stops showing it. The receipt is
   * the only thing rendered from here on — no address, no recipient contact, no
   * merchant note, no money, and no request for a proof-media URL. A completed
   * delivery stops being readable rather than lingering on a success screen.
   */
  if (completed) return <CompletionReceiptCard receipt={receipt} />;

  if (!state || !method) {
    // Fail closed. An unrecognised state or method means this app and the
    // database disagree about what this delivery is, and guessing a form would
    // pick an evidence standard on the merchant's behalf.
    return (
      <Card>
        <CardHeader title="Drop-off" />
        <Alert tone="warning" title="Couranr does not recognise this delivery">
          Contact Couranr Operations before handing anything over.
        </Alert>
      </Card>
    );
  }

  // The ONE legal next action. If the delivery is not at the drop-off yet, this
  // screen offers nothing at all rather than a control the database would
  // refuse.
  if (command !== COMPLETION_COMMAND[method]) {
    return <NotAtDropoffYet state={state} />;
  }

  const shared: FormProps = {
    deliveryId: assigned.deliveryId,
    version,
    location,
    recordedProof,
    onDone: finish,
  };

  switch (method) {
    case "photo_or_pin":
      return <RecipientPinHandoff {...shared} />;
    case "signature":
      return <SignatureCapture {...shared} />;
    case "leave_at_door":
      return <LeaveAtDoor {...shared} />;
    default: {
      // Exhaustiveness: a method the vocabulary does not declare fails closed
      // rather than falling through to whichever form is listed last.
      const unexpected: never = method;
      void unexpected;
      return null;
    }
  }
}

function NotAtDropoffYet({ state }: { state: FulfillmentState }) {
  return (
    <Card>
      <CardHeader title="Drop-off proof" />
      <Alert tone="info" title="Not yet">
        {FULFILLMENT_LABELS[state]}. Couranr opens the drop-off proof once you have arrived at the
        drop-off.
      </Alert>
    </Card>
  );
}

/* ------------------------------------------------- recipient PIN handoff -- */

/**
 * `photo_or_pin` — the recipient reads a six-digit code and Couranr checks it.
 *
 * The PIN is the proof of handoff. There is no photograph option on this path
 * and no copy offering one: the whole point of the code is that it comes from
 * the person the shipment was addressed to, which a picture of a doorway cannot
 * establish.
 */
function RecipientPinHandoff({ deliveryId, version, location, onDone }: FormProps) {
  const [pin, setPin] = React.useState("");
  const [pinOutcome, setPinOutcome] = React.useState<PinOutcome | null>(null);
  const [pinBusy, setPinBusy] = React.useState(false);
  /** A transport failure is NOT a closed outcome — different fact, different copy. */
  const [pinRequestError, setPinRequestError] = React.useState<string | null>(null);

  const [recipientFirstName, setRecipientFirstName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const blockers: string[] = [];
  if (pinOutcome !== "accepted") blockers.push("Check the six-digit code the recipient reads you.");
  if (recipientFirstName.trim() === "") {
    blockers.push("Enter the first name of the person taking the shipment.");
  }
  if (!location.usable) blockers.push(location.message);
  if (version === null) blockers.push(VERSION_BLOCKER);
  const ready = blockers.length === 0;

  async function submitPin() {
    setPinBusy(true);
    setPinRequestError(null);
    const r = await verifyRecipientCode(deliveryId, pin);
    /*
     * Cleared unconditionally, on every path. The code is single-use evidence of
     * a handoff, and leaving it in a field is the one place it could be
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
    if (!ready || version === null || submitting) return;
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setSubmitError(location.message);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const r = await completeDirectHandoff(deliveryId, {
      expectedVersion: version,
      recipientFirstName: recipientFirstName.trim(),
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
    });
    setSubmitting(false);
    if (isApiFailure(r)) {
      setSubmitError(withReference(r));
      return;
    }
    onDone(receiptOf(r.value));
  }

  return (
    <Stack gap={6}>
      <MethodCard method="photo_or_pin" />

      <Card>
        <CardHeader
          title="Recipient code"
          description="The recipient reads you a six-digit code. Couranr checks it — you never type it into their phone."
        />
        <Stack gap={3}>
          <Field
            label="Six-digit recipient code"
            required
            hint="Ask the person taking the shipment for the code Couranr sent them."
          >
            {(a) => (
              <Input
                {...a}
                value={pin}
                // Digits only, and never wider than the code itself, so a
                // mistyped character cannot be mistaken for a wrong code.
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))}
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
            <Alert tone={PIN_OUTCOME_TONE[pinOutcome]} title="Recipient code">
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

      <Card>
        <CardHeader title="Who took it" />
        <Field
          label="First name of the person taking the shipment"
          required
          hint="First name is enough. Couranr does not record anything else about them."
        >
          {(a) => (
            <Input
              {...a}
              value={recipientFirstName}
              onChange={(e) => setRecipientFirstName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="off"
            />
          )}
        </Field>
      </Card>

      <LocationBlock location={location} />

      <CompleteStep
        title="Complete handoff"
        label="Complete handoff"
        loadingLabel="Completing…"
        blockers={blockers}
        error={submitError}
        busy={submitting}
        onSubmit={submit}
      />
    </Stack>
  );
}

/* -------------------------------------------------------------- signature -- */

const SIGNATURE_HEIGHT = 180;
/** Drawn, not themed: the exported PNG has no stylesheet to inherit from. */
const SIGNATURE_INK = "#0d1525";
const SIGNATURE_PAPER = "#ffffff";

/**
 * `signature` — the recipient signs, and the signature is uploaded as its own
 * proof before the delivery is completed.
 *
 * The image is never in the completion body. It is finalized first through the
 * proof-upload routes, and `couranr_complete_signature_delivery` refuses with
 * `signature_required` until that proof exists — so the same request cannot
 * both assert the evidence and claim the delivery is done.
 */
function SignatureCapture({ deliveryId, version, location, recordedProof, onDone }: FormProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);
  const [hasInk, setHasInk] = React.useState(false);

  const [signerFirstName, setSignerFirstName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  /**
   * The proof id, held in a REF as well as in the hook's state.
   *
   * `signature.finalized` belongs to the render that started the upload, so it
   * is stale in the same event handler once the upload has been awaited —
   * reading it there would either block a completion that had just recorded its
   * proof, or, if ignored, let `completeSignature` run without one. The hook
   * calls `onFinalized` synchronously, so the ref is the reading that reflects
   * what actually happened.
   */
  const finalizedRef = React.useRef<string | null>(null);

  const signature = useProofUpload({
    deliveryId,
    stage: "dropoff",
    proofType: "signature",
    location,
    onFinalized: (proofId) => {
      finalizedRef.current = proofId;
    },
    recordedProofId: recordedProof.signature ?? null,
  });

  React.useEffect(() => {
    if (signature.proofId) finalizedRef.current = signature.proofId;
  }, [signature.proofId]);

  const busy =
    submitting ||
    signature.status === "reading" ||
    signature.status === "authorizing" ||
    signature.status === "uploading" ||
    signature.status === "finalizing";

  function context(): CanvasRenderingContext2D | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }

  /*
   * Sized ONCE on mount. Assigning width or height clears the backing store, so
   * doing this on every render would wipe a signature mid-stroke. The backing
   * store is scaled by the device pixel ratio because a phone signature
   * rendered at CSS resolution is an illegible smear at the size a merchant
   * later views it.
   */
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? Math.min(Math.max(window.devicePixelRatio, 1), 3)
        : 1;
    canvas.width = Math.max(1, Math.round((rect.width || 1) * ratio));
    canvas.height = Math.max(1, Math.round(SIGNATURE_HEIGHT * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // An opaque page: a transparent PNG of a signature renders as nothing on a
    // dark background, and evidence nobody can see is not evidence.
    ctx.fillStyle = SIGNATURE_PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = SIGNATURE_INK;
    ctx.lineWidth = 2.5 * ratio;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  /**
   * New ink invalidates a recorded signature: the stored PNG no longer matches
   * what the recipient can see, and completing against it would attach evidence
   * of something other than what was signed.
   */
  function invalidateRecorded() {
    if (finalizedRef.current !== null || signature.status !== "idle") {
      finalizedRef.current = null;
      signature.reset();
    }
  }

  /*
   * Client coordinates mapped into the BACKING STORE with the element's current
   * size, not with the size it had at mount. The canvas is `width: 100%`, so a
   * rotation or a sidebar opening changes the CSS box while the backing store
   * keeps the pixels it was given — a fixed scale factor would put the ink an
   * inch from the fingertip for the rest of the signature.
   */
  function pointAt(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (busy) return;
    const ctx = context();
    if (!ctx) return;
    // Capture keeps a stroke attached to this element when a finger slides off
    // the pad mid-signature.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; drawing still works without it */
    }
    invalidateRecorded();
    drawing.current = true;
    const p = pointAt(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot is a mark: a tap with no movement must leave something behind.
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const p = pointAt(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* nothing to release */
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    drawing.current = false;
    ctx.fillStyle = SIGNATURE_PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = SIGNATURE_INK;
    setHasInk(false);
    invalidateRecorded();
  }

  const blockers: string[] = [];
  if (!hasInk && !signature.finalized) blockers.push("Ask the recipient to sign in the box.");
  if (signerFirstName.trim() === "") blockers.push("Enter the signer's first name.");
  if (!location.usable) blockers.push(location.message);
  if (version === null) blockers.push(VERSION_BLOCKER);
  const ready = blockers.length === 0;

  async function submit() {
    if (!ready || version === null || submitting) return;
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setSubmitError(location.message);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    // Record the signature first, and only continue if the server confirmed it.
    if (finalizedRef.current === null) {
      const canvas = canvasRef.current;
      if (!canvas) {
        setSubmitting(false);
        setSubmitError("The signature pad did not load. Reload this page and try again.");
        return;
      }
      const blob = await canvasBlob(canvas);
      if (!blob || blob.size === 0) {
        setSubmitting(false);
        setSubmitError("That signature could not be saved. Ask the recipient to sign again.");
        return;
      }
      await signature.upload(new File([blob], "signature.png", { type: "image/png" }));
      if (finalizedRef.current === null) {
        // Completing here would record a delivery whose signature does not
        // exist. The hook renders WHY the upload failed on the signature card;
        // this says what it meant for the delivery, because a button that
        // silently re-enables reads as a broken app.
        setSubmitting(false);
        setSubmitError(
          "The signature was not recorded, so this delivery was not completed. Check the signature step above and try again."
        );
        return;
      }
    }

    const r = await completeSignature(deliveryId, {
      expectedVersion: version,
      signerFirstName: signerFirstName.trim(),
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
    });
    setSubmitting(false);
    if (isApiFailure(r)) {
      // The proof stays finalized, so a retry does not upload a second copy of
      // the same signature.
      setSubmitError(withReference(r));
      return;
    }
    onDone(receiptOf(r.value));
  }

  return (
    <Stack gap={6}>
      <MethodCard method="signature" />

      <Card>
        <CardHeader
          title="Signature"
          description="Hand the phone to the recipient and ask them to sign."
          actions={
            <Button variant="secondary" size="sm" disabled={busy || !hasInk} onClick={clear}>
              Clear
            </Button>
          }
        />
        <Stack gap={3}>
          <canvas
            ref={canvasRef}
            // Labelled, not given a role: `img` would tell assistive technology
            // this is a picture to read rather than a pad to sign on.
            aria-label="Signature pad"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{
              width: "100%",
              height: SIGNATURE_HEIGHT,
              // Without this a finger drag scrolls the page instead of signing.
              touchAction: "none",
              background: SIGNATURE_PAPER,
              border: "1px solid var(--couranr-border-strong)",
              borderRadius: "var(--couranr-radius-md)",
              cursor: busy ? "not-allowed" : "crosshair",
            }}
          />

          <Cluster gap={2}>
            {/* Ink on the pad is not proof. Only the server reading the stored
                object back makes it so. */}
            {signature.finalized ? (
              <Badge tone="success">Signature recorded</Badge>
            ) : hasInk ? (
              <Badge tone="warning">Signed — not recorded yet</Badge>
            ) : (
              <Badge tone="neutral">Not signed</Badge>
            )}
            <Text as="span" size="xs" muted>
              Couranr records the signature when you complete the delivery.
            </Text>
          </Cluster>

          {signature.status === "failed" ? (
            <Alert tone="danger" title="That signature was not recorded">
              {signature.error ?? "Ask the recipient to sign again."}
            </Alert>
          ) : null}
        </Stack>
      </Card>

      <Card>
        <CardHeader title="Who signed" />
        <Field
          label="Signer's first name"
          required
          hint="First name is enough. Couranr does not record anything else about them."
        >
          {(a) => (
            <Input
              {...a}
              value={signerFirstName}
              onChange={(e) => setSignerFirstName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="off"
            />
          )}
        </Field>
      </Card>

      <LocationBlock location={location} />

      {signature.status === "queued" ? (
        <Alert tone="warning" title="Proof is waiting to sync">
          Couranr cannot complete this delivery until the signature is server-verified.{" "}
          <a className="cr-link" href={`/driver/deliveries/${deliveryId}?panel=offline-sync`}>
            Open offline proof sync
          </a>
        </Alert>
      ) : null}

      <CompleteStep
        title="Complete delivery"
        label="Complete delivery"
        loadingLabel="Completing…"
        blockers={blockers}
        error={submitError}
        busy={submitting}
        onSubmit={submit}
      />
    </Stack>
  );
}

/** `toBlob` is callback-shaped and can hand back null; a null is a failure. */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/* ---------------------------------------------------------- leave at door -- */

/**
 * `leave_at_door` — the shipment is left unattended, so the evidence is the
 * whole record.
 *
 * THE STORED PROOF METHOD IS THE AUTHORIZATION. Nobody is asked at the door
 * whether this is allowed: the delivery was created as a leave-at-door
 * delivery, and that stored decision is what permits it. The driver is not
 * granting the permission and cannot change it — the two confirmations below
 * are judgements about THIS doorstep, not consent to the method.
 */
function LeaveAtDoor({ deliveryId, version, location, recordedProof, onDone }: FormProps) {
  const [safeLocation, setSafeLocation] = React.useState(false);
  const [weatherSuitable, setWeatherSuitable] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const photo = useProofUpload({
    deliveryId,
    stage: "dropoff",
    proofType: "delivery_photo",
    location,
    recordedProofId: recordedProof.delivery_photo ?? null,
  });

  const blockers: string[] = [];
  if (!photo.finalized) blockers.push("Record a photo of where you left the shipment.");
  if (!safeLocation) blockers.push("Confirm the spot you are leaving it in is safe.");
  if (!weatherSuitable) blockers.push("Confirm the weather will not damage it there.");
  if (!location.usable) blockers.push(location.message);
  if (version === null) blockers.push(VERSION_BLOCKER);
  const ready = blockers.length === 0;

  async function submit() {
    if (!ready || version === null || submitting) return;
    let fix: { latitude: number; longitude: number; accuracyM: number | null };
    try {
      fix = locationBody(location);
    } catch {
      setSubmitError(location.message);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const r = await completeLeaveAtDoor(deliveryId, {
      expectedVersion: version,
      // The driver's own answers, not constants: these two are the only record
      // that a person judged the spot before leaving a shipment unattended, and
      // the route reads them as strict booleans.
      safeLocation,
      weatherSuitable,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
    });
    setSubmitting(false);
    if (isApiFailure(r)) {
      setSubmitError(withReference(r));
      return;
    }
    onDone(receiptOf(r.value));
  }

  return (
    <Stack gap={6}>
      <MethodCard method="leave_at_door" />

      <Card>
        <CardHeader
          title="Leaving it is authorized"
          description="Couranr recorded leave at door as this delivery's proof method when it was created. That stored decision is the authorization — you are not deciding it here, and it cannot be changed on the road."
          actions={<Badge tone="info">Authorized by Couranr</Badge>}
        />
        <Alert tone="info" title="Nobody has to be there">
          Do not ask the recipient to approve this and do not wait for anyone. If the spot is not
          safe, do not leave it — contact Couranr Operations.
        </Alert>
      </Card>

      <Card>
        <CardHeader
          title="Where you are leaving it"
          description="This photo is the only record of how the shipment was left."
        />
        <Stack gap={4}>
          <PhotoField
            label="Photo of where you left it"
            hint="Show the shipment where you are leaving it, with enough of the doorway to recognise the spot."
            upload={photo}
            blocked={!location.usable}
            blockedReason={location.message}
          />

          <CheckboxRow
            label="This spot is safe and out of sight from the street."
            hint="Sheltered, not blocking a door, and not visible to passers-by."
            checked={safeLocation}
            onChange={(e) => setSafeLocation(e.target.checked)}
          />
          <CheckboxRow
            label="The weather here will not damage this shipment."
            hint="Rain, snow or direct heat where it will sit until it is collected."
            checked={weatherSuitable}
            onChange={(e) => setWeatherSuitable(e.target.checked)}
          />
        </Stack>
      </Card>

      <LocationBlock location={location} />

      {photo.status === "queued" ? (
        <Alert tone="warning" title="Proof is waiting to sync">
          Couranr cannot complete this delivery until the photo is server-verified.{" "}
          <a className="cr-link" href={`/driver/deliveries/${deliveryId}?panel=offline-sync`}>
            Open offline proof sync
          </a>
        </Alert>
      ) : null}

      <CompleteStep
        title="Complete delivery"
        label="Complete delivery"
        loadingLabel="Completing…"
        blockers={blockers}
        error={submitError}
        busy={submitting}
        onSubmit={submit}
      />
    </Stack>
  );
}

/* ------------------------------------------------------------------ parts -- */

/**
 * What the driver is told the proof method is, and that they cannot change it.
 * Never "photo or PIN" — `PROOF_METHOD_LABELS` is the only source of this
 * wording.
 */
function MethodCard({ method }: { method: ProofMethod }) {
  return (
    <Card elevation="quiet">
      <CardHeader
        title="Proof for this delivery"
        description="Couranr fixed this when the delivery was created. It cannot be changed here or on the road."
        actions={<Badge tone="info">{PROOF_METHOD_LABELS[method]}</Badge>}
      />
      <Text size="sm" muted>
        {DRIVER_COMMAND_LABELS[COMPLETION_COMMAND[method]]} is the only step Couranr will accept for
        this delivery.
      </Text>
    </Card>
  );
}

/**
 * The final step, with its reasons listed rather than hidden behind a disabled
 * button. A control that will not respond and will not say why reads as a
 * broken app, and the driver's next move is to call someone.
 */
function CompleteStep({
  title,
  label,
  loadingLabel,
  blockers,
  error,
  busy,
  onSubmit,
}: {
  title: string;
  label: string;
  loadingLabel: string;
  blockers: string[];
  error: string | null;
  busy: boolean;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader title={title} description="This is the only step Couranr will accept now." />
      <Stack gap={3}>
        {blockers.length > 0 ? (
          <Alert tone="warning" title="Still needed before you can finish this delivery">
            <ul className="cr-list">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="danger" title="That delivery could not be completed">
            {error}
          </Alert>
        ) : null}

        <Cluster gap={3}>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel={loadingLabel}
            disabled={blockers.length > 0}
            onClick={() => void onSubmit()}
          >
            {label}
          </Button>
        </Cluster>
      </Stack>
    </Card>
  );
}

/**
 * One photo requirement.
 *
 * SELECTED IS NOT RECORDED. The bytes only become proof once the server has
 * read the stored object back and compared its real size and type against what
 * it authorized; a truncated upload returns HTTP 200 and lands in `failed`
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

/* --------------------------------------------------------------- receipt -- */

/** The completion response carries the receipt, or null if the server withheld one. */
function receiptOf(result: CompletionResult): DriverCompletionReceipt | null {
  return result.receipt ?? null;
}

/**
 * Six fields, and the absences are the point: no address, no recipient contact,
 * no merchant note, no money, no object path and no signed URL. Nothing here
 * asks for a proof-media URL either — a driver's need for the photo ended when
 * the delivery did.
 */
function CompletionReceiptCard({ receipt }: { receipt: DriverCompletionReceipt | null }) {
  if (!receipt) {
    // Completed, but with nothing to show. Saying so beats rendering an empty
    // receipt that reads like the proof was lost.
    return (
      <Card>
        <CardHeader
          title="Delivery completed"
          description="Couranr recorded this delivery."
          actions={<Badge tone="success">{FULFILLMENT_LABELS.delivered}</Badge>}
        />
        <Text size="sm" muted>
          Couranr did not return a receipt with the response. Contact Couranr Operations if you need
          confirmation of this delivery.
        </Text>
      </Card>
    );
  }

  const method = isProofMethod(receipt.proofMethod) ? receipt.proofMethod : null;
  return (
    <Card>
      <CardHeader
        title="Delivery completed"
        description="Couranr has your proof. The delivery details are no longer shown."
        actions={<Badge tone="success">{FULFILLMENT_LABELS.delivered}</Badge>}
      />
      <Stack gap={4}>
        <Grid columns={2}>
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
          <Detail label="Delivery" value={receipt.deliveryId} />
          <Detail label="Assignment" value={receipt.assignmentId} />
        </Grid>
        <Text size="xs" muted>
          Contact Couranr Operations if anything about this delivery needs correcting.
        </Text>
      </Stack>
    </Card>
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
