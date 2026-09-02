/**
 * Failure safety for the canonical Couranr API.
 *
 * Nothing a database or a driver says ever reaches a browser. A Supabase or
 * PostgreSQL error carries constraint names, table names, column names and
 * sometimes fragments of the failing row — a free schema map for anyone poking
 * at the API, and a source of confusing copy for anyone who is not.
 *
 * Instead: generate a correlation id, log the detail server-side under that id,
 * and return a stable sanitized object. Support can find the log line from the
 * id the merchant read off the screen.
 *
 * Pure except for `logServerFailure`, which writes to the server console.
 */

/** Stable machine codes. Safe to show, safe to key UI copy from. */
export type PublicErrorCode =
  | "unauthenticated"
  | "not_permitted"
  | "not_found"
  | "invalid_input"
  | "wrong_state"
  | "version_conflict"
  | "conflict"
  | "quote_expired"
  | "internal";

export type PublicError = {
  /** Human-readable, decision-free. Never contains a database detail. */
  error: string;
  code: PublicErrorCode;
  /** Quote this to Couranr Support to find the server log line. */
  correlationId: string;
  /**
   * Present ONLY for `invalid_input`, and only ever our own field-level codes
   * from `lib/couranr/requests/input.ts`. Never a driver message.
   */
  details?: Array<{ code: string; field?: string }>;
};

const CORRELATION_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * A short, unambiguous id a person can read aloud. Not a secret and not a
 * security control — it only has to be unique enough to find a log line.
 */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(12);
  // `crypto` is global in Node 18+ and in the browser. This module is used
  // server-side, but the fallback keeps it from throwing if that ever changes.
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) % 256;

  let out = "";
  for (const b of bytes) out += CORRELATION_ALPHABET[b % CORRELATION_ALPHABET.length];
  return `cr_${out}`;
}

/**
 * Fields that must never be forwarded. Kept as a list so the redactor is
 * auditable rather than implicit.
 */
const REDACTED = "[redacted]";

/**
 * Writes the real failure to the server log, keyed by correlation id.
 *
 * Server-side only: this is the ONE place a raw driver error is allowed to
 * appear, and it never returns anything to a caller.
 */
export function logServerFailure(params: {
  correlationId: string;
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
}): void {
  const detail = params.detail;
  const serializable =
    detail instanceof Error
      ? { name: detail.name, message: detail.message, stack: detail.stack }
      : detail;

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      scope: "couranr",
      correlationId: params.correlationId,
      operation: params.operation,
      code: params.code,
      detail: serializable,
    })
  );
}

const DEFAULT_MESSAGE: Record<PublicErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  not_permitted: "You do not have access to this.",
  not_found: "This was not found.",
  invalid_input: "Some details need attention.",
  wrong_state: "This has already moved on. Reload to see the current version.",
  version_conflict:
    "This changed while you were working on it. Reload and try again.",
  conflict: "This could not be completed. Reload and try again.",
  quote_expired:
    "This estimate is no longer current. Recalculate to get an up-to-date price before continuing.",
  internal: "Something went wrong on our side. Nothing was changed.",
};

export const PUBLIC_STATUS: Record<PublicErrorCode, number> = {
  unauthenticated: 401,
  not_permitted: 403,
  not_found: 404,
  invalid_input: 400,
  wrong_state: 409,
  version_conflict: 409,
  conflict: 409,
  quote_expired: 409,
  internal: 500,
};

/**
 * Builds the object that goes over the wire.
 *
 * `details` is accepted only for `invalid_input`, and each entry is reduced to
 * `{ code, field }` — so even if a caller hands this a driver error by mistake,
 * nothing but two strings can escape, and only if they look like field codes.
 */
export function publicError(params: {
  correlationId: string;
  code: PublicErrorCode;
  message?: string;
  details?: unknown;
}): PublicError {
  const body: PublicError = {
    error: params.message || DEFAULT_MESSAGE[params.code],
    code: params.code,
    correlationId: params.correlationId,
  };

  if (params.code === "invalid_input" && Array.isArray(params.details)) {
    const safe = params.details
      .map((d: any) => {
        if (typeof d === "string") return { code: sanitizeToken(d) };
        if (d && typeof d === "object" && typeof d.code === "string") {
          return d.field && typeof d.field === "string"
            ? { code: sanitizeToken(d.code), field: sanitizeToken(d.field) }
            : { code: sanitizeToken(d.code) };
        }
        return null;
      })
      .filter(Boolean) as Array<{ code: string; field?: string }>;
    if (safe.length > 0) body.details = safe;
  }

  return body;
}

/**
 * A field code is a short machine token. Anything that is not one is replaced
 * rather than truncated, so a leaked sentence cannot survive as a prefix.
 */
function sanitizeToken(value: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : REDACTED;
}

/**
 * Maps a PostgREST/PostgreSQL error to a public code WITHOUT forwarding it.
 *
 * The `CR*` codes are raised deliberately by the Couranr command functions.
 * Everything else — including every constraint violation — collapses to
 * `internal`, because a constraint name is a schema detail.
 */
export function classifyDatabaseError(err: any): PublicErrorCode {
  const code = typeof err?.code === "string" ? err.code : "";
  switch (code) {
    case "CR400":
      // The caller sent something this command cannot accept. Distinct from a
      // route-level validation failure only in where it was caught: the SQL is
      // the authority on its own preconditions, and a shape the database
      // rejects must not read to the caller as our bug.
      return "invalid_input";
    case "CR403":
      // Raised by the dispatch and driver commands for "this actor may not do
      // this to this row". It was documented as the family's forbidden code
      // from the first dispatch migration but never mapped, so every CR403
      // fell through `default` and surfaced as HTTP 500 — a refusal reported
      // as a server fault. The one working handler in the tree is a
      // hand-written ternary at onboarding/commands.ts; this makes it general.
      return "not_permitted";
    case "CR404":
      return "not_found";
    case "CR409":
      return "version_conflict";
    case "CR412":
      // A precondition the caller can act on, NOT a concurrency race. Kept
      // distinct from version_conflict because "reload and try again" is
      // actively wrong advice here — reloading changes nothing.
      return "conflict";
    case "CR410":
      // QVL-001. The quote passed its 15-minute validity window before it was
      // accepted, acknowledged or authorized. Distinct from every other code
      // here because the remedy is specific and the caller CAN act on it:
      // recalculate, which mints Quote N+1. Reloading alone changes nothing.
      return "quote_expired";
    case "CR422":
      // The server passed itself an inconsistent quote. That is our bug, not
      // the caller's input, so it must not read as a validation failure.
      // Reserved for INTERNAL INVARIANT failures only — a driver sending bad
      // input gets CR400, never this.
      return "internal";
    case "42501": // insufficient_privilege
      return "not_permitted";
    default:
      return "internal";
  }
}
