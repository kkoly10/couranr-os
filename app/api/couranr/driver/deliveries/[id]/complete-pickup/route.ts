import { NextRequest, NextResponse } from "next/server";
import { completePickup, isDriverFailure } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toNumber(value:unknown):number|null {
  if(typeof value==="number") return Number.isFinite(value)?value:null;
  if(typeof value==="string"&&value.trim()!=="") {
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  return null;
}

function coordinates(body:any):{latitude:number;longitude:number;accuracyM:number|null}|null {
  const latitude=toNumber(body?.latitude);
  const longitude=toNumber(body?.longitude);
  if(latitude===null||latitude < -90||latitude > 90) return null;
  if(longitude===null||longitude < -180||longitude > 180) return null;
  let accuracyM:number|null=null;
  if(body?.accuracyM!==null&&body?.accuracyM!==undefined) {
    accuracyM=toNumber(body.accuracyM);
    if(accuracyM===null||accuracyM<0) return null;
  }
  return {latitude,longitude,accuracyM};
}

/**
 * V2 custody transition. The browser states only the version and its current
 * location. SQL derives the assignment/vehicle and requires the consumed
 * sender credential, finalized pickup photo, discrepancy clearance and
 * server-derived large-load securement.
 */
export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const auth=await resolveUserId(req);
  if(isActorDenied(auth)) return routeFailure(auth.code,auth.error);
  if(!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");

  let body:any;
  try{body=await req.json();}catch{
    return routeFailure("invalid_input","Expected a JSON body.");
  }
  const expectedVersion=Number(body?.expectedVersion);
  if(!Number.isInteger(expectedVersion)||expectedVersion<1) {
    return routeFailure("invalid_input","A current delivery version is required.");
  }
  const at=coordinates(body);
  if(!at) {
    return routeFailure(
      "invalid_input",
      "Couranr needs your location for this step. Turn on location and try again."
    );
  }

  const result=await completePickup({
    userId:auth.userId,
    deliveryId:id,
    expectedVersion,
    latitude:at.latitude,
    longitude:at.longitude,
    accuracyM:at.accuracyM,
  });
  if(isDriverFailure(result)) return failureResponse(result);
  return NextResponse.json({delivery:result.value});
}
