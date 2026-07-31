import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/payments/tokens.ts");

/**
 * Customer payment-link tokens.
 *
 * The raw token exists in exactly two places and neither is durable: the
 * response that hands the link to whoever is sending it, and the URL the
 * customer opens. It is NEVER written to the database, a log line, an event
 * metadata blob or an analytics payload. What the database holds is a SHA-256
 * hash, and `couranr_pat_hash_shape_chk` refuses anything that is not 64 hex
 * characters — so a raw token cannot be stored there even by mistake.
 *
 * A database leak therefore yields no usable link.
 */

/** 32 bytes = 256 bits of entropy, URL-safe. Guessing is not a threat model. */
export const TOKEN_BYTES = 32;

/** Seven days is the ceiling. The SQL clamps to it as well. */
export const TOKEN_TTL_DAYS = 7;

export function generatePaymentToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Lower-case hex, which is the shape the database CHECK enforces. */
export function hashPaymentToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time compare for a hash pair.
 *
 * Lookup is by hash equality in SQL, which is not constant time — but the
 * token is 256 random bits, so a timing oracle on the index buys an attacker
 * nothing. This exists for the places that do compare two hashes in process,
 * where the cheap habit is the right one.
 */
export function hashesEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * A token is only ever accepted from a path segment. Anything that is not the
 * base64url alphabet is rejected before it reaches a query, so a hash is never
 * computed over attacker-shaped input and no lookup is attempted for it.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isWellFormedToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}
