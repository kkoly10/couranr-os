import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  INCIDENT_TYPES,
  isReturnFailure,
  listIncidents,
  openIncident,
} from "@/lib/couranr/fulfillment/returns";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req:NextRequest) {
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  const r=await listIncidents();
  if(isReturnFailure(r)) return failureResponse(r);
  return NextResponse.json({incidents:r.value});
}

export async function POST(req:NextRequest) {
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  let body:any; try{body=await req.json();}catch{return routeFailure("invalid_input","Expected an incident report.");}
  const deliveryId=typeof body?.deliveryId==="string"?body.deliveryId:"";
  const incidentType=body?.incidentType;
  const severity=body?.severity;
  const summary=typeof body?.summary==="string"?body.summary.trim():"";
  if(!UUID_RE.test(deliveryId)) return routeFailure("invalid_input","Choose a delivery.");
  if(!(INCIDENT_TYPES as readonly unknown[]).includes(incidentType)) return routeFailure("invalid_input","Choose an incident type.");
  if(severity!=="normal"&&severity!=="urgent") return routeFailure("invalid_input","Choose an incident priority.");
  if(summary.length>2000) return routeFailure("invalid_input","That incident summary is too long.");
  const r=await openIncident({actor:actor.actor,deliveryId,incidentType,severity,summary:summary||null});
  if(isReturnFailure(r)) return failureResponse(r);
  return NextResponse.json({incident:r.value});
}
