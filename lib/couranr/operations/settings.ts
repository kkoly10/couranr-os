import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { redactHandoffCodes } from "@/lib/couranr/driver/codes";
import { sanitizeDescriptionForProvider } from "@/lib/couranr/intake/sanitize";

assertServerOnly("lib/couranr/operations/settings.ts");

/**
 * OPS-015 / OPS-016 / OPS-020 — the Operations settings server layer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS NOT ALLOWED TO DO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. **It does not own a single governed number.** OPS-015's constraint is "No
 *    mock value overrides the Decision Registry." Operating days, the
 *    06:00–18:00 window, the 16:00 same-day cutoff, the overnight window and
 *    the overnight surcharge are HRS-001, HRS-002 and OVN-001, and they are
 *    already carried by `lib/couranr/hours/operatingHours.ts`,
 *    `lib/couranr/timing/policy.ts` and `lib/couranr/public/governed.ts`. The
 *    availability screen renders them straight from those modules. Nothing
 *    here re-states one, and nothing an operator types can change one.
 *
 * 2. **The audit log is a READ.** There is no update, no delete, and no write
 *    path of any kind to any of the eleven event tables it reads. The absence
 *    is enforced twice: this module exports no mutator for them, and the
 *    tables' own GRANTs omit UPDATE and DELETE.
 *
 * 3. **No secret, token, digest, proof URL, gate code, phone number or full
 *    address may leave here.** OPS-020's constraint, implemented as three
 *    independent layers rather than one:
 *
 *      LAYER 1  An explicit SELECT column allow-list per table. `select("*")`
 *               appears nowhere. Free-text columns that exist purely to hold
 *               an operator's or a customer's prose — `couranr_delivery_
 *               incident_events.note`, `couranr_intake_fact_events.from_value`
 *               and `.to_value`, `couranr_market_availability.state_note` —
 *               are NEVER selected, so their contents cannot reach the output
 *               even if every later layer failed.
 *
 *      LAYER 2  Key-name denial over the jsonb payloads that ARE read, at
 *               every depth.
 *
 *      LAYER 3  Value-shape scrubbing of every surviving string, which is what
 *               makes layer 2's key list non-load-bearing: a URL stored under
 *               the key `note2` is caught by its shape, not by its name.
 *
 *    A blocklist alone would have been the wrong design — it fails silently on
 *    the one key nobody thought of, and this repo has already shipped a
 *    `put.ok` that was true while nothing was uploaded.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A TABLE THIS CODE CANNOT SEE IS A NAMED FAILURE, NEVER AN EMPTY RESULT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `business_pricing_profiles` is queried by `lib/businessPricing.ts` and does
 * not exist in the database; the error is swallowed at the call site, so
 * business-account pricing has been silently inert in production for its whole
 * life. The three tables 20260917210000 creates are NOT YET APPLIED, so this
 * module will meet exactly that condition. It reports it: a read that fails
 * because the relation is missing returns `provisioned: false` and the surface
 * says which migration is pending, rather than rendering an empty form that
 * looks like "nothing is configured".
 */

/* ══════════════════════════════════════════════════════ result plumbing ══ */

export type SettingsFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type SettingsResult<T> = { ok: true; value: T } | SettingsFailure;

/** `tsconfig` sets `"strict": false`; a bare `!r.ok` does not narrow. */
export function isSettingsFailure<T>(r: SettingsResult<T>): r is SettingsFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): SettingsFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  return { ok: false, code: params.code, correlationId, message: params.message };
}

/**
 * Is this PostgREST error "the relation does not exist"?
 *
 * BOTH spellings are checked because PostgREST answers differently depending
 * on whether its schema cache has been reloaded: `42P01` comes back from
 * PostgreSQL itself, `PGRST205` from PostgREST's own table lookup. Checking
 * one and not the other is how a pending migration gets reported as an
 * internal fault on one deploy and handled correctly on the next.
 */
