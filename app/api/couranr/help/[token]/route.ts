import { NextRequest, NextResponse } from "next/server";
import { routeFailure } from "@/lib/couranr/requests/respond";
import {
  isHelpFailure,
  isWellFormedHelpToken,
  postHelpMessage,
  readHelpThread,
  redeemHelpToken,
} from "@/lib/couranr/conversations/help";
import { COURANR_TIMEZONE } from "@/lib/couranr/hours/operatingHours";
import {
  CUSTOMER_TOPICS,
  SUPPORT_TARGET_MINUTES,
  isCustomerTopic,
} from "@/lib/couranr/conversations/states";

export const dynamic = "force-dynamic";

/**
 * PUB-007 — Delivery Help, at `/help/[token]`.
 *
 * UNAUTHENTICATED BY DESIGN. The token is the credential: "Customer Delivery
 * Help is limited by one signed token and one delivery." There is no session,
 * because the recipient of a delivery has no account.
 *
 * Every refusal — malformed, unknown, revoked, expired — is worded identically
 * and returns the same status. A holder of a bad link must not learn which kind
 * of bad it is; "revoked" in particular would confirm the link once existed.
 *
 * The token appears in the URL path, so it will land in server logs and browser
 * history. That is the accepted cost of a link a recipient can open from an SMS,
 * and is why the credential is scoped to one delivery, expires in 14 days, and
 * authorizes exactly one write.
 */

function refuse() {
  // One shape for every failure, so the response cannot be used as an oracle.
  return routeFailure("not_found", "This help link is not available.");
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  // Shape first, in the ROUTE, before any database work. A token that cannot be
  // well formed is refused without a query, so a flood of junk URLs cannot be
  // used to probe timing on the tokens table.
  if (!isWellFormedHelpToken((await ctx.params)?.token)) return refuse();

  const link = await redeemHelpToken((await ctx.params).token);
  if (isHelpFailure(link)) return refuse();

  const thread = await readHelpThread(link.value.tokenId);
  if (isHelpFailure(thread)) return refuse();

  return NextResponse.json({
    // The conversation id is returned so the page can post without a second
    // redemption. It is not a credential — every write re-resolves the token.
    conversationId: link.value.conversationId,
    messages: thread.value,
    topics: CUSTOMER_TOPICS,
    // "State the normal 15-minute response target during operating hours, not a
    // guarantee." — PUB-007's mandatory correction.
    supportTargetMinutes: SUPPORT_TARGET_MINUTES,
    // HRS-002 is decided (America/New_York). The response clock a customer is
    // told about now runs in operating minutes, so a Sunday message is not
    // recorded overdue fifteen minutes later.
    operatingHoursApplied: true,
    operatingTimezone: COURANR_TIMEZONE,
    // "No public support phone at MVP." Stated so no surface invents one.
    supportPhone: null,
  });
}

/**
 * POST — send a message as the token holder.
 *
 * A topic is required. It is what routes the thread in the Operations Inbox,
 * and `other` exists so there is always a valid answer.
 *
 * CUS-001 (address change) and CUS-003 (recipient unavailable) are fragments of
 * this route in UI_SCREEN_REGISTRY.md — `/help/[token]#address-change` and
 * `#recipient-unavailable`. They are topics on this endpoint, not separate
 * write paths, and neither changes an address or a delivery: a customer raising
 * an address concern creates an Operations review item, never an address
 * update. "A message never directly mutates address, price, payer,
 * cancellation, return, proof, or state."
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!isWellFormedHelpToken((await ctx.params)?.token)) return refuse();

  const link = await redeemHelpToken((await ctx.params).token);
  if (isHelpFailure(link)) return refuse();

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  if (!isCustomerTopic(payload?.topic)) {
    return routeFailure("invalid_input", "Choose one of the listed help topics.");
  }
  if (typeof payload?.idempotencyKey !== "string" || !payload.idempotencyKey.trim()) {
    return routeFailure("invalid_input", "An idempotency key is required.");
  }

  const sent = await postHelpMessage({
    tokenId: link.value.tokenId,
    body: typeof payload?.body === "string" ? payload.body : "",
    topic: payload.topic,
    idempotencyKey: payload.idempotencyKey,
  });

  if (isHelpFailure(sent)) {
    // A validation refusal is the caller's to fix and says so. Anything else
    // collapses to the single link refusal.
    if (sent.code === "invalid_input") {
      return routeFailure(sent.code, sent.message);
    }
    return refuse();
  }

  return NextResponse.json({ messageId: sent.value.messageId }, { status: 201 });
}
