import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { HANDOFF_SECRET_ENV, handoffSecret } from "@/lib/couranr/driver/handoffSecret";

assertServerOnly("lib/couranr/driver/codes.ts");

export { HANDOFF_SECRET_ENV };

/**
 * Handoff codes: sender pickup, recipient drop-off, and sender return PIN.
 *
 * SEPARATE CREDENTIALS, NEVER ONE. Different handoff moments/holders get separate
 * records, generations, attempt counters, lock states and — critically —
 * separate HMAC domains. Compromising one must not weaken the other, and a
 * digest computed for a pickup code must never verify as a drop-off code even
 * if the six digits happen to match.
 *
 * WHY A KEYED DIGEST, WHERE THE PAYMENT TOKENS USE A BARE HASH.
 * `lib/couranr/payments/tokens.ts` stores an unkeyed SHA-256 and says in its
 * own comment that "guessing is not a threat model" — true, because the input
 * is 256 random bits. A six-digit PIN has 10^6 possibilities. An unkeyed
 * SHA-256 of one is exhaustible offline in microseconds from a single leaked
 * row, so the whole credential would rest on the database never leaking. An
 * HMAC under a secret that lives only in the environment means a database dump
 * yields nothing without also compromising the server.
 *
 * That is why the digest is computed HERE and not in SQL. pgcrypto is
 * installed and `extensions.hmac` works, but putting the key in the database
 * would put both halves in the same place, and every command function runs
 * `set search_path = ''`, where an unqualified `hmac()` raises 42883 at
 * runtime while the SQL reads correctly and the tests stay green.
 *
 * The raw code exists in exactly two places, neither durable: the issuance
 * response, and whatever the holder does with it. It is never stored, never
 * logged, never put in analytics, and never returned again after issuance.
 */

export const CODE_KINDS = ["merchant_pickup", "recipient_dropoff", "merchant_return"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** Six digits, because a person reads it aloud. The lockout carries the safety. */
export const CODE_DIGITS = 6;

/**
 * Domain separation, versioned.
 *
 *   pickup:v1:<delivery-id>:<generation>:<code>
 *   recipient:v1:<delivery-id>:<generation>:<code>
 *
 * The generation is inside the signed input, not merely beside it. Without it,
 * regenerating a code would produce the same digest for the same six digits,
 * so an invalidated code would silently verify against its replacement — which
 * is the one thing regeneration exists to prevent.
 */
const DOMAIN: Record<CodeKind, string> = {
  merchant_pickup: "pickup:v1",
  recipient_dropoff: "recipient:v1",
  merchant_return: "return:v1",
};

/**
 * Read at USE time through the single hardened accessor, which rejects an
 * absent, empty, short or placeholder value and has no fallback of any kind.
 *
 * The alternative — `process.env.X!` — is what makes a missing secret into the
 * literal string "undefined" and keys every digest in the system on it: a
 * silent, uniform, attacker-known key that still produces plausible digests.
 */
const secret = handoffSecret;

/**
 * A uniformly distributed six-digit code, leading zeros preserved.
 *
 * `randomInt` is rejection-sampled by Node, so unlike `randomBytes(4) % 10^6`
 * it has no modulo bias. The bias would be small; it would also be free to
 * avoid, and a biased credential is the kind of thing nobody re-derives later.
 */
export function generateHandoffCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/** Exactly `CODE_DIGITS` ASCII digits. Anything else never reaches a digest. */
const CODE_RE = new RegExp(`^[0-9]{${CODE_DIGITS}}$`);

export function isWellFormedHandoffCode(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

/**
 * The keyed digest, lower-case hex — the shape
 * `couranr_hc_digest_shape_chk` enforces, so a raw PIN cannot be stored even
 * by mistake.
 */
export function handoffCodeDigest(input: {
  kind: CodeKind;
  deliveryId: string;
  generation: number;
  code: string;
}): string {
  if (!isWellFormedHandoffCode(input.code)) {
    // Never interpolate the code into the message.
    throw new Error("A handoff code must be exactly six digits.");
  }
  if (!Number.isInteger(input.generation) || input.generation < 1) {
    throw new Error("A handoff code generation must be a positive integer.");
  }
  const message = `${DOMAIN[input.kind]}:${input.deliveryId}:${input.generation}:${input.code}`;
  return createHmac("sha256", secret()).update(message, "utf8").digest("hex");
}

/**
 * Constant-time digest comparison.
 *
 * It matters here in a way it did not for the payment tokens. Those are looked
 * up by hash equality in an index over 256-bit inputs, where a timing oracle
 * buys nothing. A six-digit code has a small enough space that a byte-at-a-
 * time comparison is a real oracle, so the compare never short-circuits.
 */
export function digestsEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verifies a submitted code against a stored digest.
 *
 * Returns a boolean and nothing else — no reason, no partial match, no attempt
 * count. What the DRIVER is told is decided by the command, from the closed
 * `accepted | invalid | locked | expired` vocabulary, so this function cannot
 * leak lock state or attempt history through its return type.
 */
export function verifyHandoffCode(input: {
  kind: CodeKind;
  deliveryId: string;
  generation: number;
  code: string;
  storedDigest: string;
}): boolean {
  if (!isWellFormedHandoffCode(input.code)) return false;
  let computed: string;
  try {
    computed = handoffCodeDigest(input);
  } catch {
    return false;
  }
  return digestsEqual(computed, input.storedDigest);
}

/** 32 hex characters of entropy, matching `couranr_pu_nonce_shape_chk`. */
export function generateUploadNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Removes anything that could be a handoff code from a string bound for a log
 * line, a correlation record or an error detail.
 *
 * Defence in depth, and deliberately blunt. The commands are written so a raw
 * code never reaches a diagnostic in the first place; this exists because
 * "never" is a property of today's call graph, and the next person to add a
 * `detail:` field will not re-derive it. Any run of exactly six digits is
 * replaced — over-redacting a package count in a log line costs nothing, and
 * under-redacting a PIN costs the credential.
 */
export function redactHandoffCodes(value: string): string {
  if (typeof value !== "string") return value;
  return value.replace(/(?<![0-9])[0-9]{6}(?![0-9])/g, "[redacted-code]");
}

/**
 * The one place a raw code is allowed to exist in a response, and the shape
 * that says so. Returned ONLY by an authorized issuance command; nothing reads
 * it back afterwards, because nothing stores it.
 */
export type IssuedHandoffCode = {
  code: string;
  kind: CodeKind;
  generation: number;
  expiresAt: string;
  /** Shown to whoever issued it. The code is not recoverable after this. */
  warning: string;
};

export const CODE_SHOWN_ONCE_WARNING =
  "Write this code down now — Couranr cannot show it again. Issue a new one if it is lost.";
