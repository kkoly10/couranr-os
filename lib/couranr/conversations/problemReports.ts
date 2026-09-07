import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  publicFailure,
  type PublicFailure,
} from "@/lib/couranr/errors";
import type { RequestActor } from "@/lib/couranr/requests/permissions";

assertServerOnly("lib/couranr/conversations/problemReports.ts");

export const CUSTOMER_PROBLEM_TYPES=[
  "damaged","missing","wrong_item","undelivered",
] as const;
export type CustomerProblemType=(typeof CUSTOMER_PROBLEM_TYPES)[number];
export type CustomerProblemState=
  |"draft"|"reported"|"awaiting_evidence"|"under_review"|"resolved";

export const CUSTOMER_PROBLEM_MIME=[
  "image/jpeg","image/png","image/webp","image/heic",
] as const;
export const MAX_CUSTOMER_PROBLEM_BYTES=10*1024*1024;
export const MAX_CUSTOMER_PROBLEM_PHOTOS=5;
const BUCKET="delivery-photos";
const EXT:Record<string,string>={
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic",
};
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProblemReportView={
  id:string;
  problemType:CustomerProblemType;
  details:string;
  state:CustomerProblemState;
  evidenceCount:number;
  submittedAt:string|null;
  resolvedAt:string|null;
  version:number;
  createdAt:string;
};
export type OperationsProblemEvidence={id:string;finalizedAt:string};
export type OperationsProblemReport=ProblemReportView&{
  deliveryId:string;
  requestId:string;
  evidence:OperationsProblemEvidence[];
};
export type ProblemResult<T>={ok:true;value:T}|PublicFailure;
export function isProblemFailure(r:{ok:boolean}):r is PublicFailure{return r.ok===false;}

function dbFail(operation:string,error:any,message?:string):PublicFailure{
  return publicFailure({
    operation,
    code:classifyDatabaseError(error),
    detail:{code:error?.code,message:error?.message},
    message,
  });
}
function rowOf(data:any){return Array.isArray(data)?data[0]:data;}
function mapReport(row:any):ProblemReportView{
  return {
    id:String(row.out_id??row.id),
    problemType:String(row.out_problem_type??row.problem_type) as CustomerProblemType,
    details:String(row.out_details??row.details??""),
    state:String(row.out_report_state??row.report_state) as CustomerProblemState,
    evidenceCount:Number(row.out_evidence_count??row.evidence_count??0),
    submittedAt:(row.out_submitted_at??row.submitted_at??null) as string|null,
    resolvedAt:(row.out_resolved_at??row.resolved_at??null) as string|null,
    version:Number(row.out_version??row.version),
    createdAt:String(row.out_created_at??row.created_at),
  };
}

export async function readCustomerProblemReports(
  tokenId:string
):Promise<ProblemResult<ProblemReportView[]>>{
  const {data,error}=await supabaseAdmin.rpc("couranr_customer_problem_report_view",{
    p_token_id:tokenId,
  });
  if(error)return dbFail("problemReport.read",error);
  return {ok:true,value:(Array.isArray(data)?data:[]).map(mapReport)};
}

export async function saveCustomerProblemDraft(p:{
  tokenId:string;problemType:CustomerProblemType;details:string;
}):Promise<ProblemResult<ProblemReportView>>{
  const {data,error}=await supabaseAdmin.rpc("couranr_save_customer_problem_draft",{
    p_token_id:p.tokenId,p_problem_type:p.problemType,p_details:p.details,
  });
  if(error)return dbFail("problemReport.saveDraft",error);
  const row=rowOf(data);
  if(!row)return publicFailure({operation:"problemReport.saveDraft",code:"internal",detail:"empty"});
  const {count}=await supabaseAdmin
    .from("couranr_customer_problem_evidence")
    .select("id",{count:"exact",head:true})
    .eq("report_id",String(row.id))
    .eq("upload_state","verified");
  return {ok:true,value:mapReport({...row,evidence_count:count??0})};
}

function buildProblemPath(p:{
  deliveryId:string;reportId:string;clientEvidenceId:string;mime:string;
}):string{
  if(!UUID_RE.test(p.deliveryId)||!UUID_RE.test(p.reportId)||!UUID_RE.test(p.clientEvidenceId)){
    throw new Error("problem_evidence_path_requires_uuid");
  }
  const ext=EXT[p.mime];
  if(!ext)throw new Error("problem_evidence_mime_invalid");
  return `customer-problem/v1/${p.deliveryId}/${p.reportId}/${p.clientEvidenceId}/${randomBytes(16).toString("hex")}.${ext}`;
}

export type ProblemEvidenceGrant=
  |{status:"upload";evidenceId:string;signedUrl:string;expectedBytes:number;expectedMime:string}
  |{status:"verified";evidenceId:string};

