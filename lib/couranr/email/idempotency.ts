/**
 * The ONE place a consumer-lifecycle email idempotency key is minted.
 *
 * WHY A NAMED MINTER AND NOT A TEMPLATE LITERAL. The capture path already
 * learned this: `tests/couranr-lifecycle.test.ts` forbids
 * `idempotencyKey: \`…\`` anywhere in `lib/couranr/fulfillment/commands.ts`
 * because two call sites that each build "the same" key by hand are two call
 * sites that will eventually build different ones, and the failure is silent —
 * the provider simply stops deduplicating and the customer gets the email
 * twice. A minter is greppable, testable on its own, and impossible to spell
 * two ways.
 *
 * THE TWO RULES THESE KEYS OBEY.
 *
 *  1. EVENT-DERIVED, NEVER CLOCK-DERIVED. Every key here is built from an
 *     immutable identifier that the database already assigned — the primary key
 *     of an append-only event row, or the SHA-256 of the token a claim just
 *     minted. Nothing reads `Date.now()`. A clock-derived key changes on every
 *     retry, which is the same as having no key at all.
 *  2. SCOPED TO THE ATTEMPT/CYCLE, NOT THE ENTITY. The invitation key is the
 *     hash of THIS claim's token, so a revoked-and-replaced claim is a new
 *     attempt with a new key and is free to send again; an entity-scoped key
 *     (the request id) would make the retry a silent no-op for 24 hours and the
 *     recipient would never be emailed. The lifecycle keys are scoped to one
 *     event row, so a second `could_not_deliver` on the same delivery is a
 *     second notification rather than a swallowed duplicate.
 *
 * THE PROVIDER CONTRACT THIS IS WRITTEN AGAINST. Resend keeps an idempotency
 * key for 24 hours; a replay with the SAME payload returns the original
 * response without sending again, a replay with a DIFFERENT payload is refused
 * with `409 invalid_idempotent_request`, and a key must be 1–256 characters.
 * (https://resend.com/docs/dashboard/emails/idempotency-keys, read 2026-09-17.)
 * The 409-on-different-payload rule is why the notification KIND is part of the
 * key and not just the event id: two notifications that ever derived from one
 * event row would otherwise collide on a key and the second would be refused
 * rather than sent.
 */

/** Every consumer-lifecycle email Couranr sends, and nothing else. */
export const CONSUMER_EMAIL_NOTIFICATIONS = [
  "sender_request_received",
  "sender_request_confirmed",
  "recipient_delivery_invitation",
  "recipient_out_for_delivery",
  "recipient_delivered",
  "sender_handoff_failed",
  "sender_return_notice",
] as const;

export type ConsumerEmailNotification = (typeof CONSUMER_EMAIL_NOTIFICATIONS)[number];

/** Provider limit. A longer key is a 400, not a truncation. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 256;

/**
 * How long the provider remembers a key. Load-bearing, not trivia: the
 * lifecycle sweep re-attempts an event for as long as that event stays inside
 * its lookback window, and the ONLY thing that stops the 24-hour-old attempt
 * from becoming a second real email is that the window closes first.
 * `CONSUMER_NOTIFICATION_LOOKBACK_MINUTES` is asserted against this.
 */
export const PROVIDER_IDEMPOTENCY_RETENTION_HOURS = 24;

const PREFIX = "couranr.consumer";

/**
 * Deliberately total and deliberately lossy-free: the pieces are a fixed
 * vocabulary word and a database identifier, so there is nothing to escape and
 * nothing that can push the result past the provider's 256-character limit.
 * The assertion is still here because "cannot happen" is how the 24-hour
 * dedup window quietly stops applying.
 */
function mint(notification: ConsumerEmailNotification, scope: string): string {
  const key = `${PREFIX}.${notification}/${scope}`;
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    /* Truncating would be worse than failing: two different scopes that share a
       prefix would truncate to the SAME key and the provider would swallow the
       second email for 24 hours. */
    throw new Error(`consumer email idempotency key too long: ${key.length}`);
  }
  return key;
}

export const consumerEmailIdempotencyKey = {
  /**
   * The recipient's tracking invitation.
   *
   * Scoped to the SHA-256 of the token this claim minted, which is the
   * attempt — `couranr_claim_consumer_recipient_tracking_delivery` issues a
   * fresh token every time a previous claim was revoked, so a retry after a
   * provider failure carries a different key and is genuinely re-sent.
   */
  recipientDeliveryInvitation(tokenHash: string): string {
    return mint("recipient_delivery_invitation", tokenHash);
  },

  /**
   * Every other lifecycle email, scoped to the append-only event row that
   * caused it — `couranr_delivery_events.id` or
   * `couranr_delivery_request_events.id`, both `uuid primary key` and never
   * updated.
   */
  forEvent(notification: ConsumerEmailNotification, eventId: string): string {
    return mint(notification, eventId);
  },
} as const;
