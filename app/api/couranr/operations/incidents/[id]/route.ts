import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isReturnFailure, transitionIncident, type IncidentCommand } from "@/lib/couranr/fulfillment/returns";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMANDS=new Set<IncidentCommand>([
 "start_incident_review","request_incident_evidence","resolve_incident","close_incident"
]);

export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  if(!UUID_RE.test(id)) return routeFailure("not_found","Incident not found.");
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  let body:any; try{body=await req.json();}catch{return routeFailure("invalid_input","Expected an incident action.");}
  const expectedVersion=Number(body?.expectedVersion);
  const command=body?.command as IncidentCommand;
  const note=typeof body?.note==="string"?body.note.trim():"";
  if(!Number.isInteger(expectedVersion)||expectedVersion<1) return routeFailure("invalid_input","Reload this incident and try again.");
  if(!COMMANDS.has(command)) return routeFailure("invalid_input","Choose a valid incident action.");
  if(note.length>2000) return routeFailure("invalid_input","That incident note is too long.");
  const r=await transitionIncident({actor:actor.actor,incidentId:id,expectedVersion,command,note:note||null});
  if(isReturnFailure(r)) return failureResponse(r);
  return NextResponse.json({incident:r.value});
}
