import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import {
  claimBusinessRecipientTrackingDelivery,
  failRecipientTrackingNotification,
  isTrackingFailure,
  markBusinessRecipientTrackingNotification,
} from "@/lib/couranr/tracking/commands";
import { hashTrackingToken } from "@/lib/couranr/tracking/tokens";
import { emailSendingIsArmed, looksLikeAnAddress, sendRenderedEmail } from "./send";
import {
  businessEmailIdempotencyKey,
  PROVIDER_IDEMPOTENCY_RETENTION_HOURS,
  type BusinessEmailNotification,
} from "./idempotency";
import { defaultEmailConfig, url as emailUrl } from "./theme";
import { resolveMerchantNotificationAddress } from "./recipients";
import { bizActionNeeded, bizDeliveredReceipt, bizOutForDelivery, bizPaymentReceipt, bizReviewOutcome } from "./templates/business";
import { custDelivered, custOrderConfirmed, custOutForDelivery, custRecipientUnavailable, custReturnNotice } from "./templates/customer";
import type { RenderedEmail } from "./types";

assertServerOnly("lib/couranr/email/businessLifecycle.ts");
export const BUSINESS_NOTIFICATION_LOOKBACK_MINUTES=720;
if(BUSINESS_NOTIFICATION_LOOKBACK_MINUTES>=PROVIDER_IDEMPOTENCY_RETENTION_HOURS*60) throw new Error("Business notification lookback must stay inside provider idempotency retention");
const EVENT_SCAN_LIMIT=25;
const TERMINAL_STATES=new Set(["delivered","could_not_deliver","cancelled","return_required","returning","returned"]);

type Outcome="sent"|"skipped"|"failed";
export type BusinessNotificationResult={notification:BusinessEmailNotification;audience:"merchant"|"recipient";outcome:Outcome;reason?:string;providerId?:string};
export type BusinessLifecycleReport={requestId:string;eligible:boolean;reason?:string;results:BusinessNotificationResult[]};

