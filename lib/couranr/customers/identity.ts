/**
 * MER-008 / MER-009 — customer identity normalization and duplicate detection.
 *
 * Pure and dependency-free, so the whole matching rule is unit-testable
 * without a database — which matters more here than usual, because this is the
 * logic that decides whether two rows are "the same person", and getting it
 * wrong either splits one customer in two or merges two real customers into
 * one.
 *
 * THE RULE IS DELIBERATELY CONSERVATIVE. Couranr never MERGES anything: the
 * registry's allowed actions for MER-008 do not include merge, so a match
 * produces a WARNING for the merchant to judge, never an automatic join. A
 * false positive here costs a dismissible banner; an automatic merge would
 * cost a merchant their two distinct customers.
 */

/**
 * An email reduced to a comparable form: trimmed and lower-cased, nothing
 * more.
 *
 * Notably it does NOT strip dots or `+tags` from the local part. Those are
 * Gmail conventions, not email standards — `a.b@example.com` and
 * `ab@example.com` are different mailboxes at most providers, and treating
 * them as one person would be a guess about someone else's mail server.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "" || !value.includes("@")) return null;
  return value;
}

/**
 * A phone reduced to its digits, with a leading North American country code
 * dropped so `+1 540 555 0100` and `(540) 555-0100` are the same person.
 *
 * Anything that does not look like a dialable number returns null rather than
 * a short digit string, because a 3-digit "number" matching another 3-digit
 * "number" would produce confident nonsense.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits.length < 10) return null;
  // Trim a NANP country code, but only when doing so leaves exactly 10 digits.
  const trimmed = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return trimmed;
}

/** A name reduced for comparison: collapsed whitespace, lower-cased. */
export function normalizeName(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return value === "" ? null : value;
}

export type CustomerIdentity = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * The key two records are grouped by, in priority order: email, then phone,
 * then name.
 *
 * Email first because it is the most specific thing a person gives; phone
 * next; name LAST and only as a fallback, because two different customers
 * genuinely can be called "John Smith" — which is exactly why a name-only
 * match is reported as a weak duplicate below rather than treated as the same
 * person.
 */
export function identityKey(identity: CustomerIdentity): string | null {
  const email = normalizeEmail(identity.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(identity.phone);
  if (phone) return `phone:${phone}`;
  const name = normalizeName(identity.name);
  if (name) return `name:${name}`;
  return null;
}

export type DuplicateStrength = "strong" | "weak";

export type DuplicateWarning = {
  /** The identity keys involved, sorted, so the pair is stable. */
  keys: string[];
  strength: DuplicateStrength;
  reason: string;
};

/**
 * Find records that look like the same person under different keys.
 *
 * STRONG: two records grouped under different keys share a normalized phone or
 * email — e.g. one was created with an email and another with the same phone.
 * That is a near-certain duplicate.
 *
 * WEAK: two records share only a normalized NAME. Reported, but labelled, and
 * the copy must never assert they are the same person.
 *
 * Returns at most one warning per pair, deduplicated and stably ordered.
 */
export function findDuplicates(
  records: { key: string; identity: CustomerIdentity }[]
): DuplicateWarning[] {
  const byEmail = new Map<string, Set<string>>();
  const byPhone = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, value: string | null, key: string) => {
    if (!value) return;
    if (!map.has(value)) map.set(value, new Set());
    map.get(value)!.add(key);
  };

  for (const r of records) {
    add(byEmail, normalizeEmail(r.identity.email), r.key);
    add(byPhone, normalizePhone(r.identity.phone), r.key);
    add(byName, normalizeName(r.identity.name), r.key);
  }

  const seen = new Set<string>();
  const out: DuplicateWarning[] = [];

  const collect = (
    map: Map<string, Set<string>>,
    strength: DuplicateStrength,
    reason: string
  ) => {
    for (const keys of map.values()) {
      if (keys.size < 2) continue;
      const sorted = [...keys].sort();
      const pairId = sorted.join("|");
      // A pair already flagged STRONG is never downgraded by a later weak
      // match on the same pair.
      if (seen.has(pairId)) continue;
      seen.add(pairId);
      out.push({ keys: sorted, strength, reason });
    }
  };

  collect(byEmail, "strong", "These records share an email address.");
  collect(byPhone, "strong", "These records share a phone number.");
  collect(byName, "weak", "These records share a name. They may be different people.");

  return out;
}

/**
 * The key a customer is addressed by IN A URL.
 *
 * `identityKey` embeds the raw identifier — `phone:5405550142` — which is
 * fine as an internal grouping key and NOT fine in a link. A browser-visible
 * key ends up in the address bar, in history, in referrer headers and in
 * server logs, and the registry forbids unnecessary PII in the list view. A
 * first run of the customer-book harness caught exactly that: the real phone
 * number was present in the rendered list HTML, inside the Open link.
 *
 * So the public key is a digest, salted with the business account id so the
 * same person in two workspaces produces two unrelated keys. It is computed
 * SERVER-SIDE only; the browser never sees an identity it can reverse.
 */
export function publicCustomerKey(
  businessAccountId: string,
  key: string,
  sha256: (input: string) => string
): string {
  return sha256(`${businessAccountId}:${key}`).slice(0, 32);
}

/** Masks an email for the LIST view: `k•••@example.com`. */
export function maskEmail(raw: string | null | undefined): string | null {
  const value = normalizeEmail(raw);
  if (!value) return null;
  const [local, domain] = value.split("@");
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/** Masks a phone for the LIST view: `(•••) •••-0100`. */
export function maskPhone(raw: string | null | undefined): string | null {
  const digits = normalizePhone(raw);
  if (!digits) return null;
  return `(•••) •••-${digits.slice(-4)}`;
}

/**
 * Compare two address snapshots for the "conflicting address" state.
 *
 * Compares the fields that decide WHERE a driver goes. `instructions` are
 * deliberately excluded: a changed gate code is not a different address, and
 * treating it as one would raise a conflict banner every time someone updated
 * a door note.
 */
export function sameAddress(a: any, b: any): boolean {
  const key = (x: any) =>
    [
      String(x?.line1 ?? "").trim().toLowerCase(),
      String(x?.line2 ?? "").trim().toLowerCase(),
      String(x?.city ?? "").trim().toLowerCase(),
      String(x?.region ?? "").trim().toLowerCase(),
      String(x?.postalCode ?? x?.postal_code ?? "").trim().toLowerCase(),
    ].join("|");
  return key(a) === key(b);
}

/** Distinct addresses, newest first, for the detail view. */
export function distinctAddresses<T>(snapshots: T[]): T[] {
  const out: T[] = [];
  for (const s of snapshots) {
    if (!out.some((existing) => sameAddress(existing, s))) out.push(s);
  }
  return out;
}
