/**
 * Stable idempotency keys for Couranr lifecycle email.
 *
 * Every key is derived from an immutable database identifier (event row,
 * service-plan/payment row, or the hash of a one-time tracking token). Nothing
 * is clock-derived. Resend remembers a key for 24 hours, so lifecycle sweeps
 * deliberately close before that window.
 */
export const CONSUMER_EMAIL_NOTIFICATIONS = [
  "sender_request_received",
  "sender_request_confirmed",
  "recipient_delivery_invitation",
  "recipient_out_for_delivery",
  "sender_out_for_delivery",
  "recipient_delivered",
  "sender_delivered",
  "sender_handoff_failed",
  "recipient_handoff_failed",
  "sender_return_notice",
  "recipient_return_notice",
] as const;
export type ConsumerEmailNotification=(typeof CONSUMER_EMAIL_NOTIFICATIONS)[number];

export const BUSINESS_EMAIL_NOTIFICATIONS = [
  "merchant_scheduled",
  "merchant_payment_receipt",
  "merchant_out_for_delivery",
  "merchant_delivered",
  "merchant_action_needed",
  "recipient_delivery_invitation",
  "recipient_out_for_delivery",
  "recipient_delivered",
  "recipient_unavailable",
  "recipient_return_notice",
] as const;
export type BusinessEmailNotification=(typeof BUSINESS_EMAIL_NOTIFICATIONS)[number];

export const IDEMPOTENCY_KEY_MAX_LENGTH=256;
export const PROVIDER_IDEMPOTENCY_RETENTION_HOURS=24;

function mint(prefix:string,notification:string,scope:string):string {
  const key=`${prefix}.${notification}/${scope}`;
  if(key.length>IDEMPOTENCY_KEY_MAX_LENGTH) throw new Error(`email idempotency key too long: ${key.length}`);
  return key;
}

export const consumerEmailIdempotencyKey={
  recipientDeliveryInvitation(tokenHash:string):string {
    return mint("couranr.consumer","recipient_delivery_invitation",tokenHash);
  },
  forEvent(notification:ConsumerEmailNotification,eventId:string):string {
    return mint("couranr.consumer",notification,eventId);
  },
} as const;

export const businessEmailIdempotencyKey={
  recipientDeliveryInvitation(tokenHash:string):string {
    return mint("couranr.business","recipient_delivery_invitation",tokenHash);
  },
  forEntity(notification:BusinessEmailNotification,entityId:string):string {
    return mint("couranr.business",notification,entityId);
  },
} as const;