export function isMissingRelationError(err: any): boolean {
  const code = String(err?.code ?? "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

/* ══════════════════════════════════════════════════════════ redaction ══ */

export const REDACTED = "[redacted]";

/**
 * Key names that carry one of OPS-020's forbidden classes. Matched
 * case-insensitively as a SUBSTRING of the key, at every depth, so `proofUrl`,
 * `signed_url` and `URL` are all caught by `url`.
 *
 * This is layer 2. It is deliberately NOT the guarantee — see `scrubString`.
 */
export const FORBIDDEN_METADATA_KEY_FRAGMENTS: readonly string[] = [
  "token",
  "secret",
  "digest",
  "hash",
  "url",
  "href",
  "link",
  "signature",
  "password",
  "credential",
  "phone",
  "tel",
  "address",
  "email",
  "apikey",
  "api_key",
  "code",
  "pin",
  "otp",
  "key",
  "note",
  "body",
  "message",
  "text",
  "content",
  "description",
  "summary",
  "name",
];

function keyIsForbidden(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_METADATA_KEY_FRAGMENTS.some((f) => k.includes(f));
}

/**
 * Value shapes that must never render, whatever key they arrived under.
 *
 * This is layer 3, and it is the layer that actually carries the guarantee.
 * Each entry names the OPS-020 class it closes:
 *
 *   URL          any scheme-bearing string, and any bare Supabase/storage path.
 *                Covers "proof URL" whether it is absolute or a bucket path.
 *   SECRET       provider key prefixes and JWTs, which are the shapes a real
 *                secret has here (`sk_`, `whsec_`, `eyJ`, `Bearer `).
 *   DIGEST       a hex run of 32+ characters. `handoffCodeDigest` returns
 *                lower-case hex; so does every SHA-256 in this repo.
 *   HIGH-ENTROPY a base64url/hex run of 24+ characters, which is the shape of
 *                the 256-bit access tokens `/pay`, `/track` and `/help` use.
 *   ADDRESS      a street-address shape, and a "City, ST 12345" shape.
 *
 * GATE CODES and PHONE NUMBERS are not here because they already have
 * purpose-built redactors this module reuses rather than re-deriving:
 * `redactHandoffCodes` (any six-digit run — deliberately blunt) and
 * `sanitizeDescriptionForProvider` (emails, phone shapes, card-shaped runs).
 */
const FORBIDDEN_VALUE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "url", re: /[a-z][a-z0-9+.-]*:\/\//i },
  { name: "storage-path", re: /\/storage\/v1\//i },
  { name: "bucket-path", re: /\b(delivery-photos|renter-licenses|docs-files|vehicle-images)\b/i },
  { name: "www", re: /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i },
  { name: "secret-prefix", re: /\b(sk_|pk_live|whsec_|rk_|Bearer\s)/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}/ },
  { name: "digest", re: /\b[0-9a-f]{32,}\b/i },
  /*
   * A full row identifier. Named explicitly rather than left to the entropy
   * rule below, because a uuid's longest unbroken run is only 12 characters.
   * This surface publishes 8-character fingerprints; a whole uuid is a join
   * key into every other table and has no place on an audit screen.
   */
  {
    name: "uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  /*
   * High-entropy credential shape, and the two measurements that shaped it.
   *
   * FIRST DRAFT: "any run of 24+ characters from [A-Za-z0-9_-]". It redacted
   * `calculate_delivery_request_estimate` (35), `create_delivery_request_draft`
   * (29) and `request_incident_evidence` (25) — command names from the very
   * tables this reads. The audit surface would have printed `[redacted]` in its
   * own verb column and looked like it was protecting something.
   *
   * SECOND DRAFT: the same thing without the underscore. That fixed the command
   * names and broke `couranr-pricing-v2-2026-09-01` (29 characters of letters,
   * digits and hyphens), which is a POLICY VERSION — and OPS-020's purpose
   * begins "Inspect state commands, policy versions…". Redacting the thing the
   * screen exists to show is not a safe default, it is a broken screen.
   *
   * WHAT ACTUALLY SEPARATES THE TWO: segment length. A credential is one long
   * unbroken run — the 256-bit tokens `/pay`, `/track` and `/help` mint are 43
   * base64url characters with no separator at all. Every identifier this
   * product writes is hyphenated or underscored into short words: the longest
   * segment in a policy version is `couranr` (7) and in a command name is
   * `disagreement` (12). So the rule reads SEGMENTS, not whole strings: 16+
   * contiguous alphanumerics carrying both a letter and a digit.
   */
  {
    name: "high-entropy",
    re: /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{16,}(?![A-Za-z0-9])/,
  },
  /* The same segment rule for an all-letter token, which carries no digit. */
  {
    name: "mixed-case-token",
    re: /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{16,}(?![A-Za-z0-9])/,
  },
  {
    name: "street-address",
    re: /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+)*\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|ter|terrace|pkwy|parkway|hwy|highway|cir|circle|apt|suite|ste|unit)\b\.?/i,
  },
  { name: "city-state-zip", re: /\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/ },
  { name: "bare-zip-plus-four", re: /\b\d{5}-\d{4}\b/ },
];

/**
 * The longest string the audit surface will render from a payload.
 *
 * A cap is a redaction control in its own right: prose long enough to hold an
 * address or a note is not a fact an audit row needs, and every forbidden
 * class above is easier to hide inside a paragraph than inside 64 characters.
 */
export const MAX_AUDIT_VALUE_LENGTH = 64;

function matchesForbiddenShape(value: string): boolean {
  // None of these carry /g, so `test` has no `lastIndex` to leak between calls
  // — a stateful regex reused across rows would skip every other match.
  return FORBIDDEN_VALUE_PATTERNS.some(({ re }) => re.test(value));
}

/**
 * Scrub one string, or refuse it entirely.
 *
 * Returns `REDACTED` — never a partially-cleaned string — whenever a forbidden
 * SHAPE is present. Partial cleaning is the wrong answer for a URL or a
 * digest: the recognizable remainder is still the thing you were hiding.
 *
 * ORDER IS LOAD-BEARING, AND IT IS SHAPE-CHECK FIRST.
 *
 * The obvious order — rewrite with the purpose-built redactors, then check
 * shapes — has a hole this one does not. `redactHandoffCodes` replaces ANY run
 * of exactly six digits, so a 64-character SHA-256 containing a six-digit run
 * comes out as `…[redacted-code]…`: two fragments, each possibly under the
 * 32-character digest threshold and under the 20-character entropy threshold,
 * and the digest then renders in halves. Checking the ORIGINAL string first
 * closes that, and a second check after rewriting closes the converse case
 * where a rewrite exposes a shape that was not visible before.
 */
export function scrubString(input: string): string {
  if (typeof input !== "string") return REDACTED;
  const trimmed = input.trim();
  if (trimmed === "") return "";

  // 1. The string as it actually arrived.
  if (matchesForbiddenShape(trimmed)) return REDACTED;

  // 2. Purpose-built rewrites: gate codes, then emails/phones/card-shaped runs.
  let out = redactHandoffCodes(trimmed);
  out = sanitizeDescriptionForProvider(out).sanitized;

  // 3. And again, because a rewrite can expose a shape step 1 could not see.
  if (matchesForbiddenShape(out)) return REDACTED;

  if (out.length > MAX_AUDIT_VALUE_LENGTH) return REDACTED;
  return out;
}

