import { NextRequest,NextResponse } from "next/server";
import { isActorDenied,resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse,routeFailure } from "@/lib/couranr/requests/respond";
import {
  isProblemFailure,listOperationsProblemReports,
} from "@/lib/couranr/conversations/problemReports";

export const dynamic="force-dynamic";

export async function GET(req:NextRequest){
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor))return routeFailure(actor.code,actor.error);
  const r=await listOperationsProblemReports(actor.actor);
  if(isProblemFailure(r))return failureResponse(r);
  return NextResponse.json({reports:r.value});
}
