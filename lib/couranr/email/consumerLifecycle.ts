import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import {
  claimConsumerRecipientTrackingDelivery,
  failRecipientTrackingNotification,
  isTrackingFailure,
  markRecipientTrackingNotification,
} from "@/lib/couranr/tracking/commands";
import { hashTrackingToken } from "@/lib/couranr/tracking/tokens";
import { emailSendingIsArmed, looksLikeAnAddress, sendRenderedEmail } from "./send";
import {
  PROVIDER_IDEMPOTENCY_RETENTION_HOURS,
  consumerEmailIdempotencyKey,
  type ConsumerEmailNotification,
} from "./idempotency";
import { defaultEmailConfig, url as emailUrl } from "./theme";
import { custDirectDeliveryConfirmed } from "./templates/customer";
import {
  consumerRecipientDelivered,
  consumerRecipientOutForDelivery,
  consumerSenderHandoffFailed,
  consumerSenderRequestConfirmed,
  consumerSenderRequestReceived,
  consumerSenderReturnNotice,
} from "./templates/consumer";
import type { RenderedEmail } from "./types";

assertServerOnly("lib/couranr/email/consumerLifecycle.ts");

/**
 * Couranr Same Day's consumer notifications — owned by the LIFECYCLE, not by a
 * page load.
 *
 * WHAT THIS REPLACED, AND WHY. `getConsumerSendView` — a GET projection behind
 * the sender's own status page — used to claim the recipient tracking token,
 * call the email provider and record the receipt inline. Three consequences,
 * all of them real:
 *
 *   - a provider blip returned HTTP 500 from the SENDER'S status page, for an
 *     operation that had already succeeded (the delivery was confirmed and paid
 *     for);
 *   - if the sender closed the tab after that blip, nothing ever retried, and
 *     the recipient was never emailed. No queue, no alarm, no second chance;
 *   - the recipient's invitation depended on the sender opening a page at all.
 *
 * So the send moved to `advanceAutomaticFulfillment`, which is the lifecycle
 * owner: it is called from every canonical seam that can change a request
 * (submit, payer authorization, readiness, the Stripe webhook, Operations
 * accept) AND from the 5-minute `vercel.json` cron through
 * `runAutomaticFulfillmentTick`. The hook makes it prompt; the cron makes it
 * inevitable.
 *
 * HOW A RETRY HAPPENS, with no queue and no outbox (there is no such table in
 * this database and this slice was explicitly not allowed to add one):
 *
 *   - THE INVITATION has a real claim/receipt trio in SQL. A failed send calls
 *     `couranr_fail_recipient_tracking_notification`, which REVOKES that token.
 *     The next tick's claim therefore finds no live token, issues a fresh one,
 *     and sends again with a new idempotency key. A successful send records the
 *     provider id, and every later claim answers `sent` and does nothing. A
 *     claim already in flight answers `in_progress` for two minutes.
 *   - EVERY OTHER NOTIFICATION is derived from an append-only event row, and
 *     its idempotency key is that row's primary key. The tick re-attempts the
 *     same event for as long as it stays inside
 *     `CONSUMER_NOTIFICATION_LOOKBACK_MINUTES`, and the provider's 24-hour
 *     idempotency window collapses every attempt after the first into a no-op
 *     that returns the original message id. The lookback is deliberately half
 *     the provider's retention: it must close before the window it relies on
 *     does, or the 25th hour would send a second real email. That inequality is
 *     asserted in tests/couranr-consumer-lifecycle-email.test.ts.
 *
 * IT NEVER THROWS AND IT NEVER FAILS ITS CALLER. Every notification is
 * downstream of work that already completed. A mail outage must degrade to "no
 * email yet, retried in five minutes", never to a 500 on a payment webhook.
 */

/**
 * How far back the sweep looks for un-notified events.
 *
 * MUST stay strictly below `PROVIDER_IDEMPOTENCY_RETENTION_HOURS`. Twelve hours
 * gives a wedged cron half a day to recover while leaving a twelve-hour margin
 * before the provider forgets the key that is suppressing the duplicates.
 */
export const CONSUMER_NOTIFICATION_LOOKBACK_MINUTES = 720;

/** Defensive cap; a request cannot legitimately produce this many in a window. */
const EVENT_SCAN_LIMIT = 25;

