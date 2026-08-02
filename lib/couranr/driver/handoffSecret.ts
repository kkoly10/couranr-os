import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/driver/handoffSecret.ts");

/**
 * The single accessor for the handoff-code signing secret.
 *
 * ONE PLACE, NO FALLBACK. A six-digit PIN has 10^6 possibilities; the only
 * thing standing between a leaked database row and every pickup code in the
 * system is that this key is not in it. A development default, a generated
 * value or a `|| "dev-secret"` would make every digest forgeable by anyone who
 * read the source — so there is no such path, and the absence of one is
 * asserted by test rather than left to review.
 *
 * WHY GENERATION IS FORBIDDEN TOO. A key minted at boot would work perfectly
 * on one instance and produce a different digest on the next, so a code issued
 * by one serverless invocation would verify as `invalid` on another. The
 * failure would look like a user typing the wrong number.
 *
 * READ AT USE TIME. `next build` imports every route module to collect page
 * data; a module-scope read throws there and makes a clean clone unbuildable.
 * The build must succeed with no runtime secrets present — and it does,
 * because nothing here runs until a PIN command actually executes.
 */

export const HANDOFF_SECRET_ENV = "COURANR_HANDOFF_CODE_SECRET";

/**
 * 32 bytes of real entropy. Below this an HMAC key is weaker than the SHA-256
 * it feeds, and a short key is exactly what someone reaches for when setting
 * an environment variable by hand under time pressure.
 */
export const MIN_SECRET_BYTES = 32;

/**
 * Values that are technically long enough and still worthless. This list is
 * not security — a determined typo will get through it — it is a tripwire for
 * the specific mistake of shipping the example value from a runbook.
 */
const PLACEHOLDERS = [
  "changeme",
  "change-me",
  "placeholder",
  "your-secret-here",
  "replace-me",
  "todo",
  "example",
  "secret",
  "test",
  "dev",
  "development",
  "xxxxxxxx",
];

export class HandoffSecretUnavailable extends Error {
  /** Distinguishable without matching on message text. */
  readonly kind = "handoff_secret_unavailable" as const;
  constructor(reason: string) {
    // The variable NAME and a reason. Never the value, never a prefix of it,
    // never its length in a form that narrows a search.
    super(`${HANDOFF_SECRET_ENV} is not usable: ${reason}`);
    this.name = "HandoffSecretUnavailable";
  }
}

/**
 * Returns the secret, or throws `HandoffSecretUnavailable`.
 *
 * Callers map that to a sanitized `internal` failure — a PIN request without a
 * configured secret must fail CLOSED. It must never fall through to a
 * best-effort digest, because a digest computed under a degraded key would be
 * stored and would then have to be treated as valid.
 */
export function handoffSecret(): string {
  const raw = process.env[HANDOFF_SECRET_ENV];

  if (raw === undefined || raw === null) throw new HandoffSecretUnavailable("not set");

  const value = String(raw);
  if (value.trim().length === 0) throw new HandoffSecretUnavailable("empty");

  // Length in BYTES, not characters: a 32-character string of astral-plane
  // emoji and a 32-byte key are not the same amount of secret material, and
  // `String.length` cannot tell them apart.
  if (Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES) {
    throw new HandoffSecretUnavailable(`shorter than ${MIN_SECRET_BYTES} bytes`);
  }

  const lowered = value.toLowerCase();
  if (PLACEHOLDERS.some((p) => lowered === p || lowered.startsWith(p))) {
    throw new HandoffSecretUnavailable("looks like a placeholder");
  }

  // A single repeated character passes a length check and carries no entropy.
  if (new Set(value).size < 8) {
    throw new HandoffSecretUnavailable("too few distinct characters");
  }

  return value;
}

/**
 * Whether a PIN path can run at all, without throwing.
 *
 * For a route that wants to answer 503/`internal` cleanly rather than catching.
 * Deliberately returns a boolean and nothing else: a diagnostic that reported
 * WHY would let an unauthenticated caller probe the deployment's configuration.
 */
export function handoffSecretConfigured(): boolean {
  try {
    handoffSecret();
    return true;
  } catch {
    return false;
  }
}
