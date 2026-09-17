import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  COURANR_IDENTITY_POLICY_VERSION,
  type IdentityOutcome,
} from "@/lib/couranr/identity/recipientIdentity";

assertServerOnly("lib/couranr/identity/stripeIdentity.ts");

/**
 * The Stripe Identity ADAPTER for protected handoff.
 *
 * WHAT THIS MODULE IS ALLOWED TO KNOW, AND WHAT IT MUST FORGET.
 *
 * A protected handoff promises the sender that the person who received their
 * shipment was an adult and was the person they named. Establishing that means
 * reading a date of birth and a legal name. Couranr must NOT keep either: it
 * computes two booleans from them and the personal data never leaves this
 * module. `evaluateVerificationSession` returns an `IdentityOutcome`, whose
 * shape carries no name, no date, no address, no document number — and
 * `tests/couranr-stripe-identity.test.ts` asserts that property structurally so
 * a future field cannot be added without the test failing.
 *
 * ── THE CONSTRAINT THAT SHAPED THIS FILE ────────────────────────────────────
 *
 * Stripe's own documentation table for accessing verification results marks
 * DATE OF BIRTH as "Secret key access: No. Restricted API key access: Yes",
 * with its own expand path `verified_outputs.dob` — expanding `verified_outputs`
 * alone does NOT include it. So `adult_verified` is UNREACHABLE with the
 * ordinary STRIPE_SECRET_KEY the rest of this repository uses.
 *
 * That matters more than it sounds. The database requires all three booleans to
 * be true before it will record a `verified` row. Had this adapter been written
 * against the secret key — the obvious thing to do, since eleven other call
 * sites use it — `verified_outputs.dob` would come back `null`, `adultVerified`
 * would compute `false`, and EVERY protected handoff would fail closed with an
 * evidence error that looks exactly like a fraudulent recipient. A configuration
 * mistake would be indistinguishable from a caught criminal.
 *
 * Hence `IdentityConfigurationError` and the `reason` field below: Couranr must
 * always be able to tell "this recipient is not who the sender named" apart from
 * "Couranr is not configured to find out".
 *
 * ── THE 48-HOUR WINDOW ──────────────────────────────────────────────────────
 *
 * A restricted key reads sensitive results only for verifications submitted in
 * the last 48 hours, unless it is additionally IP-restricted. Couranr therefore
 * reads the date of birth ONCE, at the moment the verification resolves, and
 * stores the boolean. This is not only privacy hygiene — it is the only window
 * in which the fact is obtainable at all. Operations cannot re-derive adulthood
 * from the provider three days later, and nothing in this codebase should be
 * written as though it could.
 *
 * ── NO AMBIENT CREDENTIALS, NO AMBIENT TRANSPORT ────────────────────────────
 *
 * `recipientIdentity.ts` documents why it contains no code path that calls
 * Stripe: a branch that can fire is a branch that fires in somebody's test six
 * weeks from now, and the owner has already lost money to development-time
 * provider calls. This module keeps that guarantee structurally rather than by
 * flag. `IdentityAdapterDeps` has NO DEFAULTS. There is no `?? fetch`, no
 * `process.env` read anywhere in this file. A caller that wants a live call must
 * hand over a transport and a key explicitly, which makes every call site
 * greppable and makes an accidental one impossible to write by omission.
 *
 * Sources, read 2026-09-17:
 *   https://docs.stripe.com/api/identity/verification_sessions/object
 *   https://docs.stripe.com/identity/access-verification-results
 *   https://docs.stripe.com/identity/verification-checks
 */

/**
 * Pinned deliberately, to the version the other eleven Stripe call sites in this
 * repository pin. One API-version story, not two.
 */
export const STRIPE_IDENTITY_API_VERSION = "2024-04-10";

/** Minimum age a recipient must reach for a protected handoff. */
export const COURANR_RECIPIENT_MINIMUM_AGE = 18;

