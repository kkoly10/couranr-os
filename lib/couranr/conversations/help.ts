import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { type CustomerTopic, isCustomerTopic } from "./states";
import { type MessageRow, type ParticipantMessage, toParticipantThread } from "./projection";

assertServerOnly("lib/couranr/conversations/help.ts");

/**
 * Delivery Help — P8-004. "One-delivery token scope passes."
 *
 * SERVER ONLY. This module holds the token hashing and the service-role client.
 * A browser bundle reaching it would ship the code that turns a URL into
 * authority, and invite a client-side "verify this token" that skips the
 * database entirely.
 *
 * The raw token exists in exactly one place — the response to
 * `issueHelpToken` — and is never persisted. Everything else works from the
 * SHA-256 hash, so a database dump does not yield a working link.
 */

export const HELP_TOKEN_TTL_DAYS = 14;

export const RPC = {
  issue: "couranr_issue_help_token",
  redeem: "couranr_redeem_help_token",
  thread: "couranr_help_thread",
  post: "couranr_help_post_message",
} as const;

/**
 * 32 bytes of CSPRNG entropy, base64url.
 *
 * `randomBytes`, not `Math.random`: this value is the entire authority behind a
 * Delivery Help link, and a predictable one would let anyone reach a stranger's
 * thread by guessing.
 */
export function generateHelpToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHelpToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Shape check before any database work.
 *
 * A token that cannot be well formed is refused without a query, so a flood of
 * junk URLs cannot be used to probe timing on the tokens table.
 */
export function isWellFormedHelpToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{40,90}$/.test(v);
}

/**
 * Constant-time comparison of two hex hashes.
 *
 * Not currently on the critical path — the lookup is a UNIQUE index on the hash
 * — but exported so that any future "does this match" check uses it rather than
 * `===`, which leaks position of first difference through timing.
 */
export function hashesEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export type HelpFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type HelpResult<T> = { ok: true; value: T } | HelpFailure;

export function isHelpFailure(r: { ok: boolean }): r is HelpFailure {
  return r.ok === false;
}

/** Every refusal a link can produce, worded identically. */
const NOT_AVAILABLE = "This help link is not available.";

function fail(params: {
  code: PublicErrorCode;
  operation: string;
  detail?: unknown;
  message?: string;
}): HelpFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: HelpFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

export type RedeemedHelpLink = {
  tokenId: string;
  deliveryId: string;
  conversationId: string;
};

/**
 * Turns a raw token into its delivery and thread, creating both the thread and
 * the customer participant on first use.
 *
 * ONE REFUSAL for unknown, revoked, expired and malformed. A holder of a bad
 * link learns only that it does not work — never that it once did, which
 * "revoked" would confirm.
 */
export async function redeemHelpToken(raw: string): Promise<HelpResult<RedeemedHelpLink>> {
  if (!isWellFormedHelpToken(raw)) {
    return fail({ code: "not_found", operation: "help.redeem.shape", message: NOT_AVAILABLE });
  }

  const { data, error } = await supabaseAdmin.rpc(RPC.redeem, {
    p_token_hash: hashHelpToken(raw),
  });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "help.redeem",
      detail: error,
      message: NOT_AVAILABLE,
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return fail({ code: "not_found", operation: "help.redeem.empty", message: NOT_AVAILABLE });
  }

  return {
    ok: true,
    value: {
      tokenId: row.out_token_id,
      deliveryId: row.out_delivery_id,
      conversationId: row.out_conversation_id,
    },
  };
}

/**
 * The customer's own thread.
 *
 * Scoped by TOKEN ID, which the caller never supplies — it comes from
 * `redeemHelpToken` in the same request. The SQL function additionally requires
 * the participant be a `customer` and returns `participants` messages only, so
 * an internal note is unreachable from here twice over.
 */
export async function readHelpThread(tokenId: string): Promise<HelpResult<ParticipantMessage[]>> {
  const { data, error } = await supabaseAdmin.rpc(RPC.thread, { p_token_id: tokenId });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "help.readThread",
      detail: error,
      message: NOT_AVAILABLE,
    });
  }

  // Filtered again in TypeScript against the `customer` viewer kind. The
  // database already did it; this costs one comparison and guards the case
  // where a future change reads these rows some other way.
  return { ok: true, value: toParticipantThread((data || []) as MessageRow[], "customer") };
}

/**
 * Appends a customer message.
 *
 * THE ONLY WRITE a Delivery Help token authorizes. It cannot change an address,
 * a price, a payer, a cancellation, a refund, a return, proof or state — the
 * SQL function inserts into exactly two tables, the message and its audit row,
 * and `tests/couranr-delivery-help.test.ts` asserts that.
 *
 * A topic is REQUIRED and must be one of the seven. `other` exists so there is
 * always a valid answer, which is what makes requiring one reasonable.
 */
export async function postHelpMessage(params: {
  tokenId: string;
  body: string;
  topic: CustomerTopic;
  idempotencyKey: string;
}): Promise<HelpResult<{ messageId: string }>> {
  if (!isCustomerTopic(params.topic)) {
    return fail({
      code: "invalid_input",
      operation: "help.post.topic",
      message: "Choose one of the listed help topics.",
    });
  }

  const body = typeof params.body === "string" ? params.body.trim() : "";
  if (body.length === 0 || body.length > 4000) {
    return fail({
      code: "invalid_input",
      operation: "help.post.body",
      message: "A message must be between 1 and 4000 characters.",
    });
  }

  const { data, error } = await supabaseAdmin.rpc(RPC.post, {
    p_token_id: params.tokenId,
    p_body: body,
    p_topic: params.topic,
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "help.post",
      detail: error,
    });
  }

  return { ok: true, value: { messageId: data as unknown as string } };
}

/**
 * Issues a Delivery Help link for one delivery.
 *
 * Returns the raw token EXACTLY ONCE. It is not stored, not logged, and cannot
 * be recovered — a lost link is reissued, never retrieved.
 */
export async function issueHelpToken(params: {
  deliveryId: string;
  ttlDays?: number;
}): Promise<HelpResult<{ tokenId: string; token: string; expiresInDays: number }>> {
  const token = generateHelpToken();
  const ttl = params.ttlDays ?? HELP_TOKEN_TTL_DAYS;

  const { data, error } = await supabaseAdmin.rpc(RPC.issue, {
    p_delivery_id: params.deliveryId,
    p_token_hash: hashHelpToken(token),
    p_ttl_days: ttl,
  });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "help.issue",
      detail: error,
    });
  }

  return {
    ok: true,
    value: { tokenId: data as unknown as string, token, expiresInDays: ttl },
  };
}
