/**
 * The customer-facing delivery reference: `CR-4K7M-2P9X`.
 *
 * Pure string handling with no imports, so it is safe in a client component, a
 * server command, an email template and a test alike. Generation lives in SQL
 * (`couranr_generate_delivery_reference`, migration 20260908161237) because
 * FOUR functions insert into couranr_delivery_requests and a fifth added later
 * would otherwise ship blank references silently — a BEFORE INSERT trigger is
 * the only placement a new caller cannot bypass.
 *
 * WHAT THIS FILE IS FOR: the read side. A reference reaches us the way a human
 * transcribed it — off a phone call, out of an email on a cracked screen, typed
 * into a support form in lowercase with the hyphens left out. This normalises
 * all of that to the one canonical string the unique index stores.
 *
 * THE ALPHABET IS CROCKFORD BASE32 (crockford.com/base32.html):
 *
 *     0123456789ABCDEFGHJKMNPQRSTVWXYZ
 *
 * I and L are absent because they are confusable with `1`, O because it is
 * confusable with `0`, and U to avoid accidental obscenity. Because no stored
 * reference can contain them, reading `I` or `L` from a human is unambiguous
 * evidence they meant `1`, and `O` that they meant `0` — so we can correct it
 * rather than tell a customer their reference does not exist. That correction
 * is the entire reason the alphabet was chosen; an alphabet without a decoder
 * is just a smaller alphabet.
 *
 * `U` has no such mapping. It is not a misread of anything, so it is rejected.
 */

/** The 32 symbols a stored reference may contain. */
export const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many symbols carry the entropy. 32^8 ≈ 1.1e12. */
export const REFERENCE_SYMBOL_COUNT = 8;

/** Matches only a canonical, stored reference — the same shape the database
 *  CHECK constraint enforces. Deliberately strict: use it on values that came
 *  from the database, and `normalizeDeliveryReference` on values that came
 *  from a person. */
export const REFERENCE_PATTERN =
  /^CR-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

/** True only for an exact canonical reference. */
export function isDeliveryReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE_PATTERN.test(value);
}

/**
 * The LEGACY order number, which also begins `CR-`.
 *
 * public.orders.order_number holds 42 real rows and every one of them is
 * `CR-` followed by six digits — CR-000042, CR-000041, … — a sequential
 * counter from the superseded courier system. Those numbers are on receipts
 * real people still hold.
 *
 * This matters because the two formats are NOT distinguishable once separators
 * are stripped. Measured before this guard existed:
 *
 *     normalizeDeliveryReference("CR-000042")  ->  "CR-CR00-0042"
 *
 * `CR000042` is eight characters and every one of C, R, 0, 4 and 2 is in the
 * Crockford alphabet, so a legacy order number was being read as a bare
 * eight-symbol body and silently reshaped into a different, valid-looking
 * reference. The lookup would then miss, and the person on the phone would be
 * told a number they are reading off a real receipt does not exist.
 *
 * The pattern is tested against the input BEFORE separators are stripped, so a
 * canonical reference — which always carries two hyphens — can never match it.
 * That leaves exactly one residual case: a generated body that happens to be
 * `CR` followed by six digits, at odds of about one in 1.1 million. Its
 * canonical two-hyphen form is still accepted; only someone typing that one
 * body bare would be turned away.
 */
export const LEGACY_ORDER_NUMBER_PATTERN = /^CR-?[0-9]{6}$/;

/**
 * True for an order number from the retired courier system.
 *
 * Exported so a lookup surface can say "that is an order number from the
 * previous system" instead of the flatly unhelpful "not found" — the person
 * holding it is not making a mistake.
 */
export function isLegacyOrderNumber(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return LEGACY_ORDER_NUMBER_PATTERN.test(input.trim().toUpperCase().replace(/\s/g, ""));
}

/**
 * Turn whatever a human gave us into the canonical reference, or null.
 *
 * Accepts, and returns `CR-4K7M-2P90` for every one of them:
 *   "CR-4K7M-2P90"   canonical
 *   "cr-4k7m-2p90"   lower case
 *   "CR4K7M2P90"     no separators
 *   "4K7M-2P90"      prefix omitted, which people do when reading one back
 *   " CR 4K7M 2P90 " spaces from a copy-paste
 *   "CR-4K7M-2P9O"   O read for 0        <- the Crockford correction
 *   "CR-4K7M-2P9o"   lower o
 *   "CR-4KIM-2P90"   I read for 1
 *   "CR-4KlM-2P90"   lower l read for 1
 *
 * Rejects (returns null) anything that is not eight symbols after that, and
 * anything containing `U`, which the alphabet excludes and which is not a
 * plausible misreading of another symbol.
 *
 * Returning null rather than throwing is deliberate: a mistyped reference is
 * ordinary user input on a lookup form, not an exceptional condition.
 */
export function normalizeDeliveryReference(input: unknown): string | null {
  if (typeof input !== "string") return null;

  /* A legacy order number is refused OUTRIGHT rather than reshaped. Checked
     first, and against the input before separators are stripped, so that a
     canonical reference (always two hyphens) can never be caught by it. See
     LEGACY_ORDER_NUMBER_PATTERN for the measured failure this prevents. */
  if (isLegacyOrderNumber(input)) return null;

  let s = input.toUpperCase();

  /* Separators are presentational. Crockford ignores hyphens on decode; spaces
     and underscores come from copy-paste and phone dictation. */
  s = s.replace(/[\s\-_]/g, "");

  /* The prefix is ours, not part of the encoded value. Strip it if present so
     "4K7M2P90" and "CR4K7M2P90" converge. Anchored so a reference that happens
     to *start* with the symbols C and R is untouched — C and R are both in the
     alphabet, so "CR7M2P90XY" is a legitimate body. */
  if (s.startsWith("CR") && s.length === REFERENCE_SYMBOL_COUNT + 2) {
    s = s.slice(2);
  }

  /* The Crockford correction, applied only after separators are gone so it
     cannot fire on decoration. */
  s = s.replace(/[IL]/g, "1").replace(/O/g, "0");

  if (s.length !== REFERENCE_SYMBOL_COUNT) return null;
  for (const ch of s) {
    if (!REFERENCE_ALPHABET.includes(ch)) return null;
  }

  return `CR-${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * The reference as it should appear to a person — which is simply the stored
 * value, since the database stores the display form.
 *
 * It exists so that call sites read as an intent ("show this to someone")
 * rather than a bare field access, and so a future change to grouping has one
 * place to happen instead of thirteen email templates.
 */
export function formatDeliveryReference(reference: string): string {
  return reference;
}