/**
 * Stripe Identity's COMPLETE status vocabulary.
 *
 * There are four. There is NO `failed`. A check that does not pass leaves the
 * session in `requires_input` with `last_error` populated, and the documented
 * guidance is to reuse that same session for another attempt. Couranr's `failed`
 * is a word about OUR record, never a status read back from Stripe — which is
 * the reason 20260917150000 had to make `failed` retryable.
 */
export const STRIPE_IDENTITY_STATUSES = [
  "requires_input",
  "processing",
  "verified",
  "canceled",
] as const;
export type StripeIdentityStatus = (typeof STRIPE_IDENTITY_STATUSES)[number];

export function isStripeIdentityStatus(v: unknown): v is StripeIdentityStatus {
  return typeof v === "string" && (STRIPE_IDENTITY_STATUSES as readonly string[]).includes(v);
}

/**
 * The subset of the VerificationSession this adapter reads.
 *
 * Narrow on purpose: a wide `any` would let document images, ID numbers and
 * addresses flow into this process by accident. What is not named here is not
 * read, and `parseVerificationSession` drops everything else on the floor.
 */
export type StripeVerificationSession = {
  id: string;
  status: string;
  lastErrorCode: string | null;
  /** Present only when `verified_outputs` was expanded AND Stripe returned it. */
  verifiedOutputs: {
    firstName: string | null;
    lastName: string | null;
    /** Present only under a RESTRICTED key with `verified_outputs.dob` expanded. */
    dob: { year: number; month: number; day: number } | null;
  } | null;
};

/**
 * Why an outcome is what it is, in terms that carry no personal data.
 *
 * Operations reads this. It is an enum, never free text, so a provider message
 * containing a recipient's name can never reach a Couranr record through it.
 */
export type IdentityOutcomeReason =
  | "not_submitted"
  | "in_progress"
  | "provider_rejected"
  | "outputs_unavailable"
  | "date_of_birth_unreadable"
  | "recipient_under_minimum_age"
  | "recipient_name_mismatch"
  | "provider_status_unrecognized"
  | "verified";

export type IdentityEvaluation = IdentityOutcome & {
  reason: IdentityOutcomeReason;
  /**
   * True when the obstacle is COURANR'S CONFIGURATION rather than the recipient.
   * A `false` adultVerified caused by a missing restricted key must never be
   * read by anyone as evidence about the person standing at the door.
   */
  blockedByConfiguration: boolean;
};

/**
 * Raised when the adapter is asked to establish adulthood without the credential
 * that can. Loud, rather than a quiet `false` that reads as a fraud signal.
 */
export class IdentityConfigurationError extends Error {
  readonly code = "identity_restricted_key_required";
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigurationError";
  }
}

export class IdentityProviderError extends Error {
  readonly code = "identity_provider_error";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "IdentityProviderError";
    this.status = status;
  }
}

/**
 * Everything the adapter needs, supplied explicitly. No defaults — see the
 * header note on ambient credentials.
 */
export type IdentityAdapterDeps = {
  fetchImpl: typeof fetch;
  /**
   * A RESTRICTED key with Identity Verification Results + Recent Detailed
   * Verification Results read permission. The plain secret key cannot read a
   * date of birth and therefore cannot establish adulthood.
   */
  restrictedKey: string;
  /** Injected so the age boundary is testable without freezing the clock. */
  now: () => Date;
};

/* ------------------------------------------------------------------ age --- */

/**
 * Whole years, by CALENDAR, in UTC.
 *
 * Not milliseconds divided by 365.25 — that is wrong by up to a day either side
 * of a birthday depending on how many leap years the interval spans, and the
 * only place the answer matters is exactly at that boundary.
 *
 * Someone born on 29 February reaches their birthday on 1 March in a non-leap
 * year under this arithmetic, which is the later of the two readings in use.
 * Later is the conservative direction for a rule that gates custody.
 *
 * UTC throughout for the same reason: a recipient who is 18 in their local
 * timezone but not yet in UTC reads as not-adult for a few hours. That fails
 * closed, and a protected handoff that waits is recoverable in a way that a
 * protected handoff given to a minor is not.
 */
