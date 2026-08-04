import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/accessTokens.ts");

/**
 * The primitives behind every Couranr link that authorizes by URL.
 *
 * There are two such links — the customer payment link and the customer
 * tracking link — and there must be exactly ONE implementation of the entropy,
 * the hash and the accepted shape. A second copy is a second chance to
 * generate 16 bytes where the other generates 32, or to hash with a different
 * encoding, and the failure would be silent: links would still work, just with
 * less security than the comment claims.
 *
 * The invariant every caller depends on:
 *
 *   * the RAW token exists in exactly two places, neither durable — the
 *     response that hands the link over, and the URL the customer opens
 *   * the DATABASE holds only a SHA-256 hash, and each token table's
 *     `~ '^[0-9a-f]{64}$'` CHECK refuses anything that is not one, so a raw
 *     token cannot be stored there even by mistake
 *   * a database leak therefore yields no usable link
 */

/** 32 bytes = 256 bits of entropy, URL-safe. Guessing is not a threat model. */
export const TOKEN_BYTES = 32;

export function generateAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Lower-case hex, which is the shape the database CHECKs enforce. */
export function hashAccessToken(raw: string): string {
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

export function isWellFormedAccessToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}
