import {
  generateAccessToken,
  hashAccessToken,
  hashesEqual as sharedHashesEqual,
  isWellFormedAccessToken,
  TOKEN_BYTES as SHARED_TOKEN_BYTES,
} from "@/lib/couranr/accessTokens";
import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/payments/tokens.ts");

/**
 * Customer payment-link tokens.
 *
 * The entropy, the hash and the accepted shape now live in
 * `lib/couranr/accessTokens.ts`, shared with the customer tracking link. The
 * names here are unchanged and so is every value they produce — this module is
 * the payment-specific policy (its TTL) plus the vocabulary its callers
 * already import.
 *
 * The security properties are the shared module's, restated because they are
 * what the payment routes depend on: the raw token is never persisted, logged
 * or recoverable; the database holds a SHA-256 hash; and
 * `couranr_pat_hash_shape_chk` refuses anything that is not 64 hex characters,
 * so a raw token cannot be stored there even by mistake.
 */

export const TOKEN_BYTES = SHARED_TOKEN_BYTES;

/**
 * Seven days is the ceiling, and it is a PAYMENT constraint: it bounds how
 * long an authorization may sit unclaimed. The tracking link is read-only and
 * carries its own, longer ceiling — see `lib/couranr/tracking/tokens.ts`.
 */
export const TOKEN_TTL_DAYS = 7;

export function generatePaymentToken(): string {
  return generateAccessToken();
}

export function hashPaymentToken(raw: string): string {
  return hashAccessToken(raw);
}

export function hashesEqual(a: string, b: string): boolean {
  return sharedHashesEqual(a, b);
}

export function isWellFormedToken(v: unknown): v is string {
  return isWellFormedAccessToken(v);
}
