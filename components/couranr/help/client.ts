"use client";

import type { CustomerTopic } from "@/lib/couranr/conversations/states";
import type { HelpLifecycleStatus } from "@/lib/couranr/conversations/helpStatusStates";
import type {
  HelpResolutionPolicy,
  HelpResolutionReason,
} from "@/lib/couranr/conversations/helpResolutionTypes";

/**
 * Browser data access for Delivery Help.
 *
 * NOT the Bearer-token helper used by the merchant and driver surfaces: this
 * page has no session and never will. The recipient of a delivery has no
 * Couranr account, so the token in the URL is the whole authorization — carried
 * in the path exactly as the tracking link is.
 *
 * Unlike the tracking client, this one DOES have a mutating authority:
 * appending a message to one thread. CUS-002 adds a second presentation path
 * to that SAME write — a structured review request that still becomes a help
 * message. Neither path can change an address, price, payer, cancellation,
 * refund, return, proof, custody or lifecycle state.
 */

export type HelpMessage = {
  id: string;
  authoredByPerson: boolean;
  authorParticipantId: string | null;
  topic: CustomerTopic | null;
  body: string;
  createdAt: string;
};

export type HelpView = {
  conversationId: string;
  messages: HelpMessage[];
  topics: readonly CustomerTopic[];
  supportTargetMinutes: number;
  operatingHoursApplied: boolean;
  supportPhone: null;
  returnStatus: HelpLifecycleStatus;
  resolutionPolicy: HelpResolutionPolicy;
  problemReports: ProblemReportView[] | null;
};

export type ProblemType="damaged"|"missing"|"wrong_item"|"undelivered";
export type ProblemState="draft"|"reported"|"awaiting_evidence"|"under_review"|"resolved";
export type ProblemReportView={
  id:string;
  problemType:ProblemType;
  details:string;
  state:ProblemState;
  evidenceCount:number;
  submittedAt:string|null;
  resolvedAt:string|null;
  version:number;
  createdAt:string;
};

export type HelpLoad =
  | { resolved: true; view: HelpView }
  | { resolved: false }
  | { failed: true };

/**
 * A REFUSAL AND A FAILURE ARE DIFFERENT THINGS.
 *
 * 404 means the server declined the link, and the page says so in one fixed
 * sentence with no retry, because retrying resolves nothing. Anything else — a
 * 500, an offline browser, a body that is not JSON — means the page could not
 * find out, and telling someone their link is dead because the network blinked
 * is the wrong answer. Only one of the two offers a retry.
 */
export async function fetchHelp(token: string): Promise<HelpLoad> {
  let res: Response;
  try {
    res = await fetch(`/api/couranr/help/${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    return { failed: true };
  }

  if (res.status === 404) return { resolved: false };
  if (!res.ok) return { failed: true };

  try {
    const payload = await res.json();
    if (!Array.isArray(payload?.messages)) return { failed: true };
    if (!payload?.returnStatus || typeof payload.returnStatus.available !== "boolean") {
      return { failed: true };
    }
    if (
      !payload?.resolutionPolicy ||
      typeof payload.resolutionPolicy.available !== "boolean"
    ) {
      return { failed: true };
    }
    if (!(payload?.problemReports === null || Array.isArray(payload?.problemReports))) {
      return { failed: true };
    }
    return { resolved: true, view: payload as HelpView };
  } catch {
    return { failed: true };
  }
}

export type ResolutionRequestOutcome =
  | { sent: true; messageId: string; requestKind: string }
  | { sent: false; reason: string };

export async function submitResolutionRequest(params: {
  token: string;
  reason: HelpResolutionReason;
  note: string;
  idempotencyKey: string;
}): Promise<ResolutionRequestOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `/api/couranr/help/${encodeURIComponent(params.token)}/resolution-request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          reason: params.reason,
          note: params.note,
          idempotencyKey: params.idempotencyKey,
        }),
      }
    );
  } catch {
    return {
      sent: false,
      reason: "We could not send that request. Check your connection and try again.",
    };
  }

  if (res.ok) {
    try {
      const payload = await res.json();
      if (typeof payload?.messageId !== "string") throw new Error("missing message id");
      return {
        sent: true,
        messageId: payload.messageId,
        requestKind: String(payload?.requestKind ?? ""),
      };
    } catch {
      return {
        sent: false,
        reason: "We could not confirm that request was sent. Try again.",
      };
    }
  }

  try {
    const payload = await res.json();
    if (
      (res.status === 400 || res.status === 409) &&
      typeof payload?.error === "string"
    ) {
      return { sent: false, reason: payload.error };
    }
  } catch {
    /* fall through */
  }
  return {
    sent: false,
    reason: "We could not send that request right now. Try again in a moment.",
  };
}

export type SendOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: string };

/**
 * Sends one message.
 *
 * The idempotency key is minted HERE, once per composed message, and reused if
 * the send is retried. That is what makes a double-tap on a bad connection post
 * once — the server resolves the duplicate to the original message rather than
 * creating a second one.
 */