export function calendarAgeInYears(
  dob: { year: number; month: number; day: number },
  asOf: Date
): number | null {
  if (
    !Number.isInteger(dob?.year) ||
    !Number.isInteger(dob?.month) ||
    !Number.isInteger(dob?.day) ||
    dob.year < 1900 ||
    dob.month < 1 ||
    dob.month > 12 ||
    dob.day < 1 ||
    dob.day > 31 ||
    !(asOf instanceof Date) ||
    Number.isNaN(asOf.getTime())
  ) {
    return null;
  }
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const d = asOf.getUTCDate();
  let age = y - dob.year;
  if (m < dob.month || (m === dob.month && d < dob.day)) age -= 1;
  // A negative age means the document says the recipient is not yet born.
  // Unreadable, not young.
  return age < 0 ? null : age;
}

export function isAdultOn(
  dob: { year: number; month: number; day: number },
  asOf: Date
): boolean {
  const age = calendarAgeInYears(dob, asOf);
  return age !== null && age >= COURANR_RECIPIENT_MINIMUM_AGE;
}

/* ----------------------------------------------------------------- name --- */

/**
 * Case-folded, accent-stripped, punctuation-to-space, collapsed.
 *
 * Diacritics are stripped because a document transliterates them inconsistently
 * and a sender types them inconsistently; refusing "Jose" against "José" would
 * block real recipients for a reason that has nothing to do with identity.
 */
export function normalizeNameTokens(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Honorifics and suffixes carry no identity and appear on one side only. */
const NAME_NOISE = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof",
  "jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "esq",
]);

/**
 * Split the sender's designated recipient name into surname and given parts.
 *
 * "Smith, Ann" is reordered before tokenizing — the comma form is common enough
 * that treating "ann" as the surname would reject a correct recipient.
 */
export function designatedNameParts(designated: unknown): {
  given: string[];
  surname: string[];
  all: string[];
} {
  const raw = typeof designated === "string" ? designated : "";
  const comma = raw.indexOf(",");
  const ordered =
    comma > -1 ? `${raw.slice(comma + 1).trim()} ${raw.slice(0, comma).trim()}` : raw;
  const tokens = normalizeNameTokens(ordered).filter((t) => !NAME_NOISE.has(t));
  if (tokens.length === 0) return { given: [], surname: [], all: [] };
  return {
    given: tokens.slice(0, -1),
    surname: tokens.slice(-1),
    all: tokens,
  };
}

/**
 * Whether the verified person is the person the sender named.
 *
 * THREE conditions, all required:
 *   1. every token of the verified surname appears in the designated name;
 *   2. every token of the verified given name appears in the designated name;
 *   3. the designated name's FINAL token is one of the verified surname tokens.
 *
 * (3) is what stops a swap. Without it, a designated "Ann Smith Jones" would
 * match a verified "Jones Smith" — a different person whose names happen to be
 * the same tokens in another order — because (1) and (2) are both satisfied by
 * set membership alone.
 *
 * This is deliberately conservative and it WILL refuse some legitimate
 * recipients: a nickname ("Bob" against "Robert"), an initial, a married name
 * the sender did not use. Every one of those refusals surfaces to Operations as
 * `recipient_name_mismatch` rather than silently completing, because the
 * alternative — a loose match — would make the protection the sender paid for
 * indistinguishable from no protection at all. Failing closed on a nickname is
 * recoverable by a human. Failing open on a stranger is not.
 */
export function matchesDesignatedRecipient(
  verified: { firstName: string | null; lastName: string | null },
  designatedName: unknown
): boolean {
  const first = normalizeNameTokens(verified?.firstName).filter((t) => !NAME_NOISE.has(t));
  const last = normalizeNameTokens(verified?.lastName).filter((t) => !NAME_NOISE.has(t));
  if (first.length === 0 || last.length === 0) return false;

  const parts = designatedNameParts(designatedName);
  // A single-token designated name cannot carry both a given name and a
  // surname, so it can never be confirmed against a two-part verified identity.
  if (parts.all.length < 2) return false;

  const pool = new Set(parts.all);
  if (!last.every((t) => pool.has(t))) return false;
  if (!first.every((t) => pool.has(t))) return false;

  const finalToken = parts.all[parts.all.length - 1];
  return last.includes(finalToken);
}

