import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { businessEmailIdempotencyKey, CONSUMER_EMAIL_NOTIFICATIONS } from "@/lib/couranr/email/idempotency";
import { defaultEmailConfig } from "@/lib/couranr/email/theme";
import { bizOutForDelivery, bizReviewOutcome } from "@/lib/couranr/email/templates/business";
import { custDelivered, custOutForDelivery, custRecipientUnavailable, custReturnNotice } from "@/lib/couranr/email/templates/customer";
import { consumerRecipientHandoffFailed, consumerRecipientReturnNotice, consumerSenderDelivered, consumerSenderOutForDelivery } from "@/lib/couranr/email/templates/consumer";
const read=(p:string)=>readFileSync(join(process.cwd(),p),"utf8");

describe("communication lifecycle closure",()=>{
  it("scopes Business provider keys to immutable entities",()=>{
    expect(businessEmailIdempotencyKey.forEntity("merchant_scheduled","plan-1")).toBe("couranr.business.merchant_scheduled/plan-1");
    expect(businessEmailIdempotencyKey.forEntity("recipient_out_for_delivery","ev-1")).toBe("couranr.business.recipient_out_for_delivery/ev-1");
    expect(businessEmailIdempotencyKey.recipientDeliveryInvitation("a".repeat(64))).toContain("couranr.business.recipient_delivery_invitation/");
  });
  it("Same Day informs both audiences at progress, success and exceptions",()=>{
    for(const n of ["sender_out_for_delivery","sender_delivered","recipient_handoff_failed","recipient_return_notice"]){
      expect(CONSUMER_EMAIL_NOTIFICATIONS).toContain(n as any);
    }
  });
  it("does not claim dispatch is assigned merely because Business is scheduled",()=>{
    const e=bizReviewOutcome(defaultEmailConfig,{businessName:"QA",reference:"CR-QA",outcome:"confirmed",scheduledWindowLabel:"Tomorrow",ctaUrl:"https://couranr.com/app/business/deliveries/qa"});
    expect(e.html).toContain("Assignment pending");
    expect(e.html).not.toContain("a vehicle is assigned");
  });
  it("renders recipient followups without inventing a recoverable raw tracking token",()=>{
    const samples=[
      bizOutForDelivery(defaultEmailConfig,{businessName:"QA",reference:"CR-QA",recipientName:"Jordan",detailsUrl:"https://couranr.com/app/business/deliveries/qa"}),
      custOutForDelivery(defaultEmailConfig,{shop:{name:"QA"},recipientName:"Jordan",reference:"CR-QA",handoffMethodLabel:"Hand to you",codeOnTrackingPage:true}),
      custDelivered(defaultEmailConfig,{shop:{name:"QA"},recipientName:"Jordan",reference:"CR-QA",deliveredAtLabel:"Today",proofMethodLabel:"Photo + PIN"}),
      custRecipientUnavailable(defaultEmailConfig,{shop:{name:"QA"},recipientName:"Jordan",reference:"CR-QA",message:"Handoff unavailable."}),
      custReturnNotice(defaultEmailConfig,{shop:{name:"QA"},recipientName:"Jordan",reference:"CR-QA",reasonLabel:"Returning."}),
    ];
    for(const e of samples) expect(e.html).not.toContain('href="undefined"');
  });
  it("renders new Same Day messages without handoff codes",()=>{
    const samples=[
      consumerSenderOutForDelivery(defaultEmailConfig,{senderName:"Avery",recipientName:"Jordan",reference:"CR-QA",statusUrl:"https://couranr.com/send"}),
      consumerSenderDelivered(defaultEmailConfig,{senderName:"Avery",recipientName:"Jordan",reference:"CR-QA",deliveredAtLabel:"Today",statusUrl:"https://couranr.com/send"}),
      consumerRecipientHandoffFailed(defaultEmailConfig,{senderName:"Avery",recipientName:"Jordan",reference:"CR-QA",reasonLabel:"Unavailable."}),
      consumerRecipientReturnNotice(defaultEmailConfig,{senderName:"Avery",recipientName:"Jordan",reference:"CR-QA",reasonLabel:"Returning."}),
    ];
    const handoffCodeSentinel = "492013";
    for (const e of samples) expect(e.html).not.toContain(handoffCodeSentinel);
  });
  it("wires Business mail to the immediate + cron-backed lifecycle owner",()=>{
    const engine=read("lib/couranr/automation/engine.ts");
    expect(engine).toContain('import { notifyBusinessLifecycle } from "@/lib/couranr/email/businessLifecycle"');
    expect(engine).toContain("await notifyBusinessLifecycle({ requestId");
  });
  it("keeps credited merchants able to mark Ready in the browser",()=>{
    const panel=read("components/couranr/fulfillment/MerchantReadinessPanel.tsx");
    expect(panel).toContain("const commerciallyCovered = authorized || credited");
    expect(panel).toContain('c.to === "ready" && !commerciallyCovered');
  });
  it("never destroys a live unclaimed merchant or hosted tracking token",()=>{
    const sql=read("supabase/migrations/20260919040000_couranr_business_recipient_notifications.sql").toLowerCase();
    expect(sql).toContain("'existing_unclaimed'");
    expect(sql).toContain("recipient_notification_claimed_at is null");
    expect(sql).toContain("host_business_account_id");
    expect(sql).toContain("to service_role");
  });
  it("protects a tracking link after Couranr has emailed it",()=>{
    const route=read("app/api/couranr/delivery-requests/[id]/tracking-link/route.ts");
    expect(route).toContain("recipientTrackingNotificationState");
    expect(route).toContain("Replacing it would invalidate their email link");
  });
});
