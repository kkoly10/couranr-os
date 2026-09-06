import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { isDriverFailure, startReturn } from "@/lib/couranr/driver/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const auth=await resolveUserId(req);
  if(isActorDenied(auth)) return routeFailure(auth.code,auth.error);
  if(!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");
  let body:any; try{body=await req.json();}catch{return routeFailure("invalid_input","Reload this return and try again.");}
  const expectedVersion=Number(body?.expectedVersion);
  if(!Number.isInteger(expectedVersion)||expectedVersion<1) return routeFailure("invalid_input","Reload this return and try again.");
  const r=await startReturn({userId:auth.userId,deliveryId:id,expectedVersion});
  if(isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({delivery:r.value});
}
