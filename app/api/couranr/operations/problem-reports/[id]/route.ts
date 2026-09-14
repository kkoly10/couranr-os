import { NextRequest,NextResponse } from "next/server";
import { isActorDenied,resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse,routeFailure } from "@/lib/couranr/requests/respond";
import {
  isProblemFailure,
  signedOperationsProblemEvidenceUrl,
  transitionOperationsProblemReport,
  type ProblemReportOperationsCommand,
} from "@/lib/couranr/conversations/problemReports";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMANDS=new Set<ProblemReportOperationsCommand>([
  "start_review","request_evidence","resolve_report",
]);

export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){
  const id=(await ctx.params)?.id;
  const evidenceId=new URL(req.url).searchParams.get("evidenceId")??"";
  if(!UUID_RE.test(id)||!UUID_RE.test(evidenceId)){
    return routeFailure("not_found","Problem evidence not found.");
  }
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor))return routeFailure(actor.code,actor.error);
  const r=await signedOperationsProblemEvidenceUrl({
    actor:actor.actor,reportId:id,evidenceId,
  });
  if(isProblemFailure(r))return failureResponse(r);
  return NextResponse.json(r.value);
}

export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){
  const id=(await ctx.params)?.id;
  if(!UUID_RE.test(id))return routeFailure("not_found","Problem report not found.");
  const actor=await resolveRequestActor(req,null);
  if(isActorDenied(actor))return routeFailure(actor.code,actor.error);
  let body:any;
  try{body=await req.json();}
  catch{return routeFailure("invalid_input","Expected a report action.");}
  const expectedVersion=Number(body?.expectedVersion);
  const command=body?.command as ProblemReportOperationsCommand;
  if(!Number.isInteger(expectedVersion)||expectedVersion<1){
    return routeFailure("invalid_input","Reload this report and try again.");
  }
  if(!COMMANDS.has(command))return routeFailure("invalid_input","Choose a valid report action.");
  const r=await transitionOperationsProblemReport({
    actor:actor.actor,reportId:id,expectedVersion,command,
  });
  if(isProblemFailure(r))return failureResponse(r);
  return NextResponse.json({report:r.value});
}