/**
 * A number is scrubbed through its own string form.
 *
 * Returning every finite number untouched was a hole: a phone number stored as
 * a JSON number (`5551234567`) is a phone number, and `typeof v === "number"`
 * is not a safety property. Ordinary audit numbers — counts, minutes, miles,
 * cents — survive unchanged because none of them has a forbidden shape.
 */
function scrubNumber(value: number): number | string {
  if (!Number.isFinite(value)) return REDACTED;
  return scrubString(String(value)) === String(value) ? value : REDACTED;
}

const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_ENTRIES = 20;

/**
 * Project a jsonb payload down to what an auditor may see.
 *
 * Deny by default at every level: a value survives only if it is a boolean, a
 * finite number, a string that passes `scrubString`, or a bounded container of
 * those. Anything else — a function, a date object, a cycle, a value past the
 * depth or entry cap — becomes `REDACTED`. Nothing is passed through untouched.
 */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return scrubNumber(value);
  if (typeof value === "string") return scrubString(value);

  if (depth >= MAX_METADATA_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_METADATA_ENTRIES).map((v) => redactMetadata(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_METADATA_ENTRIES) break;
      n += 1;
      out[k] = keyIsForbidden(k) ? REDACTED : redactMetadata(v, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

/**
 * A short label, scrubbed. Used for every scalar that reaches the audit row:
 * command names, states, roles, outcomes. They are closed vocabularies today,
 * which is exactly why they are scrubbed anyway — the next command name is
 * written by someone who has not read this file.
 */
function scrubLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(scrubNumber(value));
  if (typeof value !== "string") return REDACTED;
  return scrubString(value);
}

/**
 * An actor id is rendered as a SHORT PREFIX, never in full.
 *
 * An auditor needs to tell two actors apart and to recognise one they have
 * seen before; neither needs the whole identifier, and a full `auth.users.id`
 * on screen is a join key into every other table. Eight hex characters
 * distinguish any plausible number of Operations users.
 */
export function actorFingerprint(userId: unknown): string | null {
  if (typeof userId !== "string" || userId.length === 0) return null;
  return `${userId.replace(/-/g, "").slice(0, 8)}…`;
}

/* ═══════════════════════════════════════════════════════ the audit read ══ */

/** The eleven append-only event tables OPS-020 inspects. */
export const AUDIT_SOURCES = [
  "delivery_request_events",
  "delivery_events",
  "delivery_incident_events",
  "assignment_events",
  "payment_events",
  "conversation_events",
  "activation_events",
  "customer_problem_report_events",
  "intake_fact_events",
  "team_events",
  "operations_setting_events",
] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  delivery_request_events: "Delivery requests",
  delivery_events: "Deliveries",
  delivery_incident_events: "Incidents",
  assignment_events: "Dispatch assignments",
  payment_events: "Payment events",
  conversation_events: "Conversations",
  activation_events: "Workspace activation",
  customer_problem_report_events: "Customer problem reports",
  intake_fact_events: "Smart intake facts",
  team_events: "Team membership",
  operations_setting_events: "Operations settings",
};

export type AuditSeverity = "normal" | "security_alert";

export type AuditEntry = {
  /** `<source>:<row id>` — stable, and never a join key on its own. */
  id: string;
  source: AuditSource;
  createdAt: string;
  /** merchant | customer | driver | operations | system | null */
  actorKind: string | null;
  actorFingerprint: string | null;
  /** The command or event type. A closed vocabulary in every source. */
  command: string | null;
  fromState: string | null;
  toState: string | null;
  /** The subject row, as an opaque short reference. Never a full identifier. */
  subject: string | null;
  /**
   * OPS-020's "link to entity" action, and the ONE place a full identifier is
   * allowed to leave this module.
   *
   * It is a relative path into a canonical Operations screen that exists —
   * today only `/operations/deliveries/[id]` — and never a payload value, a
   * query string, or an absolute URL. A delivery id is not one of the classes
   * OPS-020 forbids: it is not a secret, a token, a digest, a proof URL, a
   * gate code, a phone number or an address. It is an internal identifier on
   * an Operations-gated screen that already navigates by it.
   *
   * It is a TYPED, NAMED field rather than something the redactor happens to
   * let through, so the exception is visible, bounded and testable. Everything
   * else — actor ids, subject references, every jsonb value — is still
   * fingerprinted or scrubbed, and the uuid shape rule still refuses a raw
   * identifier anywhere in a payload.
   */
  entityHref: string | null;
  severity: AuditSeverity;
  metadata: unknown;
};

export type AuditLogView = {
  entries: AuditEntry[];
  /**
   * Sources that could not be read. OPS-020 declares a "missing evidence"
   * state and this is it: a table that errored is NAMED, never folded into an
   * empty list. Telling an auditor "no payment events" because the query
   * failed is the same defect as telling a returning merchant they are new.
   */
  unavailable: AuditSource[];
  /** Sources whose backing table has not been created yet. */
  notProvisioned: AuditSource[];
  limit: number;
  /** True when a source returned exactly `limit` rows, so more may exist. */
  truncated: boolean;
};

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

/**
 * One source's SELECT, normalized into `AuditEntry`.
 *
 * Every `columns` list is an explicit allow-list read from the migration that
 * created the table, not from memory. Three columns that DO exist are
 * deliberately absent:
 *
 *   couranr_delivery_incident_events.note        operator prose
 *   couranr_intake_fact_events.from_value        the intake fact itself —
 *   couranr_intake_fact_events.to_value          addresses, names, phone
 *
 * They are where a full address actually lives in this schema. Not selecting
 * them is layer 1, and it holds even if layers 2 and 3 were deleted.
 */
type SourceSpec = {
  table: string;
  columns: string;
  map: (row: any) => Omit<AuditEntry, "id" | "source"> & { rowId: string };
};

