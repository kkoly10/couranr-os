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
import { Field, Input } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { PIN_OUTCOME_MESSAGES, type PinOutcome } from "@/lib/couranr/driver/states";
import {
  completeReturnFromBrowser,
  fetchMyProof,
  verifyReturnCode,
  type AssignedDeliveryView,
} from "./client";
import { useProofUpload } from "./useProofUpload";
import { LocationBlock } from "./PickupFlow";
import type { LocationState } from "./useLocationCapture";

const MAX_PIN_LENGTH=6;

const TONE:Record<PinOutcome,"success"|"warning"|"danger">={
  accepted:"success",
  invalid:"warning",
  locked:"danger",
  expired:"warning",
};

/**
 * Return handoff is intentionally smaller than drop-off:
 * one sender return credential + one condition photo captured at the sender.
 * The photo is crash-safe/offline-safe through the same encrypted queue as
 * pickup/drop-off proof. Completion carries neither proof identity nor PIN.
 */
export function ReturnFlow({
  assigned,
  version,
  location,
}:{
  assigned:AssignedDeliveryView;
  version:number|null;
  location:LocationState;
}) {
  const [pin,setPin]=React.useState("");
  const [pinOutcome,setPinOutcome]=React.useState<PinOutcome|null>(null);
  const [pinBusy,setPinBusy]=React.useState(false);
  const [pinError,setPinError]=React.useState<string|null>(null);
  const [recordedProofId,setRecordedProofId]=React.useState<string|null>(null);
  const [loadingExisting,setLoadingExisting]=React.useState(true);
  const [submitting,setSubmitting]=React.useState(false);
  const [submitError,setSubmitError]=React.useState<string|null>(null);
  const [completed,setCompleted]=React.useState(false);

  React.useEffect(()=>{
    let live=true;
    void fetchMyProof(assigned.deliveryId).then((r)=>{
      if(!live) return;
      setLoadingExisting(false);
      if(isApiFailure(r)) return;
      const proof=(r.value.proof??[]).find(
        (p)=>p.proofStage==="return"&&p.proofType==="return_condition_photo"
      );
      setRecordedProofId(proof?.proofId??null);
      if(r.value.returnCredentialVerified) setPinOutcome("accepted");
    });
    return()=>{live=false;};
  },[assigned.deliveryId]);

  const photo=useProofUpload({
    deliveryId:assigned.deliveryId,
    stage:"return",
    proofType:"return_condition_photo",
    location,
    recordedProofId,
    onFinalized:(proofId)=>setRecordedProofId(proofId),
  });

  async function checkPin() {
    if(pinBusy||pin.length!==MAX_PIN_LENGTH) return;
    setPinBusy(true);
    setPinError(null);
    const r=await verifyReturnCode(assigned.deliveryId,pin);
    setPin("");
    setPinBusy(false);
    if(isApiFailure(r)){
      setPinError(withReference(r));
      return;
    }
    setPinOutcome(r.value.outcome);
  }

  async function complete() {
    if(submitting||version===null||pinOutcome!=="accepted"||!photo.finalized) return;
    setSubmitting(true);
    setSubmitError(null);
    const r=await completeReturnFromBrowser(assigned.deliveryId,version);
    setSubmitting(false);
    if(isApiFailure(r)){
      setSubmitError(withReference(r));
      return;
    }
    setCompleted(true);
  }

  if(completed) {
    return (
      <Card>
        <CardHeader
          title="Return completed"
          description="Couranr recorded the sender handoff and condition proof."
          actions={<Badge tone="success">Returned</Badge>}
        />
        <Text size="sm">
          The shipment is back with the sender. Couranr Operations keeps the incident and any
          financial follow-up separate from this custody confirmation.
        </Text>
      </Card>
    );
  }

  const blockers:string[]=[];
  if(version===null) blockers.push("Reload this delivery so Couranr can confirm its current version.");
  if(pinOutcome!=="accepted") blockers.push("Check the six-digit return code with the sender.");
  if(photo.status==="queued") blockers.push("Wait for the saved return photo to sync with Couranr.");
  else if(!photo.finalized) blockers.push("Take one condition photo of the shipment back with the sender.");

  return (
    <Stack gap={4}>
      <Card>
        <CardHeader
          title="Return to sender"
          description="Take the shipment back to the original pickup address. Do not hand it off elsewhere."
          actions={<Badge tone="warning">Return custody</Badge>}
        />
        <Text size="sm">
          The sender confirms the handoff with a separate return code. Pickup and recipient
          credentials cannot be reused here.
        </Text>
      </Card>

      <Card>
        <CardHeader
          title="Return condition photo"
          description="One photo of what you are physically returning. Couranr saves it securely before upload starts."
        />
        <Stack gap={3}>
          <LocationBlock location={location}/>
          {loadingExisting ? <Text size="sm" muted>Checking existing proof…</Text> : null}
          {photo.finalized ? (
            <Alert tone="success" title="Return photo verified">
              Couranr already has this condition photo. Do not take it again.
            </Alert>
          ) : (
            <Field
              label="Condition photo"
              required
              hint="Show the shipment as it is handed back to the sender."
            >
              {(a)=>(
                <Input
                  {...a}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  capture="environment"
                  disabled={!location.usable||photo.status==="reading"||photo.status==="authorizing"||photo.status==="uploading"||photo.status==="finalizing"}
                  onChange={(e)=>{
                    const file=e.target.files?.[0];
                    if(file) void photo.upload(file);
                  }}
                />
              )}
            </Field>
          )}
          {photo.status==="queued" ? (
            <Alert tone="warning" title="Saved on this device">
              The encrypted proof is safe locally and will retry with the exact captured bytes. Do not
              take a replacement photo.
            </Alert>
          ) : null}
          {photo.error ? <Alert tone="warning" title="Proof status">{photo.error}</Alert> : null}
        </Stack>
      </Card>

      <Card>
        <CardHeader
          title="Sender return code"
          description="Ask the sender for the six-digit code only when the shipment is physically back with them."
        />
        <Stack gap={3}>
          <Field label="Six-digit return code" required>
            {(a)=>(
              <Input
                {...a}
                value={pin}
                inputMode="numeric"
                autoComplete="off"
                maxLength={MAX_PIN_LENGTH}
                placeholder="000000"
                disabled={pinBusy||pinOutcome==="accepted"||pinOutcome==="locked"}
                onChange={(e)=>setPin(e.target.value.replace(/\D/g,"").slice(0,MAX_PIN_LENGTH))}
              />
            )}
          </Field>
          <Cluster gap={3}>
            <Button
              variant="primary"
              disabled={pin.length!==MAX_PIN_LENGTH||pinOutcome==="accepted"}
              loading={pinBusy}
              loadingLabel="Checking…"
              onClick={()=>void checkPin()}
            >
              Check return code
            </Button>
            {pinOutcome==="accepted"?<Badge tone="success">Code accepted</Badge>:null}
          </Cluster>
          {pinOutcome?(
            <Alert tone={TONE[pinOutcome]} title="Return code">
              {pinOutcome==="accepted"
                ?"Return code accepted."
                :PIN_OUTCOME_MESSAGES[pinOutcome]}
            </Alert>
          ):null}
          {pinError?<Alert tone="danger" title="Couranr could not check that code">{pinError}</Alert>:null}
        </Stack>
      </Card>

      <Card>
        <CardHeader title="Confirm return"/>
        <Stack gap={3}>
          {blockers.length?(
            <Alert tone="warning" title="Still needed before the return can close">
              <ul className="cr-list">
                {blockers.map((b)=><li key={b}>{b}</li>)}
              </ul>
            </Alert>
          ):null}
          {submitError?<Alert tone="danger" title="Return not completed">{submitError}</Alert>:null}
          <Cluster gap={3}>
            <Button
              variant="primary"
              disabled={blockers.length>0}
              loading={submitting}
              loadingLabel="Confirming…"
              onClick={()=>void complete()}
            >
              Confirm return to sender
            </Button>
          </Cluster>
        </Stack>
      </Card>
    </Stack>
  );
}