export type ConsumerNotificationResult = {
  notification: ConsumerEmailNotification;
  outcome: "sent" | "skipped" | "failed";
  reason?: string;
  /** The provider's message id, present only on `sent`. The invitation's
      receipt is written from this; a replay returns the ORIGINAL id, which is
      what makes re-recording it a no-op in SQL rather than a conflict. */
  providerId?: string;
};

export type ConsumerLifecycleNotificationReport = {
  requestId: string;
  /** False when this is not a direct-consumer request, or mail is not armed. */
  eligible: boolean;
  reason?: string;
  results: ConsumerNotificationResult[];
};

export interface ConsumerLifecycleNotificationOptions {
  requestId: string;
  /** Test seam, threaded to `sendRenderedEmail`. Production passes nothing. */
  fetchImpl?: typeof fetch;
}

const REQUEST_COLUMNS =
  "id,requester_kind,business_account_id,request_state,reference,recipient_name," +
  "recipient_email,dropoff_address,consumer_contact_snapshot,protection_level";

/**
 * Recipient-facing handoff wording. Deliberately NOT `PROOF_METHOD_LABELS`,
 * which is driver-facing and says "Recipient PIN handoff" — a recipient is told
 * what will happen to them, not what the driver's screen calls it.
 */
const RECIPIENT_HANDOFF_LABEL: Record<string, string> = {
  photo_or_pin: "Hand to you",
  signature: "Signature",
  leave_at_door: "Leave at door",
};

/** The one method that involves a code the recipient must read off their page. */
const METHOD_REQUIRES_CODE = "photo_or_pin";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dropoffLabel(dropoff: any): string {
  const parts = [dropoff?.city, dropoff?.region].filter((v) => typeof v === "string" && v);
  return parts.join(", ") || str(dropoff?.formattedAddress) || "Delivery address";
}

/**
 * Human-readable, in the DELIVERY'S timezone where the row carries one.
 *
 * A recipient in Woodbridge reading "15:41 UTC" has to do arithmetic to find
 * out whether that was this afternoon. `couranr_deliveries.timezone` is the
 * canonical operating zone for the delivery, so it is the right clock; UTC is
 * the fallback and says so rather than pretending to be local.
 */
function whenLabel(iso: unknown, timeZone?: string): string {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "just now";
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d);
    } catch {
      /* An unknown zone throws a RangeError. Fall through to UTC rather than
         failing a notification over a formatting preference. */
    }
  }
  return `${d.toUTCString().replace(" GMT", "")} UTC`;
}

function record(operation: string, detail: unknown) {
  logServerFailure({
    correlationId: newCorrelationId(),
    operation,
    code: "internal",
    detail,
  });
}

/* ------------------------------------------------------------- sending --- */

/**
 * The single place this module hands an email to the provider.
 *
 * THE IDEMPOTENCY KEY IS A PARAMETER, and it always arrives from
 * `consumerEmailIdempotencyKey`. No call site in this file builds one with a
 * template literal — that is the rule `tests/couranr-lifecycle.test.ts` already
 * enforces for the capture path, for the same reason: two hand-built spellings
 * of "the same" key silently stop deduplicating.
 */