/** A subject reference: short, opaque, and never the whole uuid. */
function subjectRef(prefix: string, id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0) return null;
  return `${prefix} ${id.replace(/-/g, "").slice(0, 8)}…`;
}

/** Exactly the uuid shape, so nothing else can be smuggled into a path. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The entity link for a delivery, or null.
 *
 * `/operations/deliveries/[id]` is the ONLY canonical Operations screen that
 * takes an id, so it is the only destination offered. A source with no
 * destination gets `null` rather than a link that 404s — the registry's own
 * LEG-003 acceptance criterion for redirects is "No redirect target 404s", and
 * an audit row that offers a dead link is the same failure in a smaller place.
 *
 * The id is shape-checked before it is interpolated, so a malformed value
 * cannot produce a path segment that is not a uuid.
 */
function deliveryHref(id: unknown): string | null {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  return `/operations/deliveries/${id}`;
}

const SOURCE_SPECS: Record<AuditSource, SourceSpec> = {
  delivery_request_events: {
    table: "couranr_delivery_request_events",
    columns: "id,request_id,actor_user_id,actor_type,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_type),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Request", r.request_id),
      entityHref: null,
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  delivery_events: {
    table: "couranr_delivery_events",
    columns: "id,delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_type),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Delivery", r.delivery_id),
      entityHref: deliveryHref(r.delivery_id),
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  delivery_incident_events: {
    // `note` is NOT selected. It is free operator prose and the single most
    // likely place in this schema for a phone number to be typed by hand.
    table: "couranr_delivery_incident_events",
    columns: "id,incident_id,actor_user_id,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: "operations",
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Incident", r.incident_id),
      entityHref: null,
      severity: r.command === "escalate_incident" ? "security_alert" : "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  assignment_events: {
    table: "couranr_assignment_events",
    columns: "id,assignment_id,delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_type),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Delivery", r.delivery_id),
      entityHref: deliveryHref(r.delivery_id),
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  payment_events: {
    // A DIFFERENT SHAPE from the other nine, and read as such rather than
    // assumed: no actor columns at all, `event_type` instead of `command`,
    // `detail` instead of `metadata`, and `payment_state_before/after`.
    // `provider_event_id` is NOT selected — it is a provider identifier, not
    // an audit fact, and it is the unique key of the idempotency constraint.
    table: "couranr_payment_events",
    columns: "id,obligation_id,request_id,event_type,payment_state_before,payment_state_after,outcome,detail,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: "system",
      actorFingerprint: null,
      command: scrubLabel(r.event_type),
      fromState: scrubLabel(r.payment_state_before),
      toState: scrubLabel(r.payment_state_after),
      subject: subjectRef("Request", r.request_id) ?? subjectRef("Obligation", r.obligation_id),
      // OPS-020's "security alert" state. A provider event Couranr REJECTED is
      // the one outcome in this table that means something went wrong rather
      // than something happened.
      entityHref: null,
      severity: r.outcome === "rejected" ? "security_alert" : "normal",
      metadata: redactMetadata(r.detail),
    }),
  },
  conversation_events: {
    table: "couranr_conversation_events",
    columns: "id,conversation_id,event_type,actor_kind,actor_user_id,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_kind),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.event_type),
      fromState: null,
      toState: null,
      subject: subjectRef("Conversation", r.conversation_id),
      entityHref: null,
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  activation_events: {
    table: "couranr_activation_events",
    columns: "id,business_account_id,actor_user_id,actor_type,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_type),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Workspace", r.business_account_id),
      entityHref: null,
      severity: r.command === "block_activation" ? "security_alert" : "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  customer_problem_report_events: {
    table: "couranr_customer_problem_report_events",
    columns: "id,report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: scrubLabel(r.actor_kind),
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_state),
      toState: scrubLabel(r.to_state),
      subject: subjectRef("Report", r.report_id),
      entityHref: null,
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  intake_fact_events: {
    // `from_value` and `to_value` are NOT selected. They hold the intake FACT
    // — which for this product is routinely an address, a contact name or a
    // phone number. `fact_key` says WHICH fact changed, which is the audit
    // question; the value itself is not one an auditor needs on this screen.
    table: "couranr_intake_fact_events",
    columns: "id,session_id,fact_key,event,from_authority,to_authority,actor_user_id,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: r.actor_user_id ? "operations" : "system",
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.event),
      fromState: scrubLabel(r.from_authority),
      toState: scrubLabel(r.to_authority),
      subject: subjectRef("Intake", r.session_id),
      entityHref: null,
      severity: "normal",
      /*
       * Deliberately the fact NAME only, never the fact.
       *
       * The property is `fact`, not `factKey`, because `key` is on the
       * forbidden-key-fragment list and this value would have rendered as
       * `[redacted]` — a useless column that looked like a protection.
       */
      metadata: redactMetadata({ fact: r.fact_key }),
    }),
  },
  team_events: {
    table: "couranr_team_events",
    columns: "id,business_account_id,member_id,actor_user_id,command,from_role,to_role,from_status,to_status,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: "merchant",
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_role ?? r.from_status),
      toState: scrubLabel(r.to_role ?? r.to_status),
      subject: subjectRef("Workspace", r.business_account_id),
      entityHref: null,
      severity: "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
  operations_setting_events: {
    table: "couranr_operations_setting_events",
    columns: "id,actor_user_id,scope,subject_key,command,from_value,to_value,metadata,created_at",
    map: (r) => ({
      rowId: String(r.id),
      createdAt: String(r.created_at),
      actorKind: "operations",
      actorFingerprint: actorFingerprint(r.actor_user_id),
      command: scrubLabel(r.command),
      fromState: scrubLabel(r.from_value),
      toState: scrubLabel(r.to_value),
      subject: scrubLabel(r.subject_key),
      // A kill switch or an intake pause is the kind of change an auditor
      // should see immediately, not find by scrolling.
      entityHref: null,
      severity:
        r.subject_key === "ai_global_kill_switch" || r.subject_key === "request_intake_paused"
          ? "security_alert"
          : "normal",
      metadata: redactMetadata(r.metadata),
    }),
  },
};

