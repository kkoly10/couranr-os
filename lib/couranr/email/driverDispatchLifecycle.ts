import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { issueSenderAccessToken } from "@/lib/couranr/consumer/senderAccess";
import { identityForAssignment } from "@/lib/couranr/driver/publicProfile";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import { emailSendingIsArmed, looksLikeAnAddress, sendRenderedEmail } from "./send";
import { consumerEmailIdempotencyKey, businessEmailIdempotencyKey } from "./idempotency";
import { defaultEmailConfig, url as emailUrl } from "./theme";
import { resolveMerchantNotificationAddress } from "./recipients";
import { driverDispatched } from "./templates/driverDispatch";

assertServerOnly("lib/couranr/email/driverDispatchLifecycle.ts");
const LOOKBACK_MINUTES = 720; // Must remain inside Resend's 24-hour idempotency window.

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function report(error: unknown, requestId: string) {
  logServerFailure({ operation: "driverDispatchLifecycle", correlationId: newCorrelationId(),
    code: "internal", detail: { requestId, error: error instanceof Error ? error.message : String(error) } });
}

/** Assignment events, not mutable profile rows, own the exact email identity. */
export async function notifyDriverDispatchLifecycle(input: {
  requestId: string; fetchImpl?: typeof fetch;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!emailSendingIsArmed()) return result;
  try {
    const { data: request, error: requestError } = await supabaseAdmin
      .from("couranr_delivery_requests")
      .select("id,requester_kind,business_account_id,source,reference,recipient_email,consumer_contact_snapshot")
      .eq("id", input.requestId).maybeSingle();
    if (requestError) throw requestError;
    if (!request) return result;
    const { data: delivery, error: deliveryError } = await supabaseAdmin
      .from("couranr_deliveries").select("id,fulfillment_state")
      .eq("request_id", input.requestId).maybeSingle();
    if (deliveryError) throw deliveryError;
    if (!delivery || ["delivered", "cancelled", "returned", "could_not_deliver"].includes(String(delivery.fulfillment_state))) return result;

    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60_000).toISOString();
    const { data: events, error: eventsError } = await supabaseAdmin
      .from("couranr_assignment_events")
      .select("id,assignment_id,command")
      .eq("delivery_id", delivery.id)
      .in("command", ["assign_delivery", "replace_delivery_assignment"])
      .gte("created_at", since)
      .order("created_at", { ascending: true }).limit(25);
    if (eventsError) throw eventsError;
    if (!events?.length) return result;

    const consumer = request.requester_kind === "consumer" && !request.business_account_id;
    let businessId = str(request.business_account_id);
    if (!businessId && request.source === "hosted_request") {
      const { data: hosted } = await supabaseAdmin.from("couranr_hosted_request_intakes")
        .select("host_business_account_id").eq("request_id", input.requestId).maybeSingle();
      businessId = str(hosted?.host_business_account_id);
    }
    const merchant = businessId ? await resolveMerchantNotificationAddress(businessId) : null;
    const senderEmail = consumer ? str((request.consumer_contact_snapshot as any)?.email) : "";
    const merchantEmail = merchant?.audience === "merchant" ? merchant.address : "";
    const recipientEmail = str(request.recipient_email);
    const { data: recipientNotice } = await supabaseAdmin
      .from("couranr_delivery_access_tokens")
      .select("recipient_notified_at")
      .eq("request_id", input.requestId).eq("audience", "recipient")
      .not("recipient_notified_at", "is", null).limit(1).maybeSingle();

    for (const event of events) {
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from("couranr_delivery_assignments")
        .select("assignment_state,driver_display_name_snapshot,driver_portrait_id")
        .eq("id", event.assignment_id).eq("delivery_id", delivery.id).maybeSingle();
      if (assignmentError) throw assignmentError;
      // A replacement that already happened must not announce the old driver.
      if (assignment?.assignment_state !== "active") { result.skipped++; continue; }
      const identity = await identityForAssignment(assignment, { stableEmailReference: true });
      if (!identity) { result.skipped++; continue; }
      const photo = identity.portraitUrl ? emailUrl(defaultEmailConfig, identity.portraitUrl) : null;
      const replacement = event.command === "replace_delivery_assignment";
      const senderToken = consumer && looksLikeAnAddress(senderEmail)
        ? await issueSenderAccessToken(input.requestId, String(event.id)) : null;
      const targets: Array<{
        audience: "sender" | "recipient" | "merchant"; to: string; statusUrl: string | null;
        key: string;
      }> = [];
      if (consumer && senderToken) targets.push({ audience: "sender", to: senderEmail,
        statusUrl: `${emailUrl(defaultEmailConfig, "/send")}#sender=${encodeURIComponent(senderToken)}`,
        key: consumerEmailIdempotencyKey.forEvent("sender_driver_dispatched", String(event.id)) });
      if (!consumer && looksLikeAnAddress(merchantEmail)) targets.push({ audience: "merchant", to: merchantEmail,
        statusUrl: emailUrl(defaultEmailConfig, `/app/business/deliveries/${input.requestId}`),
        key: businessEmailIdempotencyKey.forEntity("merchant_driver_dispatched", String(event.id)) });
      if (recipientNotice?.recipient_notified_at && looksLikeAnAddress(recipientEmail)) targets.push({
        audience: "recipient", to: recipientEmail, statusUrl: null,
        key: consumer
          ? consumerEmailIdempotencyKey.forEvent("recipient_driver_dispatched", String(event.id))
          : businessEmailIdempotencyKey.forEntity("recipient_driver_dispatched", String(event.id)),
      });
      for (const target of targets) {
        const sent = await sendRenderedEmail(driverDispatched(defaultEmailConfig, {
          audience: target.audience, reference: str(request.reference), driverName: identity.name,
          driverPortraitUrl: photo, statusUrl: target.statusUrl, replacement,
        }), { to: target.to, idempotencyKey: target.key, fetchImpl: input.fetchImpl });
        if ("reason" in sent) result.failed++;
        else result.sent++;
      }
    }
  } catch (error) { report(error, input.requestId); result.failed++; }
  return result;
}

export async function notifyDriverDispatchForDelivery(deliveryId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from("couranr_deliveries")
    .select("request_id").eq("id", deliveryId).maybeSingle();
  if (error || !data?.request_id) {
    report(error ?? new Error("delivery_not_found"), deliveryId);
    return;
  }
  await notifyDriverDispatchLifecycle({ requestId: String(data.request_id) });
}
