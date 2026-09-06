import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { canActOnDeliveryRequest } from "@/lib/couranr/requests/permissions";
import {
  isPickupManifestFailure,
  setBusinessPickupManifest,
} from "@/lib/couranr/pickup/manifest";
import { normalizePickupManifestInput } from "@/lib/couranr/pickup/types";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  if(!UUID_RE.test(id)) return routeFailure("not_found","Delivery request not found.");
  let body:any;
  try{body=await req.json();}catch{return routeFailure("invalid_input","Expected a JSON body.");}
  const businessAccountId=String(body?.businessAccountId??"");
  if(!UUID_RE.test(businessAccountId)) return routeFailure("invalid_input","A business account is required.");
  const expectedManifestVersion=Number(body?.expectedManifestVersion);
  if(!Number.isInteger(expectedManifestVersion)||expectedManifestVersion<0) {
    return routeFailure("invalid_input","A current pickup-details version is required.");
  }
  const manifest=normalizePickupManifestInput(body);
  if(manifest.ok === false) return routeFailure("invalid_input",manifest.message);

  const actor=await resolveRequestActor(req,businessAccountId);
  if(isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  const permission=canActOnDeliveryRequest(actor.actor,"submit",businessAccountId);
  if(!permission.allowed) return routeFailure("not_permitted","Your role cannot edit pickup details.");

  const result=await setBusinessPickupManifest({
    requestId:id,businessAccountId,actorUserId:actor.userId,
    expectedManifestVersion,manifest:manifest.value,
  });
  if(isPickupManifestFailure(result)) return failureResponse(result);
  return NextResponse.json({pickupManifest:result.value});
}