export async function prepareCustomerProblemEvidence(p:{
  tokenId:string;deliveryId:string;reportId:string;clientEvidenceId:string;
  expectedMime:string;expectedBytes:number;evidenceSha256:string;
}):Promise<ProblemResult<ProblemEvidenceGrant>>{
  if(!(CUSTOMER_PROBLEM_MIME as readonly string[]).includes(p.expectedMime)){
    return publicFailure({
      operation:"problemEvidence.prepare",code:"invalid_input",detail:"mime",
      message:"That file type is not accepted.",
    });
  }
  if(!Number.isInteger(p.expectedBytes)||p.expectedBytes<1||p.expectedBytes>MAX_CUSTOMER_PROBLEM_BYTES){
    return publicFailure({
      operation:"problemEvidence.prepare",code:"invalid_input",detail:"size",
      message:"That photo is too large.",
    });
  }
  if(!/^[0-9a-f]{64}$/.test(p.evidenceSha256)||!UUID_RE.test(p.clientEvidenceId)){
    return publicFailure({operation:"problemEvidence.prepare",code:"invalid_input",detail:"identity"});
  }

  let objectPath:string;
  try{
    objectPath=buildProblemPath({
      deliveryId:p.deliveryId,reportId:p.reportId,
      clientEvidenceId:p.clientEvidenceId,mime:p.expectedMime,
    });
  }catch(error){
    return publicFailure({operation:"problemEvidence.prepare",code:"invalid_input",detail:error});
  }

  const {data,error}=await supabaseAdmin.rpc("couranr_prepare_customer_problem_evidence",{
    p_token_id:p.tokenId,p_report_id:p.reportId,
    p_client_evidence_id:p.clientEvidenceId,p_object_path:objectPath,
    p_expected_mime:p.expectedMime,p_expected_bytes:p.expectedBytes,
    p_evidence_sha256:p.evidenceSha256,
  });
  if(error)return dbFail("problemEvidence.prepare",error);
  const row=rowOf(data);
  if(!row?.id||!row?.object_path){
    return publicFailure({operation:"problemEvidence.prepare",code:"internal",detail:"bad_shape"});
  }
  if(row.upload_state==="verified"){
    return {ok:true,value:{status:"verified",evidenceId:String(row.id)}};
  }
  const {data:signed,error:signError}=await supabaseAdmin.storage
    .from(BUCKET).createSignedUploadUrl(String(row.object_path));
  if(signError||!signed?.signedUrl){
    return publicFailure({
      operation:"problemEvidence.sign",code:"internal",
      detail:{message:signError?.message},
    });
  }
  return {
    ok:true,
    value:{
      status:"upload",evidenceId:String(row.id),signedUrl:signed.signedUrl,
      expectedBytes:Number(row.expected_bytes),expectedMime:String(row.expected_mime),
    },
  };
}

async function readStoredObject(objectPath:string):Promise<{size:number;mime:string}|null>{
  const slash=objectPath.lastIndexOf("/");
  const dir=objectPath.slice(0,slash);
  const name=objectPath.slice(slash+1);
  const {data,error}=await supabaseAdmin.storage.from(BUCKET).list(dir,{search:name,limit:20});
  if(error||!data)return null;
  const found=(data as any[]).find((o:any)=>o.name===name);
  if(!found)return null;
  const size=Number(found?.metadata?.size);
  const mime=String(found?.metadata?.mimetype??"");
  return Number.isFinite(size)?{size,mime}:null;
}

export async function finalizeCustomerProblemEvidence(p:{
  tokenId:string;evidenceId:string;
}):Promise<ProblemResult<{evidenceId:string}>>{
  const {data:auth,error:aErr}=await supabaseAdmin
    .from("couranr_customer_problem_evidence")
    .select("id,object_path,expected_bytes,expected_mime,upload_state")
    .eq("id",p.evidenceId).maybeSingle();
  if(aErr)return dbFail("problemEvidence.authRead",aErr);
  if(!auth)return publicFailure({operation:"problemEvidence.finalize",code:"not_found",detail:"missing"});
  if(auth.upload_state==="verified")return {ok:true,value:{evidenceId:String(auth.id)}};

  const stored=await readStoredObject(String(auth.object_path));
  if(!stored){
    return publicFailure({
      operation:"problemEvidence.finalize",code:"conflict",detail:"object_missing",
      message:"The photo upload did not arrive. Try again.",
    });
  }
  if(stored.size!==Number(auth.expected_bytes)||stored.mime!==String(auth.expected_mime)){
    return publicFailure({
      operation:"problemEvidence.finalize",code:"conflict",
      detail:{reason:"storage_mismatch",size:stored.size,mime:stored.mime},
      message:"The photo upload arrived incomplete. Try again.",
    });
  }

  const {data,error}=await supabaseAdmin.rpc("couranr_finalize_customer_problem_evidence",{
    p_token_id:p.tokenId,p_evidence_id:p.evidenceId,
    p_actual_path:String(auth.object_path),p_actual_bytes:stored.size,p_actual_mime:stored.mime,
  });
  if(error)return dbFail("problemEvidence.finalize",error);
  const row=rowOf(data);
  if(!row?.id)return publicFailure({operation:"problemEvidence.finalize",code:"internal",detail:"empty"});
  return {ok:true,value:{evidenceId:String(row.id)}};
}

