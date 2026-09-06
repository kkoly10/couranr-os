"use client";

import * as React from "react";
import Link from "next/link";
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
import { Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { ErrorState, LoadingState } from "@/components/couranr/states";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";

type IncidentState="reported"|"under_review"|"awaiting_evidence"|"resolved"|"closed";
type IncidentType=
  |"recipient_unavailable"|"address_access"|"weather_safety"|"damage"
  |"wrong_item"|"missing_item"|"unsafe_handling"|"delivery_failure"|"other";
type Incident={
  id:string;
  request_id:string;
  delivery_id:string;
  return_id:string|null;
  source_discrepancy_id:string|null;
  incident_type:IncidentType;
  incident_state:IncidentState;
  severity:"normal"|"urgent";
  summary:string|null;
  opened_at:string;
  resolved_at:string|null;
  closed_at:string|null;
  version:number;
};
type Command=
  |"start_incident_review"
  |"request_incident_evidence"
  |"add_incident_note"
  |"escalate_incident"
  |"resolve_incident"
  |"close_incident";

const TYPE_LABELS:Record<IncidentType,string>={
  recipient_unavailable:"Recipient unavailable",
  address_access:"Address or access",
  weather_safety:"Weather or safety",
  damage:"Damage or condition",
  wrong_item:"Wrong item",
  missing_item:"Missing item",
  unsafe_handling:"Unsafe handling",
  delivery_failure:"Delivery failure",
  other:"Other",
};
const STATE_LABELS:Record<IncidentState,string>={
  reported:"Reported",
  under_review:"Under review",
  awaiting_evidence:"Awaiting evidence",
  resolved:"Resolved",
  closed:"Closed",
};
const TYPE_OPTIONS=Object.entries(TYPE_LABELS) as Array<[IncidentType,string]>;

function loadIncidents(){
  return call<{incidents:Incident[]}>("/api/couranr/operations/incidents");
}
function openIncident(body:{
  deliveryId:string;incidentType:IncidentType;severity:"normal"|"urgent";summary?:string;
}){
  return call<{incident:Incident}>("/api/couranr/operations/incidents",{method:"POST",body});
}
function actOnIncident(id:string,body:{
  expectedVersion:number;command:Command;note?:string;
}){
  return call<{incident:Incident}>(`/api/couranr/operations/incidents/${id}`,{method:"POST",body});
}

/**
 * OPS-012 — evidence-first incident workspace.
 *
 * No money controls live here. Resolving/closing an incident never refunds,
 * charges, returns or changes fulfillment by implication; those remain named
 * commands on their own governed paths.
 */
export function IncidentsWorkspace(){
  const [rows,setRows]=React.useState<Incident[]|null>(null);
  const [loadError,setLoadError]=React.useState<string|null>(null);
  const [generation,setGeneration]=React.useState(0);

  const reload=React.useCallback(async()=>{
    const r=await loadIncidents();
    if(isApiFailure(r)){
      setRows(null);
      setLoadError(withReference(r));
      return;
    }
    setLoadError(null);
    setRows(Array.isArray(r.value.incidents)?r.value.incidents:[]);
  },[]);

  React.useEffect(()=>{void reload();},[reload,generation]);

  if(loadError){
    return <ErrorState title="Couranr could not load incidents" body={loadError}
      action={{label:"Try again",onClick:()=>setGeneration((g)=>g+1)}}/>;
  }
  if(rows===null) return <LoadingState label="Loading incidents"/>;

  return (
    <Stack gap={6}>
      <Alert tone="info" title="Incident review does not move money or custody">
        Use this workspace to investigate and record evidence. Refunds, delivery cancellation and
        physical returns stay on their own governed commands.
      </Alert>

      <OpenIncident onOpened={()=>setGeneration((g)=>g+1)}/>

      {rows.length===0?(
        <Card>
          <CardHeader title="No incidents"/>
          <Text size="sm" muted>Damage, unavailable recipient, weather and other reviewed delivery problems will appear here.</Text>
        </Card>
      ):(
        <Stack gap={4}>
          {rows.map((row)=>(
            <IncidentCard
              key={row.id}
              incident={row}
              onChanged={(next)=>{
                setRows((current)=>current?.map((x)=>x.id===next.id?next:x)??current);
              }}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function OpenIncident({onOpened}:{onOpened:()=>void}){
  const [deliveryId,setDeliveryId]=React.useState("");
  const [type,setType]=React.useState<IncidentType>("delivery_failure");
  const [severity,setSeverity]=React.useState<"normal"|"urgent">("normal");
  const [summary,setSummary]=React.useState("");
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState<string|null>(null);
  const [open,setOpen]=React.useState(false);

  async function submit(){
    if(busy||!deliveryId.trim()) return;
    setBusy(true);setError(null);
    const r=await openIncident({
      deliveryId:deliveryId.trim(),incidentType:type,severity,summary:summary.trim()||undefined,
    });
    setBusy(false);
    if(isApiFailure(r)){setError(withReference(r));return;}
    setDeliveryId("");setSummary("");setSeverity("normal");setOpen(false);onOpened();
  }

  return (
    <Card>
      <CardHeader
        title="Report or start an incident"
        description="Operations can open a structured record without changing the delivery."
        actions={<Button variant="secondary" onClick={()=>setOpen((v)=>!v)}>{open?"Close form":"Open incident"}</Button>}
      />
      {open?(
        <Stack gap={4}>
          <Grid columns={2}>
            <Field label="Delivery ID" required>
              {(a)=><Input {...a} value={deliveryId} autoComplete="off" onChange={(e)=>setDeliveryId(e.target.value)} placeholder="Delivery UUID"/>}
            </Field>
            <Field label="Incident type" required>
              {(a)=>(
                <Select {...a} value={type} onChange={(e)=>setType(e.target.value as IncidentType)}>
                  {TYPE_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </Select>
              )}
            </Field>
          </Grid>
          <Field label="Priority" required>
            {(a)=>(
              <Select {...a} value={severity} onChange={(e)=>setSeverity(e.target.value as "normal"|"urgent")}>
                <option value="normal">Normal review</option>
                <option value="urgent">Urgent safety / custody review</option>
              </Select>
            )}
          </Field>
          <Field label="Internal summary" hint="Keep this factual. It is an Operations note, not a customer message.">
            {(a)=><Textarea {...a} rows={3} maxLength={2000} value={summary} onChange={(e)=>setSummary(e.target.value)}/>}
          </Field>
          {error?<Alert tone="danger" title="Incident not opened">{error}</Alert>:null}
          <Cluster gap={3}>
            <Button variant="primary" disabled={!deliveryId.trim()} loading={busy} loadingLabel="Opening…" onClick={()=>void submit()}>
              Open incident record
            </Button>
          </Cluster>
        </Stack>
      ):null}
    </Card>
  );
}

function IncidentCard({incident,onChanged}:{incident:Incident;onChanged:(next:Incident)=>void}){
  const [note,setNote]=React.useState("");
  const [busy,setBusy]=React.useState<Command|null>(null);
  const [error,setError]=React.useState<string|null>(null);

  async function run(command:Command){
    if(busy) return;
    if(command==="add_incident_note"&&!note.trim()){
      setError("Write the internal note before saving it.");
      return;
    }
    setBusy(command);setError(null);
    const r=await actOnIncident(incident.id,{
      expectedVersion:incident.version,command,note:note.trim()||undefined,
    });
    setBusy(null);
    if(isApiFailure(r)){setError(withReference(r));return;}
    setNote("");onChanged(r.value.incident);
  }

  const state=incident.incident_state;
  return (
    <Card>
      <CardHeader
        title={TYPE_LABELS[incident.incident_type]}
        description={`Opened ${formatWhen(incident.opened_at)}`}
        actions={
          <Cluster gap={2}>
            {incident.severity==="urgent"?<Badge tone="danger">Urgent</Badge>:null}
            <Badge tone={state==="closed"?"neutral":state==="resolved"?"success":"warning"}>{STATE_LABELS[state]}</Badge>
          </Cluster>
        }
      />
      <Stack gap={4}>
        <Grid columns={2}>
          <div>
            <Text size="xs" muted>Delivery</Text>
            <Text strong><Link href={`/operations/deliveries/${incident.delivery_id}`}>{shortId(incident.delivery_id)}</Link></Text>
          </div>
          <div>
            <Text size="xs" muted>Return custody</Text>
            <Text strong>{incident.return_id?"Linked to a physical return":"No return linked"}</Text>
          </div>
        </Grid>
        {incident.summary?<Text size="sm">{incident.summary}</Text>:null}

        {state!=="closed"?(
          <Field label="Internal note" hint="Saved to the append-only incident event trail.">
            {(a)=><Textarea {...a} rows={2} maxLength={2000} value={note} onChange={(e)=>setNote(e.target.value)}/>}
          </Field>
        ):null}

        {error?<Alert tone="danger" title="Incident action failed">{error}</Alert>:null}

        {state!=="closed"?(
          <Cluster gap={2}>
            {state==="reported"||state==="awaiting_evidence"?(
              <Button variant="secondary" loading={busy==="start_incident_review"} onClick={()=>void run("start_incident_review")}>
                Start review
              </Button>
            ):null}
            {state==="reported"||state==="under_review"?(
              <Button variant="secondary" loading={busy==="request_incident_evidence"} onClick={()=>void run("request_incident_evidence")}>
                Mark awaiting evidence
              </Button>
            ):null}
            <Button variant="ghost" disabled={!note.trim()} loading={busy==="add_incident_note"} onClick={()=>void run("add_incident_note")}>
              Save internal note
            </Button>
            {incident.severity!=="urgent"&&state!=="resolved"?(
              <Button variant="ghost" loading={busy==="escalate_incident"} onClick={()=>void run("escalate_incident")}>
                Escalate urgent
              </Button>
            ):null}
            {state!=="resolved"?(
              <Button variant="primary" loading={busy==="resolve_incident"} onClick={()=>void run("resolve_incident")}>
                Resolve
              </Button>
            ):(
              <Button variant="secondary" loading={busy==="close_incident"} onClick={()=>void run("close_incident")}>
                Close record
              </Button>
            )}
          </Cluster>
        ):(
          <Text size="sm" muted>This incident is closed. Its event history remains immutable.</Text>
        )}

        {state==="awaiting_evidence"?(
          <Alert tone="info" title="Evidence request is a workflow state">
            This does not automatically send a message. Use the delivery support conversation to ask the relevant party for evidence.
          </Alert>
        ):null}
      </Stack>
    </Card>
  );
}

function shortId(id:string){return id.length>12?`${id.slice(0,8)}…`:id;}
function formatWhen(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString();}