export async function sendHelpMessage(params: {
  token: string;
  body: string;
  topic: CustomerTopic;
  idempotencyKey: string;
}): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/couranr/help/${encodeURIComponent(params.token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        body: params.body,
        topic: params.topic,
        idempotencyKey: params.idempotencyKey,
      }),
    });
  } catch {
    return { sent: false, reason: "We could not send that. Check your connection and try again." };
  }

  if (res.ok) {
    try {
      const payload = await res.json();
      return { sent: true, messageId: payload?.messageId };
    } catch {
      return { sent: false, reason: "We could not confirm that was sent. Try again." };
    }
  }

  // A validation refusal is the customer's to fix and is worth showing. Every
  // other status collapses to one sentence.
  try {
    const payload = await res.json();
    if (res.status === 400 && typeof payload?.error === "string") {
      return { sent: false, reason: payload.error };
    }
  } catch {
    /* fall through to the generic refusal */
  }
  return { sent: false, reason: "We could not send that right now. Try again in a moment." };
}


type ProblemActionOutcome<T>={sent:true;value:T}|{sent:false;reason:string};

async function problemJson<T>(res:Response):Promise<ProblemActionOutcome<T>>{
  if(res.ok){
    try{return {sent:true,value:await res.json() as T};}
    catch{return {sent:false,reason:"Couranr could not confirm that action. Try again."};}
  }
  try{
    const body=await res.json();
    if(typeof body?.error==="string"&&[400,409,429].includes(res.status)){
      return {sent:false,reason:body.error};
    }
  }catch{/* sanitized fallback */}
  return {sent:false,reason:"Couranr could not save that delivery report right now. Try again."};
}

async function problemPost<T>(token:string,body:Record<string,unknown>){
  let res:Response;
  try{
    res=await fetch(`/api/couranr/help/${encodeURIComponent(token)}/problem-report`,{
      method:"POST",headers:{"content-type":"application/json"},cache:"no-store",
      body:JSON.stringify(body),
    });
  }catch{return {sent:false,reason:"Check your connection and try again."} as const;}
  return problemJson<T>(res);
}

export async function saveProblemDraft(p:{
  token:string;problemType:ProblemType;details:string;
}):Promise<{sent:true;report:ProblemReportView}|{sent:false;reason:string}>{
  const out=await problemPost<{report:ProblemReportView}>(p.token,{
    command:"save_draft",problemType:p.problemType,details:p.details,
  });
  if(out.sent===false)return out;
  return {sent:true,report:out.value.report};
}

export async function submitProblemReport(p:{
  token:string;reportId:string;idempotencyKey:string;
}):Promise<{sent:true;report:ProblemReportView}|{sent:false;reason:string}>{
  const out=await problemPost<{report:ProblemReportView}>(p.token,{
    command:"submit_report",reportId:p.reportId,idempotencyKey:p.idempotencyKey,
  });
  if(out.sent===false)return out;
  return {sent:true,report:out.value.report};
}

function problemHex(bytes:ArrayBuffer){
  return Array.from(new Uint8Array(bytes),(b)=>b.toString(16).padStart(2,"0")).join("");
}

export async function uploadCustomerProblemPhoto(p:{
  token:string;reportId:string;clientEvidenceId:string;file:File;
}):Promise<{sent:true;evidenceId:string}|{sent:false;reason:string}>{
  if(!globalThis.crypto?.subtle){
    return {sent:false,reason:"This browser cannot securely prepare that photo. Try a current browser."};
  }
  let bytes:ArrayBuffer;
  try{bytes=await p.file.arrayBuffer();}
  catch{return {sent:false,reason:"That photo could not be read. Choose it again."};}
  if(bytes.byteLength<1)return {sent:false,reason:"That photo is empty."};
  const sha256=problemHex(await crypto.subtle.digest("SHA-256",bytes));

  const prep=await problemPost<{upload:
    |{status:"verified";evidenceId:string}
    |{status:"upload";evidenceId:string;signedUrl:string;expectedBytes:number;expectedMime:string}
  }>(p.token,{
    command:"prepare_evidence",reportId:p.reportId,
    clientEvidenceId:p.clientEvidenceId,expectedMime:p.file.type,
    expectedBytes:bytes.byteLength,evidenceSha256:sha256,
  });
  if(prep.sent===false)return prep;
  const grant=prep.value.upload;
  if(grant.status==="verified")return {sent:true,evidenceId:grant.evidenceId};

  let put:Response;
  try{
    put=await fetch(grant.signedUrl,{
      method:"PUT",headers:{"content-type":p.file.type},body:bytes,
    });
  }catch{return {sent:false,reason:"The photo upload lost its connection. Try again."};}
  if(!put.ok)return {sent:false,reason:"The photo did not upload. Try again."};

  const fin=await problemPost<{evidence:{evidenceId:string}}>(p.token,{
    command:"finalize_evidence",evidenceId:grant.evidenceId,
  });
  if(fin.sent===false)return fin;
  return {sent:true,evidenceId:fin.value.evidence.evidenceId};
}

/** A per-message key, stable across retries of the same composed message. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