/**
 * Normalize an already-fetched row set. Exported so a test can drive the exact
 * projection the route uses without a database — which is what makes the
 * redaction claim testable rather than asserted.
 */
export function projectAuditRows(source: AuditSource, rows: any[]): AuditEntry[] {
  const spec = SOURCE_SPECS[source];
  return (rows ?? []).map((row) => {
    const mapped = spec.map(row ?? {});
    const { rowId, ...rest } = mapped;
    return { id: `${source}:${rowId}`, source, ...rest };
  });
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return AUDIT_DEFAULT_LIMIT;
  return Math.max(1, Math.min(AUDIT_MAX_LIMIT, Math.floor(n)));
}

/**
 * OPS-020 — read the audit log.
 *
 * Reads each requested source newest-first, projects it, then merges. There is
 * no cross-table SQL union because the eleven tables have five different
 * shapes and a union would have to be written against columns that do not all
 * exist; eleven small indexed reads are honest about that and each one is
 * covered by its own `created_at desc` index.
 */
export async function readOperationsAuditLog(params: {
  sources?: readonly AuditSource[];
  limit?: number;
} = {}): Promise<SettingsResult<AuditLogView>> {
  const limit = clampLimit(params.limit ?? AUDIT_DEFAULT_LIMIT);
  const requested =
    params.sources && params.sources.length > 0
      ? AUDIT_SOURCES.filter((s) => params.sources!.includes(s))
      : AUDIT_SOURCES;

  const entries: AuditEntry[] = [];
  const unavailable: AuditSource[] = [];
  const notProvisioned: AuditSource[] = [];
  let truncated = false;

  for (const source of requested) {
    const spec = SOURCE_SPECS[source];
    const { data, error } = await supabaseAdmin
      .from(spec.table)
      .select(spec.columns)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingRelationError(error)) {
        notProvisioned.push(source);
      } else {
        logServerFailure({
          correlationId: newCorrelationId(),
          operation: `operations.settings.audit.${source}`,
          code: classifyDatabaseError(error),
          detail: error,
        });
        unavailable.push(source);
      }
      continue;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length >= limit) truncated = true;
    entries.push(...projectAuditRows(source, rows));
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return {
    ok: true,
    value: { entries: entries.slice(0, limit), unavailable, notProvisioned, limit, truncated },
  };
}

/* ═════════════════════════════════════════════════ OPS-016 availability ══ */

