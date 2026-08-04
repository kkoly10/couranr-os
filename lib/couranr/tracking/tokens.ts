import {
  generateAccessToken,
  hashAccessToken,
  isWellFormedAccessToken,
} from "@/lib/couranr/accessTokens";
import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/tracking/tokens.ts");

/**
 * Customer tracking-link tokens.
 *
 * Same entropy, same hash, same accepted shape as the payment link — one
 * implementation, in `lib/couranr/accessTokens.ts`. What differs is the
 * lifetime, and only the lifetime.
 *
 * WHY 30 DAYS AND NOT THE PAYMENT LINK'S 7.
 * `02_DECISION_REGISTRY.json` settles the lifetime of the SIGNED MEDIA URL
 * (PHO-001: 600 seconds for a customer) and is silent on the lifetime of the
 * tracking link. Three things decide it here:
 *
 *   1. The payment link's ceiling bounds an unclaimed AUTHORIZATION. None of
 *      that reasoning transfers to a read-only status page.
 *   2. This token does not grant proof media. It grants the right to ASK for a
 *      600-second signed URL, re-authorized on every request, so a longer-lived
 *      token widens nothing PHO-001 narrowed.
 *   3. A recipient needs the link AFTER the delivery, not only during it —
 *      CUS-006 is the proof viewer and CUS-007 is return and refund status,
 *      both read after the fact.
 *
 * `couranr_issue_delivery_access_token` clamps to the same 30 days in SQL, so
 * a caller that ignores this constant still cannot ask for more.
 */
export const TRACKING_TOKEN_TTL_DAYS = 30;

export function generateTrackingToken(): string {
  return generateAccessToken();
}

export function hashTrackingToken(raw: string): string {
  return hashAccessToken(raw);
}

export function isWellFormedTrackingToken(v: unknown): v is string {
  return isWellFormedAccessToken(v);
}
