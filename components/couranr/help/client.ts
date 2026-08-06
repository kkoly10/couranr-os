"use client";

import type { CustomerTopic } from "@/lib/couranr/conversations/states";

/**
 * Browser data access for Delivery Help.
 *
 * NOT the Bearer-token helper used by the merchant and driver surfaces: this
 * page has no session and never will. The recipient of a delivery has no
 * Couranr account, so the token in the URL is the whole authorization — carried
 * in the path exactly as the tracking link is.
 *
 * Unlike the tracking client, this one DOES have a mutating call. That is the
 * single write a help token authorizes: appending a message to one thread. It
 * cannot change an address, a price, a payer, a cancellation, a refund, a
 * return, proof or state, and there is no route here that could.
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
    return { resolved: true, view: payload as HelpView };
  } catch {
    return { failed: true };
  }
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

/** A per-message key, stable across retries of the same composed message. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