export const AVAILABILITY_STATES = [
  "standard",
  "scheduled_only",
  "temporarily_closed",
  "weather_limited",
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** FLG-001's four required switches, in registry order. */
export const OPERATIONAL_FLAG_KEYS = [
  "overnight_enabled",
  "ai_auto_reply_enabled",
  "request_intake_paused",
  "ai_global_kill_switch",
] as const;
export type OperationalFlagKey = (typeof OPERATIONAL_FLAG_KEYS)[number];

export function isAvailabilityState(v: unknown): v is AvailabilityState {
  return typeof v === "string" && (AVAILABILITY_STATES as readonly string[]).includes(v);
}
export function isOperationalFlagKey(v: unknown): v is OperationalFlagKey {
  return typeof v === "string" && (OPERATIONAL_FLAG_KEYS as readonly string[]).includes(v);
}

export type MarketAvailabilityView = {
  marketKey: string;
  active: boolean;
  maxConcurrentDeliveries: number | null;
  availabilityState: AvailabilityState;
  version: number;
  updatedAt: string | null;
  closures: Array<{ id: string; localDate: string; reason: string; active: boolean }>;
};

export type OperationalFlagView = {
  key: OperationalFlagKey;
  enabled: boolean;
  version: number;
  updatedAt: string | null;
};

export type AvailabilityView = {
  /**
   * False when 20260917210000 has not been applied. The surface renders the
   * pending-migration state instead of an empty form — see the header.
   */
  provisioned: boolean;
  markets: MarketAvailabilityView[];
  flags: OperationalFlagView[];
  /** Sections that errored for a reason other than a missing table. */
  unavailable: string[];
};

/**
 * OPS-016 — read every availability fact the screen shows, except the governed
 * ones, which never come from the database at all.
 */
export async function readAvailability(): Promise<SettingsResult<AvailabilityView>> {
  const unavailable: string[] = [];

  const policies = await supabaseAdmin
    .from("couranr_capacity_policies")
    .select("market_key,max_concurrent_deliveries,active")
    .order("market_key", { ascending: true });

  if (policies.error) {
    return fail({
      operation: "operations.settings.availability.policies",
      code: classifyDatabaseError(policies.error),
      detail: policies.error,
      message: "Couranr could not load market availability.",
    });
  }

  const modes = await supabaseAdmin
    .from("couranr_market_availability")
    .select("market_key,availability_state,version,updated_at");

  let provisioned = true;
  const modeByMarket = new Map<string, { state: AvailabilityState; version: number; updatedAt: string | null }>();
  if (modes.error) {
    if (isMissingRelationError(modes.error)) provisioned = false;
    else unavailable.push("availability_state");
  } else {
    for (const row of modes.data ?? []) {
      modeByMarket.set(String((row as any).market_key), {
        state: isAvailabilityState((row as any).availability_state)
          ? ((row as any).availability_state as AvailabilityState)
          : "standard",
        version: Number((row as any).version ?? 1),
        updatedAt: (row as any).updated_at ? String((row as any).updated_at) : null,
      });
    }
  }

  const closures = await supabaseAdmin
    .from("couranr_operating_closures")
    .select("id,market_key,local_date,reason,active")
    .order("local_date", { ascending: true });

  const closuresByMarket = new Map<string, MarketAvailabilityView["closures"]>();
  if (closures.error) {
    unavailable.push("closures");
  } else {
    for (const row of closures.data ?? []) {
      const key = String((row as any).market_key);
      const list = closuresByMarket.get(key) ?? [];
      list.push({
        id: String((row as any).id),
        localDate: String((row as any).local_date),
        // Operator prose. Scrubbed on the way out, exactly like an audit value.
        reason: scrubString(String((row as any).reason ?? "")),
        active: Boolean((row as any).active),
      });
      closuresByMarket.set(key, list);
    }
  }

  const markets: MarketAvailabilityView[] = (policies.data ?? []).map((row: any) => {
    const key = String(row.market_key);
    const mode = modeByMarket.get(key);
    return {
      marketKey: key,
      active: Boolean(row.active),
      maxConcurrentDeliveries:
        row.max_concurrent_deliveries === null || row.max_concurrent_deliveries === undefined
          ? null
          : Number(row.max_concurrent_deliveries),
      availabilityState: mode?.state ?? "standard",
      version: mode?.version ?? 0,
      updatedAt: mode?.updatedAt ?? null,
      closures: closuresByMarket.get(key) ?? [],
    };
  });

  /* couranr_operational_SWITCHES, not a second flags table. This is the table
     private.couranr_enforce_request_intake_pause reads, so it is the only one
     where throwing a switch actually gates anything. */
  const flagsRead = await supabaseAdmin
    .from("couranr_operational_switches")
    .select("switch_key,enabled,version,updated_at");

  const flagByKey = new Map<string, OperationalFlagView>();
  if (flagsRead.error) {
    if (isMissingRelationError(flagsRead.error)) provisioned = false;
    else unavailable.push("operational_flags");
  } else {
    for (const row of flagsRead.data ?? []) {
      const key = String((row as any).switch_key);
      if (!isOperationalFlagKey(key)) continue;
      flagByKey.set(key, {
        key,
        enabled: Boolean((row as any).enabled),
        version: Number((row as any).version ?? 1),
        updatedAt: (row as any).updated_at ? String((row as any).updated_at) : null,
      });
    }
  }

  /*
   * FLG-001's `default_at_launch` is false for all four. A key with no row
   * renders as false and version 0, which the write path refuses — so an
   * unprovisioned kill switch can never read as "on", and can never be
   * toggled from a value nobody wrote.
   */
  const flags: OperationalFlagView[] = OPERATIONAL_FLAG_KEYS.map(
    (key) => flagByKey.get(key) ?? { key, enabled: false, version: 0, updatedAt: null }
  );

  return { ok: true, value: { provisioned, markets, flags, unavailable } };
}

/* ═══════════════════════════════════════════════ OPS-016 named commands ══ */

/**
 * The closed set of things an operator may do on this surface.
 *
 * THE TARGET IS IN THE COMMAND NAME, NOT IN THE BODY.
 *
 * The first draft took `{ command: "set_market_availability",
 * availabilityState }` and validated the state against the closed vocabulary.
 * That is not enough here, and two of this repo's own guards said so on the
 * first full run — `tests/couranr-server-only.test.ts` and
 * `tests/couranr-driver-execution.test.ts` both refuse any canonical route
 * matching `/body\??\.\w*[Ss]tate/`. The convention they enforce is the one
 * `/api/delivery/mark-in-transit` was hardened to: "its target status is fixed
 * by the route, never read from the body."
 *
 * So each target gets its own command name. A caller cannot name a state at
 * all — it can only ask for one of eight things, and the mapping from command
 * to target lives here, server-side, where nothing a browser sends can reach
 * it. The vocabulary is longer and the property is structural.
 *
 * Every versioned command also carries `expectedVersion`, so the write is a
 * conditional UPDATE a stale editor loses rather than silently wins.
 */
export const AVAILABILITY_COMMANDS = [
  "set_market_standard",
  "set_market_scheduled_only",
  "set_market_temporarily_closed",
  "set_market_weather_limited",
  "enable_operational_flag",
  "disable_operational_flag",
  "open_market",
  "close_market",
  "open_operating_closure",
  "lift_operating_closure",
] as const;
export type AvailabilityCommand = (typeof AVAILABILITY_COMMANDS)[number];

/** Command → the availability state it sets. Server-side and not overridable. */
const MARKET_STATE_BY_COMMAND: Record<string, AvailabilityState> = {
  set_market_standard: "standard",
  set_market_scheduled_only: "scheduled_only",
  set_market_temporarily_closed: "temporarily_closed",
  set_market_weather_limited: "weather_limited",
};

/** Command → whether the market accepts work. Same reasoning. */
const MARKET_ACTIVE_BY_COMMAND: Record<string, boolean> = {
  open_market: true,
  close_market: false,
};

/** Command → the switch position. Same reasoning. */
const FLAG_ENABLED_BY_COMMAND: Record<string, boolean> = {
  enable_operational_flag: true,
  disable_operational_flag: false,
};

export function isAvailabilityCommand(v: unknown): v is AvailabilityCommand {
  return typeof v === "string" && (AVAILABILITY_COMMANDS as readonly string[]).includes(v);
}

export type AvailabilityCommandInput =
  | {
      command:
        | "set_market_standard"
        | "set_market_scheduled_only"
        | "set_market_temporarily_closed"
        | "set_market_weather_limited";
      marketKey: string;
      expectedVersion: number;
    }
  | {
      command: "enable_operational_flag" | "disable_operational_flag";
      flagKey: OperationalFlagKey;
      expectedVersion: number;
    }
  | { command: "open_market" | "close_market"; marketKey: string }
  | {
      command: "open_operating_closure";
      marketKey: string;
      /** A local calendar date, `YYYY-MM-DD`, in HRS-002's zone. */
      localDate: string;
      reason: string;
    }
  | { command: "lift_operating_closure"; closureId: string };

/**
 * A closure date is a LOCAL CALENDAR DATE in HRS-002's zone, not an instant.
 *
 * `couranr_operating_closures.local_date` is a `date`, and
 * `couranr_plan_service` compares it against
 * `(candidate at time zone 'America/New_York')::date`. Accepting a timestamp
 * here and letting PostgreSQL cast it would resolve it in the SERVER's zone,
 * which is the class of bug TMZ-001 exists to forbid. So the shape is checked
 * strictly and the value is passed through as text.
 */
const LOCAL_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isLocalDate(v: unknown): v is string {
  if (typeof v !== "string" || !LOCAL_DATE_RE.test(v)) return false;
  // Round-trip to reject 2026-02-31 and friends, which the regex admits.
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

export const CLOSURE_REASON_MAX = 200;

/**
 * Write the audit row for an accepted change.
 *
 * Best-effort BY DESIGN AND SAID SO: the state change has already committed,
 * and refusing to report it because its audit row failed would leave the
 * caller believing nothing happened while the market is closed. The failure is
 * logged under a correlation id and surfaced as `auditRecorded: false`, so the
 * screen can say the change landed but the record did not — which is a
 * different sentence from either "saved" or "failed".
 */
async function recordSettingEvent(input: {
  actorUserId: string;
  scope: "market_availability" | "operational_flag" | "operating_closure" | "market_active";
  subjectKey: string;
  command: string;
  fromValue: string | null;
  toValue: string;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from("couranr_operations_setting_events").insert({
    actor_user_id: input.actorUserId,
    scope: input.scope,
    subject_key: input.subjectKey,
    command: input.command,
    from_value: input.fromValue,
    to_value: input.toValue,
    metadata: {},
  });
  if (error) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: "operations.settings.audit.write",
      code: classifyDatabaseError(error),
      detail: error,
    });
    return false;
  }
  return true;
}

