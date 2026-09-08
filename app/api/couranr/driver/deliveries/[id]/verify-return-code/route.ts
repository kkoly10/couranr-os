import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { isDriverFailure, verifyReturnPin } from "@/lib/couranr/driver/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CODE_LENGTH=32;

export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const auth=await resolveUserId(req);
  if(isActorDenied(auth)) return routeFailure(auth.code,auth.error);
  if(!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");
  let body:any; try{body=await req.json();}catch{return routeFailure("invalid_input","Expected a JSON body.");}
  const code=typeof body?.code==="string"?body.code.trim():"";
  if(code.length>MAX_CODE_LENGTH) return NextResponse.json({outcome:"invalid"});
  const r=await verifyReturnPin({userId:auth.userId,deliveryId:id,code});
  if(isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({outcome:r.value.outcome});
}
