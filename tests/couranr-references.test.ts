import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  REFERENCE_SYMBOL_COUNT,
  isDeliveryReference,
  normalizeDeliveryReference,
} from "@/lib/couranr/references";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260908120000_couranr_delivery_reference.sql"),
  "utf8"
);

describe("the alphabet is Crockford Base32", () => {
  it("has 32 unique symbols", () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(32);
  });

  it("excludes I, L, O and U — the whole basis of the correction below", () => {
    for (const ch of ["I", "L", "O", "U"]) {
      expect(REFERENCE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`).toBe(false);
    }
  });

  it("matches Crockford's published alphabet exactly", () => {
    expect(REFERENCE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  });
});

describe("normalizeDeliveryReference — what a human actually types", () => {
  const canonical = "CR-4K7M-2P90";

  it.each([
    ["canonical", "CR-4K7M-2P90"],
    ["lower case", "cr-4k7m-2p90"],
    ["mixed case", "Cr-4K7m-2P90"],
    ["no separators", "CR4K7M2P90"],
    ["prefix omitted", "4K7M-2P90"],
    ["prefix omitted, no separators", "4K7M2P90"],
    ["surrounding whitespace", "   CR-4K7M-2P90  "],
    ["spaces instead of hyphens", "CR 4K7M 2P90"],
    ["underscores", "CR_4K7M_2P90"],
  ])("accepts %s", (_label, input) => {
    expect(normalizeDeliveryReference(input)).toBe(canonical);
  });

  it.each([
    ["capital O read for zero", "CR-4K7M-2P9O"],
    ["lower o read for zero", "cr-4k7m-2p9o"],
  ])("corrects %s", (_label, input) => {
    expect(normalizeDeliveryReference(input)).toBe(canonical);
  });

  it.each([
    ["capital I read for one", "CR-4K7M-2P9I", "CR-4K7M-2P91"],
    ["lower l read for one", "cr-4k7m-2p9l", "CR-4K7M-2P91"],
    ["capital L read for one", "CR-4K7M-2P9L", "CR-4K7M-2P91"],
  ])("corrects %s", (_label, input, expected) => {
    expect(normalizeDeliveryReference(input)).toBe(expected);
  });

  it("rejects U — it is excluded from the alphabet and is not a misread of anything", () => {
    expect(normalizeDeliveryReference("CR-4K7M-2P9U")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["too short", "CR-4K7M-2P9"],
    ["too long", "CR-4K7M-2P901"],
    ["not a string", 42],
    ["null", null],
    ["undefined", undefined],
    ["a uuid", "8f42qk00-1111-2222-3333-444455556666"],
    ["prose", "my delivery"],
    ["punctuation inside", "CR-4K7M-2P9!"],
  ])("rejects %s", (_label, input) => {
    expect(normalizeDeliveryReference(input as unknown)).toBeNull();
  });

  it("does not eat a leading CR that is part of the eight symbols", () => {
    // C and R are both in the alphabet, so "CR7M2P90" as a BODY is legitimate.
    // Stripping the prefix unconditionally would corrupt it.
    expect(normalizeDeliveryReference("CR-CR7M-2P90")).toBe("CR-CR7M-2P90");
    expect(normalizeDeliveryReference("CRCR7M2P90")).toBe("CR-CR7M-2P90");
  });

  it("is idempotent — normalising a canonical value returns it unchanged", () => {
    const once = normalizeDeliveryReference("cr 4k7m 2p9o");
    expect(once).toBe(canonical);
    expect(normalizeDeliveryReference(once!)).toBe(canonical);
  });

  it("every output it produces passes the strict pattern", () => {
    for (const input of ["cr-4k7m-2p9o", "4K7M2P9I", "CR 4K7M 2P90"]) {
      const out = normalizeDeliveryReference(input);
      expect(out, `${input} should normalise`).not.toBeNull();
      expect(isDeliveryReference(out)).toBe(true);
    }
  });
});

describe("isDeliveryReference is strict — for values out of the database", () => {
  it("accepts only the canonical form", () => {
    expect(isDeliveryReference("CR-4K7M-2P90")).toBe(true);
  });
  it.each(["cr-4k7m-2p90", "CR4K7M2P90", "4K7M-2P90", "CR-4K7M-2P9O", "", null, 7])(
    "rejects %s",
    (v) => expect(isDeliveryReference(v)).toBe(false)
  );
});

describe("the TypeScript and the migration cannot drift apart", () => {
  /**
   * Two independent definitions of the same format is how a validator and a
   * CHECK constraint end up disagreeing, and the failure only appears at insert
   * time in production. These pin them to each other.
   */
  it("the migration's CHECK uses the same character class as REFERENCE_PATTERN", () => {
    expect(MIGRATION).toContain(
      "'^CR-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$'"
    );
    expect(REFERENCE_PATTERN.source).toBe(
      "^CR-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$"
    );
  });

  it("the migration's generator alphabet matches REFERENCE_ALPHABET", () => {
    expect(MIGRATION).toContain(`alphabet constant text := '${REFERENCE_ALPHABET}'`);
  });

  it("the migration emits exactly REFERENCE_SYMBOL_COUNT symbols", () => {
    // `for i in 0..7` is eight iterations.
    expect(MIGRATION).toContain(`for i in 0..${REFERENCE_SYMBOL_COUNT - 1} loop`);
  });

  it("assignment is a BEFORE INSERT trigger, not a per-command call", () => {
    // Four functions insert into this table; a command-level assignment would
    // leave three of them producing null references.
    expect(MIGRATION).toContain("before insert on public.couranr_delivery_requests");
  });

  it("the generator and trigger are revoked from browser roles", () => {
    // pg_default_acl in this project grants EXECUTE to anon and authenticated
    // on every new public function, so a narrow grant is only real after a
    // revoke.
    for (const fn of [
      "public.couranr_generate_delivery_reference()",
      "public.couranr_assign_delivery_reference()",
    ]) {
      expect(MIGRATION).toContain(`revoke all on function ${fn}`);
    }
  });

  it("has a paired rollback that refuses to drop a reference already in the wild", () => {
    const rollback = readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260908120000_couranr_delivery_reference.rollback.sql"),
      "utf8"
    );
    expect(rollback).toContain("refusing to remove couranr_delivery_requests.reference");
  });
});

describe("the format resists the failure modes it was chosen against", () => {
  it("carries no timestamp or counter, so it cannot leak delivery volume", () => {
    // Sequential or ULID-style references let anyone place two orders and diff
    // them to read off volume and growth. The generator takes every symbol from
    // gen_random_uuid() and nothing from a clock or a sequence.
    expect(MIGRATION).toContain("gen_random_uuid()");
    expect(MIGRATION).not.toMatch(/\bnextval\b|\bsequence\b|clock_timestamp\(\)/i);
  });

  it("reduces a whole byte mod 32, which is exactly uniform", () => {
    // 256 is divisible by 32, so `byte % 32` has no modulo bias. A narrower
    // source (say 0..9 digits) would skew the distribution.
    expect(MIGRATION).toContain("::bit(8)::integer");
    expect(MIGRATION).toContain("(byte % 32) + 1");
  });
});
