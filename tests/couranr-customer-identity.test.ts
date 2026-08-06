import { describe, expect, it } from "vitest";
import {
  distinctAddresses,
  findDuplicates,
  identityKey,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  sameAddress,
} from "@/lib/couranr/customers/identity";

/**
 * MER-008 / MER-009 — the matching rule.
 *
 * This is the logic that decides whether two records are the same person.
 * Getting it wrong splits one customer in two or reports two real customers as
 * one, so both directions are tested: what MUST match, and what must NOT.
 */

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("does NOT strip dots or plus-tags — those are one provider's convention", () => {
    // Treating a.b@ and ab@ as one person would be a guess about someone
    // else's mail server, and would merge two real customers.
    expect(normalizeEmail("a.b@example.com")).toBe("a.b@example.com");
    expect(normalizeEmail("ada+couranr@example.com")).toBe("ada+couranr@example.com");
    expect(normalizeEmail("a.b@example.com")).not.toBe(normalizeEmail("ab@example.com"));
  });

  it("rejects anything that is not an address", () => {
    for (const v of ["", "   ", "not-an-email", null, undefined]) {
      expect(normalizeEmail(v as any), String(v)).toBeNull();
    }
  });
});

describe("normalizePhone", () => {
  it("reduces formatting to digits", () => {
    expect(normalizePhone("(540) 555-0100")).toBe("5405550100");
    expect(normalizePhone("540.555.0100")).toBe("5405550100");
  });

  it("drops a NANP country code so +1 forms match plain ones", () => {
    expect(normalizePhone("+1 540 555 0100")).toBe("5405550100");
    expect(normalizePhone("15405550100")).toBe(normalizePhone("5405550100"));
  });

  it("refuses anything too short to be dialable", () => {
    // A 3-digit "number" matching another 3-digit "number" would be confident
    // nonsense, so short input is null rather than a truncated key.
    for (const v of ["", "123", "555-01", null, undefined]) {
      expect(normalizePhone(v as any), String(v)).toBeNull();
    }
  });

  it("leaves a genuine international number's digits intact", () => {
    // 12 digits, not a NANP +1 form: nothing is trimmed.
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
  });
});

describe("identityKey prefers the most specific identifier", () => {
  it("uses email when present", () => {
    expect(
      identityKey({ name: "Ada", email: "ADA@example.com", phone: "5405550100" })
    ).toBe("email:ada@example.com");
  });

  it("falls back to phone, then to name", () => {
    expect(identityKey({ name: "Ada", email: null, phone: "(540) 555-0100" })).toBe(
      "phone:5405550100"
    );
    expect(identityKey({ name: "  Ada  Lovelace ", email: null, phone: null })).toBe(
      "name:ada lovelace"
    );
  });

  it("returns null when there is nothing to key on", () => {
    expect(identityKey({ name: null, email: null, phone: null })).toBeNull();
    expect(identityKey({ name: "  ", email: "", phone: "12" })).toBeNull();
  });
});

describe("findDuplicates", () => {
  it("flags a STRONG duplicate when two keys share a phone", () => {
    const found = findDuplicates([
      { key: "email:ada@example.com", identity: { name: "Ada", email: "ada@example.com", phone: "5405550100" } },
      { key: "phone:5405550100", identity: { name: "A. Lovelace", email: null, phone: "(540) 555-0100" } },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].strength).toBe("strong");
    expect(found[0].keys).toEqual(["email:ada@example.com", "phone:5405550100"]);
  });

  it("flags a WEAK duplicate for a shared name, and says they may differ", () => {
    const found = findDuplicates([
      { key: "email:j1@example.com", identity: { name: "John Smith", email: "j1@example.com", phone: null } },
      { key: "email:j2@example.com", identity: { name: "john  smith", email: "j2@example.com", phone: null } },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].strength).toBe("weak");
    expect(found[0].reason).toContain("may be different people");
  });

  it("does NOT flag genuinely distinct customers", () => {
    expect(
      findDuplicates([
        { key: "email:a@example.com", identity: { name: "Ada", email: "a@example.com", phone: "5405550100" } },
        { key: "email:b@example.com", identity: { name: "Grace", email: "b@example.com", phone: "5405550199" } },
      ])
    ).toEqual([]);
  });

  it("reports a pair once, and never downgrades a strong match to weak", () => {
    // Same phone AND same name: one warning, and it stays strong.
    const found = findDuplicates([
      { key: "email:a@example.com", identity: { name: "Ada", email: "a@example.com", phone: "5405550100" } },
      { key: "email:b@example.com", identity: { name: "Ada", email: "b@example.com", phone: "5405550100" } },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].strength).toBe("strong");
  });

  it("a single record can never duplicate itself", () => {
    expect(
      findDuplicates([
        { key: "email:a@example.com", identity: { name: "Ada", email: "a@example.com", phone: "5405550100" } },
      ])
    ).toEqual([]);
  });
});

describe("PII masking for the list view", () => {
  it("masks an email to its first character and domain", () => {
    expect(maskEmail("ada@example.com")).toBe("a•••@example.com");
  });

  it("masks a phone to its last four digits", () => {
    expect(maskPhone("(540) 555-0100")).toBe("(•••) •••-0100");
  });

  it("NEVER returns the full value", () => {
    // The registry forbids unnecessary PII in the list view, so the masked
    // form must not contain the original.
    expect(maskEmail("ada@example.com")).not.toContain("ada@");
    expect(maskPhone("5405550100")).not.toContain("5405550100");
    expect(maskPhone("5405550100")).not.toContain("540555");
  });

  it("returns null rather than a misleading mask for absent values", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });
});

describe("address comparison for the conflicting-address state", () => {
  const base = { line1: "12 Main St", city: "Stafford", region: "VA", postalCode: "22554" };

  it("ignores case and whitespace", () => {
    expect(sameAddress(base, { ...base, line1: "  12 MAIN ST " })).toBe(true);
  });

  it("accepts postal_code as an alias for postalCode", () => {
    expect(sameAddress(base, { ...base, postalCode: undefined, postal_code: "22554" })).toBe(true);
  });

  it("IGNORES instructions — a changed gate code is not a new address", () => {
    expect(sameAddress(base, { ...base, instructions: "gate code 1234" })).toBe(true);
  });

  it("treats a different street or ZIP as a different address", () => {
    expect(sameAddress(base, { ...base, line1: "14 Main St" })).toBe(false);
    expect(sameAddress(base, { ...base, postalCode: "22555" })).toBe(false);
  });

  it("distinctAddresses keeps first-seen order and drops repeats", () => {
    const a = { ...base };
    const b = { ...base, line1: "14 Main St" };
    expect(distinctAddresses([a, { ...a }, b, { ...b }])).toEqual([a, b]);
  });
});
