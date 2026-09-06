import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, issueHandoffCode } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  if(!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");
  const r=await issueHandoffCode({actorUserId:actor.userId,deliveryId:id,kind:"merchant_return"});
  if(isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({handoffCode:r.value});
}
