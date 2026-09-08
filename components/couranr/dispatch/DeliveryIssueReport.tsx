"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import {
  DISCREPANCY_REASON_LABELS,
  DROPOFF_EXCEPTION_REASON_LABELS,
} from "@/lib/couranr/driver/states";
import { reportDiscrepancy } from "./client";
import { LocationBlock } from "./PickupFlow";
import { locationBody, type LocationState } from "./useLocationCapture";

const OPTIONS = [
  ["recipient_unavailable", "The recipient is not available"],
  ["address_or_access_problem", "The address or access is a problem"],
  ["weather_or_safety", "Weather or conditions are not safe"],
  ["visible_damage", DISCREPANCY_REASON_LABELS.visible_damage],
  ["unsafe_packaging", DISCREPANCY_REASON_LABELS.unsafe_packaging],
  ["wrong_item", DISCREPANCY_REASON_LABELS.wrong_item],
  ["other", DISCREPANCY_REASON_LABELS.other],
] as const;
const MAX_NOTES=500;

/**
 * Post-pickup issue capture. The location is evidence of WHERE the driver
 * stopped; if a return becomes necessary it is the immutable origin candidate
 * for the later REF-003 route quote. Reporting itself never moves custody or money.
 */
export function DeliveryIssueReport({
  deliveryId,
  location,
  onReported,
}:{
  deliveryId:string;
  location:LocationState;
  onReported:()=>void;
}) {
  const [open,setOpen]=React.useState(false);
  const [reason,setReason]=React.useState("");
  const [notes,setNotes]=React.useState("");
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState<string|null>(null);
  const [reported,setReported]=React.useState<string|null>(null);

  async function submit(){
    if(busy||!reason||!location.usable) return;
    let fix:{latitude:number;longitude:number;accuracyM:number|null};
    try{fix=locationBody(location);}
    catch{setError(location.message);return;}
    setBusy(true);setError(null);
    const r=await reportDiscrepancy(deliveryId,{
      stage:"dropoff",
      reason,
      notes:notes.trim()||undefined,
      ...fix,
    });
    setBusy(false);
    if(isApiFailure(r)){setError(withReference(r));return;}
    setReported(reason);
    setOpen(false);
    onReported();
  }

  if(reported){
    const label =
      DROPOFF_EXCEPTION_REASON_LABELS[reported] ??
      DISCREPANCY_REASON_LABELS[reported as keyof typeof DISCREPANCY_REASON_LABELS] ??
      reported.replace(/_/g," ");
    return (
      <Card id="report-issue">
        <CardHeader title="Delivery issue reported" actions={<Badge tone="warning">Operations review</Badge>}/>
        <Stack gap={2}>
          <Text size="sm">{label}</Text>
          <Alert tone="warning" title="Keep custody until Couranr decides">
            The report records where you stopped. It does not authorize a handoff, return, price change, or cancellation.
          </Alert>
        </Stack>
      </Card>
    );
  }

  return (
    <Card id="report-issue">
      <CardHeader
        title="Something is blocking this delivery?"
        description="Stop safely first. Report the issue and Couranr Operations decides the next custody step."
        actions={
          <Button variant="secondary" onClick={()=>setOpen((v)=>!v)}>
            {open?"Close":"Report issue"}
          </Button>
        }
      />
      {open?(
        <Stack gap={4}>
          <Alert tone="info" title="Your stop location is part of the evidence">
            Couranr records the location only when you submit this issue. If a return is required later,
            the system keeps this capture instead of substituting your retry-time location.
          </Alert>
          <LocationBlock location={location}/>
          <Field label="What is blocking the delivery?" required>
            {(a)=>(
              <Select {...a} value={reason} onChange={(e)=>setReason(e.target.value)}>
                <option value="">Choose the closest reason</option>
                {OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="What happened?" hint={`${Math.max(0,MAX_NOTES-notes.length)} characters left.`}>
            {(a)=>(
              <Textarea {...a} rows={3} maxLength={MAX_NOTES} value={notes}
                onChange={(e)=>setNotes(e.target.value.slice(0,MAX_NOTES))}/>
            )}
          </Field>
          {error?<Alert tone="danger" title="That issue was not sent">{error}</Alert>:null}
          <Cluster gap={3}>
            <Button
              variant="secondary"
              disabled={!reason||!location.usable}
              loading={busy}
              loadingLabel="Reporting…"
              onClick={()=>void submit()}
            >
              Report to Operations
            </Button>
          </Cluster>
        </Stack>
      ):null}
    </Card>
  );
}