function str(v:unknown):string{return typeof v==="string"?v.trim():"";}
function record(operation:string,detail:unknown){logServerFailure({correlationId:newCorrelationId(),operation,code:"internal",detail});}
function labelAddress(a:any):string {
  const cityRegion=[a?.city,a?.region].filter((v)=>typeof v==="string"&&v).join(", ");
  return cityRegion||str(a?.formattedAddress)||"Delivery address";
}
function whenLabel(v:unknown,timeZone?:string):string {
  const d=new Date(String(v??"")); if(Number.isNaN(d.getTime())) return "recently";
  try{return new Intl.DateTimeFormat("en-US",{timeZone:timeZone||"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(d);}
  catch{return d.toISOString();}
}
function windowLabel(plan:any):string {
  const zone=str(plan?.timezone)||"America/New_York";
  return `${whenLabel(plan?.scheduled_pickup_start,zone)} – ${whenLabel(plan?.scheduled_pickup_end,zone)}`;
}
function proofLabel(v:unknown):string {
  const x=str(v); if(x==="signature")return "Signature"; if(x==="leave_at_door")return "Left at door"; return "Photo + PIN";
}

async function deliver(p:{notification:BusinessEmailNotification;audience:"merchant"|"recipient";rendered:RenderedEmail;to:string;key:string;fetchImpl?:typeof fetch}):Promise<BusinessNotificationResult>{
  if(!looksLikeAnAddress(p.to)) return {notification:p.notification,audience:p.audience,outcome:"skipped",reason:"no_address"};
  const r=await sendRenderedEmail(p.rendered,{to:p.to,idempotencyKey:p.key,fetchImpl:p.fetchImpl});
  if("reason" in r) return {notification:p.notification,audience:p.audience,outcome:"failed",reason:r.reason};
  return {notification:p.notification,audience:p.audience,outcome:"sent",providerId:r.id};
}

async function businessRelationship(request:any):Promise<string|null>{
  if(request?.business_account_id) return String(request.business_account_id);
  if(request?.source!=="hosted_request") return null;
  const {data,error}=(await supabaseAdmin.from("couranr_hosted_request_intakes").select("host_business_account_id").eq("request_id",String(request.id)).maybeSingle()) as {data:any;error:any};
  if(error){record("businessLifecycle.hostRelationship",{requestId:request.id,message:error.message});return null;}
  return data?.host_business_account_id?String(data.host_business_account_id):null;
}

async function sendRecipientInvitation(p:{request:any;businessName:string;plan:any;fetchImpl?:typeof fetch}):Promise<BusinessNotificationResult>{
  const notification:BusinessEmailNotification="recipient_delivery_invitation";
  const email=str(p.request.recipient_email);
  if(!email) return {notification,audience:"recipient",outcome:"skipped",reason:"no_address"};
  const claim=await claimBusinessRecipientTrackingDelivery({requestId:String(p.request.id)});
  if(isTrackingFailure(claim)) return {notification,audience:"recipient",outcome:"failed",reason:"claim_"+claim.code};
  if(claim.value.outcome!=="issued") return {notification,audience:"recipient",outcome:"skipped",reason:claim.value.outcome};
  const rawToken=claim.value.token;
  const sent=await deliver({
    notification,audience:"recipient",
    rendered:custOrderConfirmed(defaultEmailConfig,{
      shop:{name:p.businessName},
      recipientName:str(p.request.recipient_name)||"there",
      reference:str(p.request.reference),
      scheduledWindowLabel:windowLabel(p.plan),
      dropoffLabel:labelAddress(p.request.dropoff_address),
      trackUrl:emailUrl(defaultEmailConfig,`/track/${encodeURIComponent(rawToken)}`),
    }),
    to:email,
    key:businessEmailIdempotencyKey.recipientDeliveryInvitation(hashTrackingToken(rawToken)),
    fetchImpl:p.fetchImpl,
  });
  if(sent.outcome!=="sent"){
    await failRecipientTrackingNotification({rawToken,reason:"business_recipient_email_send_failed"});
    return sent;
  }
  const marked=await markBusinessRecipientTrackingNotification({rawToken,providerId:String(sent.providerId??"")});
  if(isTrackingFailure(marked)){
    await failRecipientTrackingNotification({rawToken,reason:"business_recipient_email_receipt_not_recorded"});
    return {notification,audience:"recipient",outcome:"failed",reason:"receipt_not_recorded"};
  }
  return sent;
}

export async function notifyBusinessLifecycle(options:{requestId:string;fetchImpl?:typeof fetch}):Promise<BusinessLifecycleReport>{
  const requestId=String(options.requestId??"");
  const report:BusinessLifecycleReport={requestId,eligible:false,results:[]};
  try{
    if(!requestId){report.reason="no_request_id";return report;}
    if(!emailSendingIsArmed()){report.reason="email_sending_not_armed";return report;}
    const {data:request,error:requestError}=(await supabaseAdmin.from("couranr_delivery_requests")
      .select("id,requester_kind,source,business_account_id,request_state,reference,recipient_name,recipient_email,dropoff_address,payer_type")
      .eq("id",requestId).maybeSingle()) as {data:any;error:any};
    if(requestError||!request){report.reason="request_load_failed";if(requestError)record("businessLifecycle.loadRequest",requestError.message);return report;}
    const businessAccountId=await businessRelationship(request);
    if(!businessAccountId){report.reason="not_a_business_product_request";return report;}
    report.eligible=true;
    const {data:business,error:businessError}=(await supabaseAdmin.from("business_accounts").select("id,name").eq("id",businessAccountId).maybeSingle()) as {data:any;error:any};
    if(businessError||!business){report.reason="business_load_failed";if(businessError)record("businessLifecycle.loadBusiness",businessError.message);return report;}
    const merchant=await resolveMerchantNotificationAddress(businessAccountId);
    const merchantEmail=merchant.audience==="merchant"?merchant.address:"";
    const businessName=str(business.name)||"Your business";
    const since=new Date(Date.now()-BUSINESS_NOTIFICATION_LOOKBACK_MINUTES*60*1000).toISOString();
    const detailsUrl=emailUrl(defaultEmailConfig,`/app/business/deliveries/${encodeURIComponent(requestId)}`);

    const [planQ,deliveryQ,paymentQ]=await Promise.all([
      supabaseAdmin.from("couranr_service_plans").select("id,plan_state,scheduled_pickup_start,scheduled_pickup_end,timezone,confirmed_at,created_at,vehicle_id").eq("request_id",requestId).eq("plan_state","confirmed").order("created_at",{ascending:false}).limit(1).maybeSingle(),
      supabaseAdmin.from("couranr_deliveries").select("id,fulfillment_state,proof_method,timezone,scheduled_pickup_start,scheduled_pickup_end,vehicle_id").eq("request_id",requestId).maybeSingle(),
      supabaseAdmin.from("couranr_payment_obligations").select("id,payer_type,payment_state,currency,captured_amount_cents,captured_at,created_at").eq("request_id",requestId).neq("payment_state","cancelled").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    ]) as any[];
    const plan=planQ.data,delivery=deliveryQ.data,payment=paymentQ.data;
    if(planQ.error) record("businessLifecycle.loadPlan",planQ.error.message);
    if(deliveryQ.error) record("businessLifecycle.loadDelivery",deliveryQ.error.message);
    if(paymentQ.error) record("businessLifecycle.loadPayment",paymentQ.error.message);

    const planMoment=String(plan?.confirmed_at??plan?.created_at??"");
    const planIsRecent=Boolean(plan&&plan.plan_state==="confirmed"&&planMoment&&new Date(planMoment).getTime()>=new Date(since).getTime());
    if(planIsRecent){
      if(merchantEmail){
        const notification:BusinessEmailNotification="merchant_scheduled";
        report.results.push(await deliver({
          notification,audience:"merchant",
          rendered:bizReviewOutcome(defaultEmailConfig,{businessName,reference:str(request.reference),outcome:"confirmed",scheduledWindowLabel:windowLabel(plan),vehicleLabel:delivery?.vehicle_id?"Assigned":undefined,ctaUrl:detailsUrl}),
          to:merchantEmail,key:businessEmailIdempotencyKey.forEntity(notification,String(plan.id)),fetchImpl:options.fetchImpl,
        }));
      }
      if(request.request_state==="confirmed"&&!TERMINAL_STATES.has(str(delivery?.fulfillment_state))){
        report.results.push(await sendRecipientInvitation({request,businessName,plan,fetchImpl:options.fetchImpl}));
      }
    }

    if(merchantEmail&&payment?.payment_state==="captured"&&payment?.payer_type==="merchant"&&payment?.captured_at&&new Date(String(payment.captured_at)).getTime()>=new Date(since).getTime()){
      const notification:BusinessEmailNotification="merchant_payment_receipt";
      report.results.push(await deliver({
        notification,audience:"merchant",
        rendered:bizPaymentReceipt(defaultEmailConfig,{businessName,reference:str(request.reference),paidAtLabel:whenLabel(payment.captured_at,plan?.timezone),total:{amountCents:Number(payment.captured_amount_cents??0),currency:str(payment.currency)||"USD"},detailsUrl}),
        to:merchantEmail,key:businessEmailIdempotencyKey.forEntity(notification,String(payment.id)),fetchImpl:options.fetchImpl,
      }));
    }

    if(!delivery?.id)return report;
    const {data:events,error:eventError}=(await supabaseAdmin.from("couranr_delivery_events").select("id,to_state,created_at").eq("delivery_id",String(delivery.id)).in("to_state",["in_transit","delivered","could_not_deliver","return_required"]).gte("created_at",since).order("created_at",{ascending:true}).limit(EVENT_SCAN_LIMIT)) as {data:any[]|null;error:any};
    if(eventError){record("businessLifecycle.loadEvents",eventError.message);report.reason="delivery_events_load_failed";return report;}

    const recipientEmail=str(request.recipient_email);
    const recipientName=str(request.recipient_name)||"your recipient";
    for(const event of events??[]){
      const state=str(event.to_state),eventId=String(event.id);
      if(state==="in_transit"){
        if(recipientEmail){
          const notification:BusinessEmailNotification="recipient_out_for_delivery";
          report.results.push(await deliver({
            notification,audience:"recipient",
            rendered:custOutForDelivery(defaultEmailConfig,{shop:{name:businessName},recipientName,reference:str(request.reference),handoffMethodLabel:proofLabel(delivery.proof_method),codeOnTrackingPage:delivery.proof_method==="photo_or_pin"}),
            to:recipientEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
          }));
        }
        if(merchantEmail){
          const notification:BusinessEmailNotification="merchant_out_for_delivery";
          report.results.push(await deliver({
            notification,audience:"merchant",rendered:bizOutForDelivery(defaultEmailConfig,{businessName,reference:str(request.reference),recipientName,detailsUrl}),
            to:merchantEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
          }));
        }
        continue;
      }
      if(state==="delivered"){
        const deliveredAt=whenLabel(event.created_at,delivery.timezone);
        if(recipientEmail){
          const notification:BusinessEmailNotification="recipient_delivered";
          report.results.push(await deliver({
            notification,audience:"recipient",rendered:custDelivered(defaultEmailConfig,{shop:{name:businessName},recipientName,reference:str(request.reference),deliveredAtLabel:deliveredAt,proofMethodLabel:proofLabel(delivery.proof_method)}),
            to:recipientEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
          }));
        }
        if(merchantEmail){
          const notification:BusinessEmailNotification="merchant_delivered";
          report.results.push(await deliver({
            notification,audience:"merchant",rendered:bizDeliveredReceipt(defaultEmailConfig,{businessName,reference:str(request.reference),recipientName,deliveredAtLabel:deliveredAt,proofMethodLabel:proofLabel(delivery.proof_method),detailsUrl}),
            to:merchantEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
          }));
        }
        continue;
      }
      const message=state==="could_not_deliver"?"Couranr could not complete the recipient handoff at the delivery address.":"Couranr could not complete the delivery, so the shipment is being returned.";
      if(recipientEmail){
        const notification:BusinessEmailNotification=state==="could_not_deliver"?"recipient_unavailable":"recipient_return_notice";
        report.results.push(await deliver({
          notification,audience:"recipient",
          rendered:state==="could_not_deliver"
            ? custRecipientUnavailable(defaultEmailConfig,{shop:{name:businessName},recipientName,reference:str(request.reference),message})
            : custReturnNotice(defaultEmailConfig,{shop:{name:businessName},recipientName,reference:str(request.reference),reasonLabel:message}),
          to:recipientEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
        }));
      }
      if(merchantEmail){
        const notification:BusinessEmailNotification="merchant_action_needed";
        report.results.push(await deliver({
          notification,audience:"merchant",
          rendered:bizActionNeeded(defaultEmailConfig,{businessName,reference:str(request.reference),recipientName,issue:state==="could_not_deliver"?"recipient_unavailable":"return_required",message,ctaUrl:detailsUrl}),
          to:merchantEmail,key:businessEmailIdempotencyKey.forEntity(notification,eventId),fetchImpl:options.fetchImpl,
        }));
      }
    }
    return report;
  }catch(err){
    record("businessLifecycle.unhandled",{requestId,error:err instanceof Error?err.message:String(err)});
    report.reason=report.reason??"unhandled_error";
    return report;
  }
}