async function deliver(params: {
  notification: ConsumerEmailNotification;
  rendered: RenderedEmail;
  to: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ConsumerNotificationResult> {
  if (!looksLikeAnAddress(params.to)) {
    return { notification: params.notification, outcome: "skipped", reason: "no_address" };
  }
  const sent = await sendRenderedEmail(params.rendered, {
    to: params.to,
    idempotencyKey: params.idempotencyKey,
    fetchImpl: params.fetchImpl,
  });
  if ("reason" in sent) {
    /* Not logged again here: sendRenderedEmail already emitted a structured
       failure with its own correlation id. Double-logging one outage as two
       incidents is how a log drain's alert threshold stops meaning anything. */
    return { notification: params.notification, outcome: "failed", reason: sent.reason };
  }
  return { notification: params.notification, outcome: "sent", providerId: sent.id };
}

/* -------------------------------------------------- recipient invitation --- */

/**
 * Fulfillment states after which an invitation to track a delivery is pointless.
 *
 * A bound on RETRY, not on correctness. Without one, a request whose mail has
 * been failing since it was confirmed would be re-attempted every five minutes
 * for the life of the row; with one, the attempts stop when the delivery does.
 */
const TERMINAL_FULFILLMENT_STATES = new Set([
  "delivered",
  "could_not_deliver",
  "returned",
  "cancelled",
]);

/**
 * INVITE ONCE, EVER — and this guard is the whole reason the function exists.
 *
 * `couranr_claim_consumer_recipient_tracking_delivery` looks for a live token:
 * `revoked_at is null and expires_at > now()`. A tracking token's TTL is 30
 * days, and NOTHING in this schema moves a request out of `confirmed` — so 30
 * days after a delivery completed, the claim finds no live token, issues a
 * brand new one and answers `issued`. Under the old page-driven send that was
 * survivable, because the sender had long since stopped opening the page.
 * Under a 5-minute cron it is a certainty: every recipient would be emailed
 * "a delivery to you is confirmed" again, a month after it arrived, and again
 * the month after that.
 *
 * `recipient_notified_at` is the fact that closes it: it is written once, it
 * survives revocation and expiry, and it is never cleared. Asked BEFORE the
 * claim, so the expired-token path is never reached at all.
 */
async function inviteRecipientIfOwed(params: {
  request: Record<string, any>;
  alreadyNotified: boolean;
  fulfillmentState: string;
  fetchImpl?: typeof fetch;
}): Promise<ConsumerNotificationResult> {
  const notification: ConsumerEmailNotification = "recipient_delivery_invitation";
  if (params.alreadyNotified) {
    return { notification, outcome: "skipped", reason: "already_notified" };
  }
  if (TERMINAL_FULFILLMENT_STATES.has(params.fulfillmentState)) {
    return { notification, outcome: "skipped", reason: "delivery_is_over" };
  }
  return sendRecipientInvitation({ request: params.request, fetchImpl: params.fetchImpl });
}

/**
 * Claim the one recipient-email delivery attempt and send it.
 *
 * CLAIM BEFORE SEND, RECEIPT AFTER — the order is the whole safety property. A
 * claim that is not followed by a receipt is revocable after its two-minute
 * lease, so a process that dies between the two costs one retry rather than a
 * token that can never be replaced.
 */
async function sendRecipientInvitation(params: {
  request: Record<string, any>;
  fetchImpl?: typeof fetch;
}): Promise<ConsumerNotificationResult> {
  const notification: ConsumerEmailNotification = "recipient_delivery_invitation";
  const recipientEmail = str(params.request.recipient_email);
  if (!recipientEmail) {
    return { notification, outcome: "skipped", reason: "no_recipient_email" };
  }

  const claimed = await claimConsumerRecipientTrackingDelivery({
    requestId: String(params.request.id),
  });
  if (isTrackingFailure(claimed)) {
    return { notification, outcome: "failed", reason: "claim_" + claimed.code };
  }
  if (claimed.value.outcome !== "issued") {
    // `sent` — already delivered and receipted. `in_progress` — another worker
    // holds the two-minute lease. Both are "do nothing", which is what makes a
    // page refresh, a duplicated webhook and an overlapping tick all harmless.
    return { notification, outcome: "skipped", reason: claimed.value.outcome };
  }

  const rawToken = claimed.value.token;
  const rendered = custDirectDeliveryConfirmed(defaultEmailConfig, {
    senderName: str(params.request.consumer_contact_snapshot?.name) || undefined,
    recipientName: str(params.request.recipient_name) || "there",
    reference: String(params.request.reference),
    dropoffLabel: dropoffLabel(params.request.dropoff_address),
    trackUrl: emailUrl(defaultEmailConfig, `/track/${encodeURIComponent(rawToken)}`),
    /* EVERY governed consumer recipient attests, not only a protected handoff.
       This is the SAME defect tracking/projection.ts already carries a fix and a
       comment for — 20260917130000 widened the rule in SQL and only one of the
       two readers was updated. The consequence here is worse than a wrong flag:
       private.couranr_enforce_consumer_dropoff_custody refuses the handoff with
       recipient_adult_attestation_required for EVERY governed consumer
       delivery, and protected_handoff is the one tier that cannot be sold — so
       for every shipment Couranr can actually sell, the recipient's only
       proactive notification omitted the one thing that blocks their delivery.

       protection_level is a safe proxy for "governed":
       couranr_dr_protection_completeness_chk makes declared value, level and
       policy version all-or-nothing, so a non-null level means governed. */
    recipientAdultAttestationRequired:
      typeof params.request.protection_level === "string" &&
      params.request.protection_level.length > 0,
  });

  const result = await deliver({
    notification,
    rendered,
    to: recipientEmail,
    /* Scoped to THIS claim's token hash, so the retry after a revoke carries a
       different key and is genuinely re-sent rather than deduplicated away. */
    idempotencyKey: consumerEmailIdempotencyKey.recipientDeliveryInvitation(
      hashTrackingToken(rawToken)
    ),
    fetchImpl: params.fetchImpl,
  });

  if (result.outcome !== "sent") {
    /* REVOKE, so the next tick's claim issues a fresh token. Without this the
       claim would answer `in_progress` for two minutes and then replace the
       token anyway — the explicit revoke makes the retry immediate and records
       WHY in `revoked_reason`. */
    const revoked = await failRecipientTrackingNotification({
      rawToken,
      reason: `recipient_email_${result.reason ?? "not_sent"}`,
    });
    if (isTrackingFailure(revoked)) {
      record("consumerLifecycle.invitation.revokeFailed", { code: revoked.code });
    }
    return result;
  }

  const marked = await markRecipientTrackingNotification({
    rawToken,
    providerId: String(result.providerId ?? ""),
  });
  if (isTrackingFailure(marked)) {
    /* The message is out but the receipt is not recorded, so nothing can prove
       this token was delivered. Fail CLOSED: revoke it and let the next tick
       issue a link that is provably live. The recipient may receive a second
       invitation; the alternative is a live token with no audit trail. */
    await failRecipientTrackingNotification({
      rawToken,
      reason: "recipient_email_receipt_not_recorded",
    });
    return { notification, outcome: "failed", reason: "receipt_not_recorded" };
  }
  return result;
}

/* -------------------------------------------------------------- sweeps --- */

type SweepRow = { id: string; to_state: string | null; created_at: string | null };

/**
 * The events this request owes a notification for.
 *
 * `gte("created_at", since)` IS THE SAFETY PROPERTY, not an optimisation. A
 * request stays `confirmed` forever — nothing in this schema moves it out — so
 * the 5-minute tick would otherwise re-attempt the same `delivered` event every
 * five minutes for the life of the row, and the moment the provider's 24-hour
 * idempotency window expired it would send a real second email, then a third
 * the next day. The window closing first is what makes that impossible.
 */
async function loadRecentEvents(params: {
  table: "couranr_delivery_request_events" | "couranr_delivery_events";
  column: "request_id" | "delivery_id";
  id: string;
  states: string[];
  since: string;
}): Promise<SweepRow[]> {
  const { data, error } = (await supabaseAdmin
    .from(params.table)
    .select("id,to_state,created_at")
    .eq(params.column, params.id)
    .in("to_state", params.states)
    .gte("created_at", params.since)
    .order("created_at", { ascending: true })
    .limit(EVENT_SCAN_LIMIT)) as { data: any[] | null; error: any };
  if (error) {
    record("consumerLifecycle.loadRecentEvents", { table: params.table, message: error.message });
    return [];
  }
  return (data ?? []) as SweepRow[];
}

/* -------------------------------------------------------------- driver --- */

/**
 * Run every consumer notification this request currently owes.
 *
 * TOTAL. Any failure — a dead database, a malformed row, a provider outage —
 * becomes a logged, reported non-event. The caller is the lifecycle, and the
 * lifecycle must not fail because mail did.
 */
export async function notifyConsumerLifecycle(
  options: ConsumerLifecycleNotificationOptions
): Promise<ConsumerLifecycleNotificationReport> {
  const requestId = String(options.requestId ?? "");
  const report: ConsumerLifecycleNotificationReport = {
    requestId,
    eligible: false,
    results: [],
  };

  try {
    if (!requestId) {
      report.reason = "no_request_id";
      return report;
    }

    /* ASKED BEFORE ANYTHING ELSE. In an unarmed environment every send would
       come back `disabled_outside_production`, and the invitation path would
       then revoke the token it had just claimed — on every tick, forever. The
       old inline block in consumer/send.ts had its own copy of this predicate
       for the same reason; there is one reading of it now, in email/send.ts. */
    if (!emailSendingIsArmed()) {
      report.reason = "email_sending_not_armed";
      return report;
    }

    const { data: request, error } = (await supabaseAdmin
      .from("couranr_delivery_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .maybeSingle()) as { data: any; error: any };
    if (error) {
      record("consumerLifecycle.loadRequest", { requestId, message: error.message });
      report.reason = "request_load_failed";
      return report;
    }
    /* The direct-consumer lane only. A merchant request has its own audiences,
       its own templates and a business_account_id, and
       `couranr_claim_consumer_recipient_tracking_delivery` refuses it with
       CR409 — so running this for every merchant request the tick touches would
       manufacture a failure log per request per five minutes. */
    if (!request || request.requester_kind !== "consumer" || request.business_account_id !== null) {
      report.reason = "not_a_direct_consumer_request";
      return report;
    }
    report.eligible = true;

    const since = new Date(
      Date.now() - CONSUMER_NOTIFICATION_LOOKBACK_MINUTES * 60 * 1000
    ).toISOString();
    const senderEmail = str(request.consumer_contact_snapshot?.email);
    const senderName = str(request.consumer_contact_snapshot?.name) || undefined;
    const recipientName = str(request.recipient_name) || "your recipient";
    const reference = String(request.reference ?? "");
    const statusUrl = emailUrl(defaultEmailConfig, "/send");

    const { data: delivery, error: deliveryError } = (await supabaseAdmin
      .from("couranr_deliveries")
      .select("id,proof_method,timezone,fulfillment_state")
      .eq("request_id", requestId)
      .maybeSingle()) as { data: any; error: any };
    if (deliveryError) {
      record("consumerLifecycle.loadDelivery", { requestId, message: deliveryError.message });
      report.reason = "delivery_load_failed";
      return report;
    }

    /* The recipient's invitation goes FIRST, so the sender's "confirmed" email
       can state the notification as a fact rather than a promise. */
    let recipientNotified = (await recipientNotifiedAt(requestId)) !== null;
    if (request.request_state === "confirmed") {
      report.results.push(
        await inviteRecipientIfOwed({
          request,
          alreadyNotified: recipientNotified,
          fulfillmentState: str(delivery?.fulfillment_state),
          fetchImpl: options.fetchImpl,
        })
      );
      recipientNotified =
        recipientNotified ||
        report.results[report.results.length - 1].outcome === "sent";
    }

    /* ---- sender: the request's own lifecycle ---- */
    if (senderEmail) {
      const events = await loadRecentEvents({
        table: "couranr_delivery_request_events",
        column: "request_id",
        id: requestId,
        states: ["pending_couranr_review", "confirmed"],
        since,
      });
      for (const ev of events) {
        const notification: ConsumerEmailNotification =
          ev.to_state === "confirmed" ? "sender_request_confirmed" : "sender_request_received";
        /*
         * "We have your delivery" is only news while the delivery is still
         * being reviewed. The standard lane auto-accepts inside this very
         * call, so without this guard the same pass would send "received" and
         * "confirmed" a second apart — two emails saying the same thing, the
         * second contradicting the first. A request that genuinely waits in
         * review gets "received" from the tick, and "confirmed" later.
         */
        if (
          notification === "sender_request_received" &&
          request.request_state !== "pending_couranr_review"
        ) {
          report.results.push({ notification, outcome: "skipped", reason: "already_past_review" });
          continue;
        }
        const rendered =
          notification === "sender_request_confirmed"
            ? consumerSenderRequestConfirmed(defaultEmailConfig, {
                senderName,
                recipientName,
                reference,
                dropoffLabel: dropoffLabel(request.dropoff_address),
                recipientNotified,
                statusUrl,
              })
            : consumerSenderRequestReceived(defaultEmailConfig, {
                senderName,
                recipientName,
                reference,
                dropoffLabel: dropoffLabel(request.dropoff_address),
                statusUrl,
              });
        report.results.push(
          await deliver({
            notification,
            rendered,
            to: senderEmail,
            idempotencyKey: consumerEmailIdempotencyKey.forEvent(notification, String(ev.id)),
            fetchImpl: options.fetchImpl,
          })
        );
      }
    }

    /* ---- the delivery's own lifecycle ---- */
    if (!delivery?.id) return report;

    const events = await loadRecentEvents({
      table: "couranr_delivery_events",
      column: "delivery_id",
      id: String(delivery.id),
      states: ["in_transit", "delivered", "could_not_deliver", "return_required"],
      since,
    });

    const recipientEmail = str(request.recipient_email);
    const proofMethod = str(delivery.proof_method);

    for (const ev of events) {
      const state = String(ev.to_state ?? "");
      if (state === "in_transit" || state === "delivered") {
        if (!recipientEmail) continue;
        const notification: ConsumerEmailNotification =
          state === "in_transit" ? "recipient_out_for_delivery" : "recipient_delivered";
        const rendered =
          state === "in_transit"
            ? consumerRecipientOutForDelivery(defaultEmailConfig, {
                senderName,
                recipientName: str(request.recipient_name) || "there",
                reference,
                handoffMethodLabel: RECIPIENT_HANDOFF_LABEL[proofMethod] ?? "Hand to you",
                codeOnTrackingPage: proofMethod === METHOD_REQUIRES_CODE,
              })
            : consumerRecipientDelivered(defaultEmailConfig, {
                senderName,
                recipientName: str(request.recipient_name) || "there",
                reference,
                deliveredAtLabel: whenLabel(ev.created_at, str(delivery.timezone) || undefined),
              });
        report.results.push(
          await deliver({
            notification,
            rendered,
            to: recipientEmail,
            idempotencyKey: consumerEmailIdempotencyKey.forEvent(notification, String(ev.id)),
            fetchImpl: options.fetchImpl,
          })
        );
        continue;
      }

      /* could_not_deliver and return_required both go to the SENDER: the
         recipient was not there, and the sender is the party who paid, who owns
         the items and who can decide what happens next. */
      if (!senderEmail) continue;
      const notification: ConsumerEmailNotification =
        state === "could_not_deliver" ? "sender_handoff_failed" : "sender_return_notice";
      const reasonLabel =
        state === "could_not_deliver"
          ? "Couranr's driver could not complete the handoff at the drop-off address."
          : "Couranr could not complete this delivery, so the items are being returned to you.";
      const rendered =
        state === "could_not_deliver"
          ? consumerSenderHandoffFailed(defaultEmailConfig, {
              senderName,
              recipientName,
              reference,
              reasonLabel,
              statusUrl,
            })
          : consumerSenderReturnNotice(defaultEmailConfig, {
              senderName,
              recipientName,
              reference,
              reasonLabel,
              statusUrl,
            });
      report.results.push(
        await deliver({
          notification,
          rendered,
          to: senderEmail,
          idempotencyKey: consumerEmailIdempotencyKey.forEvent(notification, String(ev.id)),
          fetchImpl: options.fetchImpl,
        })
      );
    }

    return report;
  } catch (err) {
    /* THE OUTER GUARANTEE. Everything above is defensive already; this is the
       one that holds when a future edit forgets to be. A notification pass must
       never turn a captured payment into a 500. */
    record("consumerLifecycle.unhandled", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    report.reason = report.reason ?? "unhandled_error";
    return report;
  }
}

/**
 * When the recipient's invitation was ACCEPTED BY THE PROVIDER, or null.
 *
 * Reads the receipt `couranr_mark_recipient_tracking_notification` wrote —
 * `recipient_notified_at` on the token row — rather than inferring it from
 * anything this process just did. That distinction is the point: the sender's
 * status page used to stamp `new Date()` on a projection while doing the send
 * itself, so it reported a notification it had only attempted. This reports a
 * fact the database recorded.
 *
 * `.not(…, "is", null)` is load-bearing. A DESC order in PostgreSQL is NULLS
 * FIRST, so a freshly-claimed, not-yet-sent token would otherwise sort to the
 * top and answer "never notified" for a request that had been.
 *
 * ONE READER for both callers — the sender's confirmation copy and
 * `getConsumerSendView` — so the page and the email can never disagree.
 */
export async function recipientNotifiedAt(requestId: string): Promise<string | null> {
  const { data, error } = (await supabaseAdmin
    .from("couranr_delivery_access_tokens")
    .select("recipient_notified_at")
    .eq("request_id", requestId)
    .eq("audience", "recipient")
    .not("recipient_notified_at", "is", null)
    .order("recipient_notified_at", { ascending: false })
    .limit(1)) as { data: any[] | null; error: any };
  if (error) {
    record("consumerLifecycle.recipientNotifiedAtRead", { requestId, message: error.message });
    return null;
  }
  const value = data?.[0]?.recipient_notified_at;
  return value ? String(value) : null;
}