/* ------------------------------------------------------------- evaluate --- */

const UNVERIFIED = {
  identityVerified: false,
  adultVerified: false,
  authorizedRecipientMatch: false,
} as const;

/**
 * Map a provider session onto a Couranr outcome. PURE — no network, no clock of
 * its own, no environment. Everything it needs is an argument, which is what
 * makes every branch below reachable from a test.
 */
export function evaluateVerificationSession(
  session: StripeVerificationSession,
  input: { designatedRecipientName: unknown; asOf: Date; restrictedKeyConfigured: boolean }
): IdentityEvaluation {
  const base = {
    providerReference: session?.id ?? null,
    policyVersion: COURANR_IDENTITY_POLICY_VERSION,
  };

  if (!isStripeIdentityStatus(session?.status)) {
    /* A status Stripe has added since this was written. Mapping an unknown
       status onto a pass would be catastrophic and mapping it onto `processing`
       would stall the delivery forever; `failed` is visible, retryable, and
       fails closed. */
    return {
      ...base,
      ...UNVERIFIED,
      state: "failed",
      reason: "provider_status_unrecognized",
      blockedByConfiguration: false,
    };
  }

  if (session.status === "canceled") {
    return {
      ...base,
      ...UNVERIFIED,
      state: "canceled",
      reason: "not_submitted",
      blockedByConfiguration: false,
    };
  }

  if (session.status === "processing") {
    return {
      ...base,
      ...UNVERIFIED,
      state: "processing",
      reason: "in_progress",
      blockedByConfiguration: false,
    };
  }

  if (session.status === "requires_input") {
    /* `requires_input` covers two different situations that must not be
       conflated: a session created and never submitted, and a submitted check
       that did not pass. `last_error` is what separates them, and only the
       second is evidence about the recipient. */
    const rejected = typeof session.lastErrorCode === "string" && session.lastErrorCode !== "";
    return {
      ...base,
      ...UNVERIFIED,
      state: rejected ? "failed" : "pending",
      reason: rejected ? "provider_rejected" : "not_submitted",
      blockedByConfiguration: false,
    };
  }

  // status === "verified" from here down.
  const outputs = session.verifiedOutputs;
  if (!outputs) {
    return {
      ...base,
      ...UNVERIFIED,
      identityVerified: true,
      state: "failed",
      reason: "outputs_unavailable",
      blockedByConfiguration: true,
    };
  }

  const nameMatch = matchesDesignatedRecipient(outputs, input.designatedRecipientName);

  if (!outputs.dob) {
    /* No date of birth. Either the restricted key is absent — a Couranr
       configuration fact — or Stripe returned none for this document. The two
       are told apart by `blockedByConfiguration` so Operations never reads a
       missing credential as a suspicious recipient. */
    return {
      ...base,
      ...UNVERIFIED,
      identityVerified: true,
      state: "failed",
      reason: "date_of_birth_unreadable",
      blockedByConfiguration: !input.restrictedKeyConfigured,
    };
  }

  const adult = isAdultOn(outputs.dob, input.asOf);
  if (!adult) {
    return {
      ...base,
      ...UNVERIFIED,
      identityVerified: true,
      state: "failed",
      reason: "recipient_under_minimum_age",
      blockedByConfiguration: false,
    };
  }

  if (!nameMatch) {
    return {
      ...base,
      ...UNVERIFIED,
      identityVerified: true,
      state: "failed",
      reason: "recipient_name_mismatch",
      blockedByConfiguration: false,
    };
  }

  return {
    ...base,
    state: "verified",
    identityVerified: true,
    adultVerified: true,
    authorizedRecipientMatch: true,
    reason: "verified",
    blockedByConfiguration: false,
  };
}