export type AvailabilityCommandResult = {
  view: AvailabilityView;
  auditRecorded: boolean;
};

/**
 * Apply one named availability command.
 *
 * CONCURRENCY. The state change is ONE conditional UPDATE matching on both the
 * subject and `version`, and it increments `version` in the same statement.
 * PostgreSQL applies it atomically, so two operators racing on the same market
 * produce exactly one winner and the loser's update matches zero rows and
 * returns `version_conflict` — OPS-015's declared "policy version conflict"
 * state, reached by the mechanism rather than by a label. A read-then-write
 * check would let both read the same version and both believe they won.
 */
export async function applyAvailabilityCommand(
  actorUserId: string,
  input: AvailabilityCommandInput
): Promise<SettingsResult<AvailabilityCommandResult>> {
  if (!actorUserId) {
    return fail({
      operation: "operations.settings.availability.command",
      code: "not_permitted",
      message: "Couranr Operations access required.",
    });
  }

  let auditRecorded = true;

  /*
   * BRANCH ON THE COMMAND LITERAL, not on "did a lookup return something".
   *
   * Both forms resolve the target from a server-owned map. Only this one lets
   * TypeScript narrow the discriminated union, so `input.marketKey` on a flag
   * command and `input.flagKey` on a market command are compile errors rather
   * than `undefined` at runtime. The first draft branched on the lookup and
   * produced ten `Property does not exist` errors under
   * `typecheck:canonical`'s `strict: true` — which is the check earning its
   * keep, since the global tsconfig has `strict: false`.
   */
  if (
    input.command === "set_market_standard" ||
    input.command === "set_market_scheduled_only" ||
    input.command === "set_market_temporarily_closed" ||
    input.command === "set_market_weather_limited"
  ) {
    const targetState = MARKET_STATE_BY_COMMAND[input.command];
    if (!isAvailabilityState(targetState)) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "invalid_input",
        message: "That availability state is not one Couranr recognizes.",
      });
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "version_conflict",
        message: "Reload the page — Couranr does not have a current version for this market.",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("couranr_market_availability")
      .update({
        availability_state: targetState,
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
        updated_by: actorUserId,
      })
      .eq("market_key", input.marketKey)
      .eq("version", input.expectedVersion)
      .select("market_key,availability_state,version");

    if (error) {
      if (isMissingRelationError(error)) {
        return fail({
          operation: "operations.settings.availability.command",
          code: "wrong_state",
          detail: error,
          message:
            "Availability controls are not provisioned yet. Migration 20260917210000 is pending.",
        });
      }
      return fail({
        operation: "operations.settings.availability.command",
        code: classifyDatabaseError(error),
        detail: error,
        message: "Couranr could not publish that availability change.",
      });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "version_conflict",
        message: "Someone else changed this market first. Reload to see the current state.",
      });
    }

    auditRecorded = await recordSettingEvent({
      actorUserId,
      scope: "market_availability",
      subjectKey: input.marketKey,
      command: input.command,
      fromValue: null,
      toValue: targetState,
    });
  } else if (
    input.command === "enable_operational_flag" ||
    input.command === "disable_operational_flag"
  ) {
    const targetEnabled = FLAG_ENABLED_BY_COMMAND[input.command];
    if (!isOperationalFlagKey(input.flagKey)) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "invalid_input",
        message: "That switch is not one Couranr recognizes.",
      });
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "version_conflict",
        message: "Reload the page — Couranr does not have a current version for this switch.",
      });
    }

    /* THROUGH THE COMMAND, not a direct UPDATE. couranr_set_operational_switch is
       the single writer: it enforces the compare-and-set and appends the
       switch's own audit row in the SAME statement. The direct UPDATE this
       replaced would have changed a launch-gate switch and left no record of it
       if the separate audit write failed afterwards. CR409 from the CAS is
       mapped to version_conflict by classifyDatabaseError. */
    const { error } = await supabaseAdmin.rpc("couranr_set_operational_switch", {
      p_switch_key: input.flagKey,
      p_enabled: targetEnabled,
      p_actor_user_id: actorUserId,
      p_reason: `${input.command} from Operations settings`,
      p_expected_version: input.expectedVersion,
    });

    if (error) {
      if (isMissingRelationError(error)) {
        return fail({
          operation: "operations.settings.availability.command",
          code: "wrong_state",
          detail: error,
          message:
            "Operational switches are not provisioned yet. Migration 20260917190000 is pending.",
        });
      }
      if (String((error as any)?.message ?? "").includes("switch_version_conflict")) {
        return fail({
          operation: "operations.settings.availability.command",
          code: "version_conflict",
          message: "Someone else changed this switch first. Reload to see the current state.",
        });
      }
      return fail({
        operation: "operations.settings.availability.command",
        code: classifyDatabaseError(error),
        detail: error,
        message: "Couranr could not change that switch.",
      });
    }

    auditRecorded = await recordSettingEvent({
      actorUserId,
      scope: "operational_flag",
      subjectKey: input.flagKey,
      command: input.command,
      fromValue: String(!targetEnabled),
      toValue: String(targetEnabled),
    });
  } else if (input.command === "open_market" || input.command === "close_market") {
    const targetActive = MARKET_ACTIVE_BY_COMMAND[input.command];
    const { data, error } = await supabaseAdmin
      .from("couranr_capacity_policies")
      .update({ active: targetActive, updated_at: new Date().toISOString() })
      .eq("market_key", input.marketKey)
      .select("market_key,active");

    if (error) {
      return fail({
        operation: "operations.settings.availability.command",
        code: classifyDatabaseError(error),
        detail: error,
        message: "Couranr could not change market availability.",
      });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "not_found",
        message: "Couranr has no market with that key.",
      });
    }

    auditRecorded = await recordSettingEvent({
      actorUserId,
      scope: "market_active",
      subjectKey: input.marketKey,
      command: input.command,
      fromValue: String(!targetActive),
      toValue: String(targetActive),
    });
  } else if (input.command === "open_operating_closure") {
    /*
     * THIS WRITE CHANGES REAL PLANNING BEHAVIOUR.
     *
     * `couranr_plan_service` (20260904154559) reads
     * `couranr_operating_closures` when it picks a departure slot, so an
     * active row here removes that date from automatic fulfilment for that
     * market. It is not a note; it closes the market for a day.
     */
    if (!isLocalDate(input.localDate)) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "invalid_input",
        message: "A closure needs a real calendar date, as YYYY-MM-DD.",
      });
    }
    const reason = String(input.reason ?? "").trim();
    if (reason.length === 0 || reason.length > CLOSURE_REASON_MAX) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "invalid_input",
        message: `Say why the market is closed, in ${CLOSURE_REASON_MAX} characters or fewer.`,
      });
    }

    /*
     * UPSERT, not INSERT. `couranr_oc_unique (market_key, local_date)` means a
     * date that was closed and then lifted already has a row; an INSERT would
     * collide with it and the operator would be told the date is invalid when
     * the real answer is "it exists and is inactive". The conflict target is
     * the constraint's own columns.
     */
    const { data, error } = await supabaseAdmin
      .from("couranr_operating_closures")
      .upsert(
        {
          market_key: input.marketKey,
          local_date: input.localDate,
          reason,
          active: true,
        },
        { onConflict: "market_key,local_date" }
      )
      .select("id,local_date");

    if (error) {
      return fail({
        operation: "operations.settings.availability.command",
        code: classifyDatabaseError(error),
        detail: error,
        message: "Couranr could not record that closure.",
      });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "not_found",
        message: "Couranr has no market with that key.",
      });
    }

    auditRecorded = await recordSettingEvent({
      actorUserId,
      scope: "operating_closure",
      subjectKey: `${input.marketKey}:${input.localDate}`,
      command: input.command,
      fromValue: null,
      toValue: "closed",
    });
  } else if (input.command === "lift_operating_closure") {
    /*
     * LIFTING IS `active = false`, NEVER A DELETE. The row is evidence that
     * the market WAS closed on that date, and `couranr_plan_service` filters
     * on `active = true`, so deactivating is the whole remedy. Deleting it
     * would also lose the audit trail's subject.
     */
    const { data, error } = await supabaseAdmin
      .from("couranr_operating_closures")
      .update({ active: false })
      .eq("id", input.closureId)
      .eq("active", true)
      .select("id,market_key,local_date");

    if (error) {
      return fail({
        operation: "operations.settings.availability.command",
        code: classifyDatabaseError(error),
        detail: error,
        message: "Couranr could not lift that closure.",
      });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return fail({
        operation: "operations.settings.availability.command",
        code: "wrong_state",
        message: "That closure is not active. Reload to see the current state.",
      });
    }

    auditRecorded = await recordSettingEvent({
      actorUserId,
      scope: "operating_closure",
      subjectKey: `${String((data[0] as any).market_key)}:${String((data[0] as any).local_date)}`,
      command: input.command,
      fromValue: "closed",
      toValue: "open",
    });
  } else {
    return fail({
      operation: "operations.settings.availability.command",
      code: "invalid_input",
      message: "That is not a command Couranr recognizes.",
    });
  }

  const view = await readAvailability();
  if (isSettingsFailure(view)) return view;
  return { ok: true, value: { view: view.value, auditRecorded } };
}
