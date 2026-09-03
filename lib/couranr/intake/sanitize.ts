/**
 * P5-001 §3/§4 — provider-payload sanitization and the control-tag boundary.
 *
 * BEST-EFFORT REDACTION OF OBVIOUS PATTERNS. This module removes email
 * addresses, phone-shaped digit runs and card-shaped digit runs from the
 * merchant description BEFORE it travels to any AI provider. It is NOT a
 * guarantee of PII-freeness: novel formats, prose ("my number is five five
 * five…"), 7-digit local numbers and exotic international shapes all pass
 * through. The raw description is stored verbatim by the routes — nothing
 * here changes what the database holds; only what a provider is shown.
 *
 * Everything here is deterministic and pure: same input, same output, no
 * environment reads, no I/O.
 */

import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/intake/sanitize.ts");

export const REDACTED_EMAIL_TOKEN = "[redacted-email]";
export const REDACTED_PHONE_TOKEN = "[redacted-phone]";
export const REDACTED_NUMBER_TOKEN = "[redacted-number]";

export type DescriptionRedactions = {
  emails: number;
  phones: number;
  cardLike: number;
};

/** Conservative email shape. Misses exotica on purpose; never matches prose. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Card/payment-number-like candidate: a run of digits with at most a single
 * space or dash between any two digits. The run is REDACTED only when it
 * carries 13–19 digits (the payment-card PAN range). Luhn is deliberately NOT
 * required — an obvious lookalike a merchant typed slightly wrong should
 * still be redacted. The digit count is required precisely so that
 * tracking-number-adjacent strings survive: a 12-digit FedEx-style run or a
 * 20+-digit USPS-style run falls outside 13–19 and is left byte-identical.
 * Tradeoff: a genuine 13–19-digit tracking number is over-redacted, and a
 * card number typed with unusual separators (dots, double spaces) is missed
 * here — best effort, as the header says.
 */
const CARD_CANDIDATE_RE = /(?<!\d)\d(?:[ -]?\d){11,}(?!\d)/g;

/**
 * Phone-shaped candidate: optional country code (with or without "+"), then a
 * NANP-like 3-3-4 digit shape with optional single separators (space, dot,
 * dash) and optional parentheses around the area code. The candidate is
 * REDACTED only when it carries exactly 10 or 11 digits, because:
 *
 *   - 10/11 digits covers every ordinary US shape (+1 (555) 123-4567,
 *     555-123-4567, 5551234567, 1-555-123-4567);
 *   - 7-digit local numbers without an area code are ACCEPTED MISSES — the
 *     shape is indistinguishable from ordinary shipment vocabulary;
 *   - capping at 11 keeps 12-digit tracking-style runs and long international
 *     numbers out of this pass (the latter are accepted misses too), so the
 *     card pass's 13–19 rule is not undone here.
 *
 * The lookarounds forbid a match from starting or ending inside a larger
 * digit/dash run, so this can never eat a slice out of a longer number.
 * Shipment vocabulary ("20 lb", "12 boxes", "9mm", "5.56", "60 by 40
 * inches", a bare 5-digit zip) never reaches 10 digits and never matches.
 */
const PHONE_CANDIDATE_RE =
  /(?<![\d-])(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?![\d-])/g;

function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

/** One pass: emails, then card-like, then phones. ORDER IS LOAD-BEARING —
 * a card number processed by the phone pass first could be half-eaten,
 * leaving recognizable PAN fragments behind. */
function sanitizeOnce(text: string, tally: DescriptionRedactions): string {
  let out = text.replace(EMAIL_RE, () => {
    tally.emails += 1;
    return REDACTED_EMAIL_TOKEN;
  });
  out = out.replace(CARD_CANDIDATE_RE, (m) => {
    const n = digitCount(m);
    if (n < 13 || n > 19) return m; // tracking-adjacent: survive byte-identical
    tally.cardLike += 1;
    return REDACTED_NUMBER_TOKEN;
  });
  out = out.replace(PHONE_CANDIDATE_RE, (m) => {
    const n = digitCount(m);
    if (n < 10 || n > 11) return m; // see the candidate comment
    tally.phones += 1;
    return REDACTED_PHONE_TOKEN;
  });
  return out;
}

/**
 * §3 — redact obvious contact/payment patterns before ANY provider sees the
 * text. Iterated to a fixed point so the function is truly idempotent: a
 * redaction can expose a new candidate (e.g. a phone removed from the middle
 * of a longer digit run leaves a 16-digit card-shaped run behind), and the
 * loop keeps going until a full pass changes nothing. Termination is
 * guaranteed — every replacement strictly removes digits and the tokens
 * themselves contain none.
 */
export function sanitizeDescriptionForProvider(text: string): {
  sanitized: string;
  redactions: DescriptionRedactions;
} {
  const redactions: DescriptionRedactions = { emails: 0, phones: 0, cardLike: 0 };
  let current = text;
  for (;;) {
    const next = sanitizeOnce(current, redactions);
    if (next === current) break;
    current = next;
  }
  return { sanitized: current, redactions };
}

/* ---------------------------------------------------- control-tag boundary */

/**
 * Every tag the Anthropic adapter uses to fence untrusted or contextual data
 * inside the user turn. A look-alike of ANY of these inside the data could
 * close its own fence or open a trusted-looking one.
 */
export const PROVIDER_CONTROL_TAGS = [
  "shipment_description",
  "business_category",
  "confirmed_facts",
] as const;

const CONTROL_TAG_RE = new RegExp(
  `<\\s*/?\\s*(?:${PROVIDER_CONTROL_TAGS.join("|")})\\b[^>]*>`,
  "gi"
);

/**
 * §4 — removes anything that looks like an opening, closing or self-closing
 * Couranr control tag from untrusted text, case-insensitively and tolerant of
 * whitespace/attributes inside the bracket (`</ shipment_description >`,
 * `<CONFIRMED_FACTS foo=bar>`, `<business_category/>`). The replacement is
 * visible so a human reading the evidence can see that something was there.
 * Applied to EVERY string embedded in any control block — including the
 * server-resolved category and the stringified confirmed facts, belt and
 * braces.
 */
export function neutralizeControlTags(text: string): string {
  return text.replace(CONTROL_TAG_RE, "[tag removed]");
}