/* -------------------------------------------------------------- parsing --- */

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Narrow the provider payload to the four facts this adapter is allowed to know.
 *
 * Everything else — address, email, phone, id_number, document images, the
 * verification report — is discarded HERE, at the boundary, rather than carried
 * further in and dropped later. Data that never enters the process cannot leak
 * out of it through a log line somebody adds next year.
 */
export function parseVerificationSession(payload: unknown): StripeVerificationSession {
  const p = (payload ?? {}) as Record<string, unknown>;
  const id = readString(p.id);
  if (!id) throw new IdentityProviderError(502, "identity_session_missing_id");

  const rawOutputs = p.verified_outputs as Record<string, unknown> | null | undefined;
  const rawDob = rawOutputs?.dob as Record<string, unknown> | null | undefined;
  const lastError = p.last_error as Record<string, unknown> | null | undefined;

  const dob =
    rawDob &&
    Number.isInteger(rawDob.year) &&
    Number.isInteger(rawDob.month) &&
    Number.isInteger(rawDob.day)
      ? {
          year: rawDob.year as number,
          month: rawDob.month as number,
          day: rawDob.day as number,
        }
      : null;

  return {
    id,
    status: typeof p.status === "string" ? p.status : "",
    /* The CODE only. `last_error.reason` is human-readable prose written by the
       provider and is not guaranteed to be free of the recipient's own details. */
    lastErrorCode: readString(lastError?.code),
    verifiedOutputs: rawOutputs
      ? {
          firstName: readString(rawOutputs.first_name),
          lastName: readString(rawOutputs.last_name),
          dob,
        }
      : null,
  };
}

/* ------------------------------------------------------------------- io --- */

/**
 * Retrieve one VerificationSession, expanded far enough to answer both questions.
 *
 * BOTH expand paths are required and neither implies the other: `verified_outputs`
 * brings the name, `verified_outputs.dob` brings the date of birth, and that
 * second one additionally requires the restricted key. Dropping either silently
 * produces a `failed` outcome for a recipient who did nothing wrong.
 */
export async function retrieveVerificationSession(
  sessionId: string,
  deps: IdentityAdapterDeps
): Promise<StripeVerificationSession> {
  if (typeof sessionId !== "string" || !/^vs_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new IdentityProviderError(400, "identity_session_id_invalid");
  }
  if (!deps || typeof deps.fetchImpl !== "function") {
    throw new IdentityConfigurationError("identity_transport_required");
  }
  if (typeof deps.restrictedKey !== "string" || deps.restrictedKey.trim() === "") {
    throw new IdentityConfigurationError(
      "A restricted Stripe key is required: the secret key cannot read verified_outputs.dob, " +
        "so adulthood cannot be established with it."
    );
  }

  const url =
    `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(sessionId)}` +
    `?expand[]=verified_outputs&expand[]=verified_outputs.dob`;

  const res = await deps.fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${deps.restrictedKey}`,
      "Stripe-Version": STRIPE_IDENTITY_API_VERSION,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    /* The provider's error body can quote submitted values. Only the HTTP status
       crosses this line. */
    throw new IdentityProviderError(res.status, `identity_provider_http_${res.status}`);
  }
  return parseVerificationSession(await res.json());
}

/**
 * The whole path: retrieve, evaluate, forget.
 *
 * The return value is an `IdentityEvaluation`, which is an `IdentityOutcome`
 * plus two non-personal fields. The name and the date of birth exist only inside
 * this call's stack frame.
 */
export async function resolveRecipientIdentityOutcome(
  sessionId: string,
  input: { designatedRecipientName: unknown },
  deps: IdentityAdapterDeps
): Promise<IdentityEvaluation> {
  const session = await retrieveVerificationSession(sessionId, deps);
  return evaluateVerificationSession(session, {
    designatedRecipientName: input?.designatedRecipientName,
    asOf: deps.now(),
    restrictedKeyConfigured: true,
  });
}
