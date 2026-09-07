import { NextRequest,NextResponse } from "next/server";
import { failureResponse,routeFailure } from "@/lib/couranr/requests/respond";
import {
  isHelpFailure,isWellFormedHelpToken,redeemHelpToken,
} from "@/lib/couranr/conversations/help";
import {
  CUSTOMER_PROBLEM_TYPES,
  finalizeCustomerProblemEvidence,
  isProblemFailure,
  prepareCustomerProblemEvidence,
  saveCustomerProblemDraft,
  submitCustomerProblemReport,
  type CustomerProblemType,
} from "@/lib/couranr/conversations/problemReports";

export const dynamic="force-dynamic";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function refuse(){return routeFailure("not_found","This help link is not available.");}

export async function POST(req:NextRequest,ctx:{params:Promise<{token:string}>}){
  const token=(await ctx.params)?.token;
  if(!isWellFormedHelpToken(token))return refuse();
  const link=await redeemHelpToken(token);
  if(isHelpFailure(link))return refuse();

  let body:any;
  try{body=await req.json();}
  catch{return routeFailure("invalid_input","Expected a delivery problem request.");}

  if(body?.command==="save_draft"){
    const problemType=body?.problemType as CustomerProblemType;
    const details=typeof body?.details==="string"?body.details:"";
    if(!(CUSTOMER_PROBLEM_TYPES as readonly unknown[]).includes(problemType)){
      return routeFailure("invalid_input","Choose what went wrong.");
    }
    if(details.length>4000)return routeFailure("invalid_input","Keep the details under 4000 characters.");
    const r=await saveCustomerProblemDraft({
      tokenId:link.value.tokenId,problemType,details,
    });
    if(isProblemFailure(r))return failureResponse(r);
    return NextResponse.json({report:r.value});
  }

  if(body?.command==="prepare_evidence"){
    const reportId=typeof body?.reportId==="string"?body.reportId:"";
    const clientEvidenceId=typeof body?.clientEvidenceId==="string"?body.clientEvidenceId:"";
    if(!UUID_RE.test(reportId)||!UUID_RE.test(clientEvidenceId)){
      return routeFailure("invalid_input","That photo request is not valid.");
    }
    const r=await prepareCustomerProblemEvidence({
      tokenId:link.value.tokenId,deliveryId:link.value.deliveryId,
      reportId,clientEvidenceId,
      expectedMime:typeof body?.expectedMime==="string"?body.expectedMime:"",
      expectedBytes:Number(body?.expectedBytes),
      evidenceSha256:typeof body?.evidenceSha256==="string"
        ?body.evidenceSha256.toLowerCase():"",
    });
    if(isProblemFailure(r))return failureResponse(r);
    return NextResponse.json({upload:r.value});
  }

  if(body?.command==="finalize_evidence"){
    const evidenceId=typeof body?.evidenceId==="string"?body.evidenceId:"";
    if(!UUID_RE.test(evidenceId))return routeFailure("invalid_input","That photo is not valid.");
    const r=await finalizeCustomerProblemEvidence({
      tokenId:link.value.tokenId,evidenceId,
    });
    if(isProblemFailure(r))return failureResponse(r);
    return NextResponse.json({evidence:r.value});
  }

  if(body?.command==="submit_report"){
    const reportId=typeof body?.reportId==="string"?body.reportId:"";
    const idempotencyKey=typeof body?.idempotencyKey==="string"?body.idempotencyKey.trim():"";
    if(!UUID_RE.test(reportId))return routeFailure("invalid_input","That report is not valid.");
    if(!idempotencyKey)return routeFailure("invalid_input","An idempotency key is required.");
    const r=await submitCustomerProblemReport({
      tokenId:link.value.tokenId,reportId,idempotencyKey,
    });
    if(isProblemFailure(r))return failureResponse(r);
    return NextResponse.json({report:r.value});
  }

  return routeFailure("invalid_input","Choose a valid delivery problem action.");
}