export async function submitCustomerProblemReport(p:{
  tokenId:string;reportId:string;idempotencyKey:string;
}):Promise<ProblemResult<ProblemReportView>>{
  const {data,error}=await supabaseAdmin.rpc("couranr_submit_customer_problem_report",{
    p_token_id:p.tokenId,p_report_id:p.reportId,p_idempotency_key:p.idempotencyKey,
  });
  if(error)return dbFail("problemReport.submit",error);
  const row=rowOf(data);
  if(!row)return publicFailure({operation:"problemReport.submit",code:"internal",detail:"empty"});
  const {count}=await supabaseAdmin
    .from("couranr_customer_problem_evidence")
    .select("id",{count:"exact",head:true})
    .eq("report_id",String(row.id)).eq("upload_state","verified");
  return {ok:true,value:mapReport({...row,evidence_count:count??0})};
}

function requireOperations(actor:RequestActor,operation:string):PublicFailure|null{
  if(actor.kind==="operations")return null;
  return publicFailure({operation,code:"not_permitted",detail:"not_operations"});
}

export async function listOperationsProblemReports(
  actor:RequestActor
):Promise<ProblemResult<OperationsProblemReport[]>>{
  const denied=requireOperations(actor,"problemReport.operations.list");
  if(denied)return denied;
  const {data,error}=await supabaseAdmin
    .from("couranr_customer_problem_reports")
    .select("id,request_id,delivery_id,problem_type,details,report_state,submitted_at,resolved_at,version,created_at")
    .neq("report_state","draft")
    .order("created_at",{ascending:false})
    .limit(200);
  if(error)return dbFail("problemReport.operations.list",error);
  const ids=(data??[]).map((r:any)=>String(r.id));
  let evidence:any[]=[];
  if(ids.length){
    const e=await supabaseAdmin
      .from("couranr_customer_problem_evidence")
      .select("id,report_id,finalized_at")
      .in("report_id",ids)
      .eq("upload_state","verified")
      .order("finalized_at",{ascending:true});
    if(e.error)return dbFail("problemReport.operations.evidence",e.error);
    evidence=e.data??[];
  }
  return {
    ok:true,
    value:(data??[]).map((r:any)=>({
      ...mapReport({
        ...r,evidence_count:evidence.filter((e:any)=>String(e.report_id)===String(r.id)).length,
      }),
      deliveryId:String(r.delivery_id),requestId:String(r.request_id),
      evidence:evidence
        .filter((e:any)=>String(e.report_id)===String(r.id))
        .map((e:any)=>({id:String(e.id),finalizedAt:String(e.finalized_at)})),
    })),
  };
}

export type ProblemReportOperationsCommand="start_review"|"request_evidence"|"resolve_report";

export async function transitionOperationsProblemReport(p:{
  actor:RequestActor;reportId:string;expectedVersion:number;
  command:ProblemReportOperationsCommand;
}):Promise<ProblemResult<ProblemReportView>>{
  const denied=requireOperations(p.actor,"problemReport.operations.transition");
  if(denied)return denied;
  const userId=(p.actor as Extract<RequestActor,{kind:"operations"}>).userId;
  const {data,error}=await supabaseAdmin.rpc("couranr_transition_customer_problem_report",{
    p_report_id:p.reportId,p_expected_version:p.expectedVersion,
    p_actor_user_id:userId,p_command:p.command,
  });
  if(error)return dbFail("problemReport.operations.transition",error);
  const row=rowOf(data);
  if(!row)return publicFailure({operation:"problemReport.operations.transition",code:"internal",detail:"empty"});
  const {count}=await supabaseAdmin
    .from("couranr_customer_problem_evidence")
    .select("id",{count:"exact",head:true})
    .eq("report_id",p.reportId).eq("upload_state","verified");
  return {ok:true,value:mapReport({...row,evidence_count:count??0})};
}

export async function signedOperationsProblemEvidenceUrl(p:{
  actor:RequestActor;reportId:string;evidenceId:string;
}):Promise<ProblemResult<{url:string;expiresInSeconds:number}>>{
  const denied=requireOperations(p.actor,"problemEvidence.operations.url");
  if(denied)return denied;
  const {data,error}=await supabaseAdmin
    .from("couranr_customer_problem_evidence")
    .select("id,report_id,storage_bucket,object_path,upload_state")
    .eq("id",p.evidenceId).eq("report_id",p.reportId).maybeSingle();
  if(error)return dbFail("problemEvidence.operations.read",error);
  if(!data||data.upload_state!=="verified"){
    return publicFailure({operation:"problemEvidence.operations.url",code:"not_found",detail:"missing"});
  }
  const ttl=900;
  const {data:signed,error:sErr}=await supabaseAdmin.storage
    .from(String(data.storage_bucket)).createSignedUrl(String(data.object_path),ttl);
  if(sErr||!signed?.signedUrl){
    return publicFailure({operation:"problemEvidence.operations.url",code:"internal",detail:sErr});
  }
  return {ok:true,value:{url:signed.signedUrl,expiresInSeconds:ttl}};
}
