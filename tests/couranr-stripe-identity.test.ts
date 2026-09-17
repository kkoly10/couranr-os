import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COURANR_RECIPIENT_MINIMUM_AGE,
  IdentityConfigurationError,
  IdentityProviderError,
  STRIPE_IDENTITY_API_VERSION,
  STRIPE_IDENTITY_STATUSES,
  calendarAgeInYears,
  evaluateVerificationSession,
  isAdultOn,
  matchesDesignatedRecipient,
  parseVerificationSession,
  resolveRecipientIdentityOutcome,
  retrieveVerificationSession,
  type StripeVerificationSession,
} from "@/lib/couranr/identity/stripeIdentity";
import { COURANR_IDENTITY_POLICY_VERSION } from "@/lib/couranr/identity/recipientIdentity";

const ROOT = path.resolve(__dirname, "..");
const SOURCE = readFileSync(path.join(ROOT, "lib/couranr/identity/stripeIdentity.ts"), "utf8");
/** Comments describe intent; only executable text can leak a credential. */
const CODE = SOURCE.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");

const AT = (iso: string) => new Date(iso);
const SESSION = (over: Partial<StripeVerificationSession> = {}): StripeVerificationSession => ({
  id: "vs_test123",
  status: "verified",
  lastErrorCode: null,
  verifiedOutputs: { firstName: "Ann", lastName: "Smith", dob: { year: 2000, month: 6, day: 15 } },
  ...over,
});
const evaluate = (s: StripeVerificationSession, name = "Ann Smith", asOf = "2026-09-17T12:00:00Z") =>
  evaluateVerificationSession(s, {
    designatedRecipientName: name,
    asOf: AT(asOf),
    restrictedKeyConfigured: true,
  });

describe("the provider's status vocabulary, as documented", () => {
  it("has exactly four statuses and none of them is `failed`", () => {
    /* This is the fact that invalidated the first version of the schema. Stripe
       has no `failed` status: a check that does not pass leaves the session in
       `requires_input` with last_error set and is retryable on the SAME session.
       If this array ever grows a `failed`, the retry migration's reasoning — and
       its comment — need re-reading, not a quiet edit here. */
    expect([...STRIPE_IDENTITY_STATUSES].sort()).toEqual([
      "canceled",
      "processing",
      "requires_input",
      "verified",
    ]);
  });

  it("maps an unrecognized status to a closed, retryable outcome", () => {
    // A status Stripe adds later must never read as a pass, and must not stall.
    const out = evaluate(SESSION({ status: "awaiting_review" }));
    expect(out.state).toBe("failed");
    expect(out.reason).toBe("provider_status_unrecognized");
    expect(out.identityVerified).toBe(false);
  });
});

describe("the two questions `requires_input` can be answering", () => {
  it("is PENDING when nothing has been submitted", () => {
    const out = evaluate(SESSION({ status: "requires_input", lastErrorCode: null }));
    expect(out.state).toBe("pending");
    expect(out.reason).toBe("not_submitted");
  });

  it("is FAILED when a submitted check did not pass", () => {
    const out = evaluate(
      SESSION({ status: "requires_input", lastErrorCode: "document_unverified_other" })
    );
    expect(out.state).toBe("failed");
    expect(out.reason).toBe("provider_rejected");
  });

  it("never lets an in-progress session claim any verified fact", () => {
    for (const status of ["processing", "requires_input", "canceled"]) {
      const out = evaluate(SESSION({ status }));
      expect(out.identityVerified, status).toBe(false);
      expect(out.adultVerified, status).toBe(false);
      expect(out.authorizedRecipientMatch, status).toBe(false);
    }
  });
});

describe("age, by calendar", () => {
  it("is 18 on the birthday itself and 17 the day before", () => {
    /* The ONLY place this arithmetic matters is the boundary, which is exactly
       where a milliseconds/365.25 computation goes wrong — by up to a day,
       depending on how many leap years the interval spanned. */
    const dob = { year: 2008, month: 9, day: 17 };
    expect(calendarAgeInYears(dob, AT("2026-09-16T23:59:59Z"))).toBe(17);
    expect(calendarAgeInYears(dob, AT("2026-09-17T00:00:00Z"))).toBe(18);
    expect(isAdultOn(dob, AT("2026-09-16T23:59:59Z"))).toBe(false);
    expect(isAdultOn(dob, AT("2026-09-17T00:00:00Z"))).toBe(true);
  });

  it("takes the LATER reading for a 29 February birthday", () => {
    // 1 March, not 28 February — the conservative direction for a custody gate.
    const dob = { year: 2008, month: 2, day: 29 };
    expect(isAdultOn(dob, AT("2026-02-28T12:00:00Z"))).toBe(false);
    expect(isAdultOn(dob, AT("2026-03-01T12:00:00Z"))).toBe(true);
  });

  it("refuses an unreadable date rather than treating it as any age", () => {
    for (const bad of [
      { year: 2000, month: 13, day: 1 },
      { year: 2000, month: 6, day: 32 },
      { year: 1800, month: 6, day: 15 },
      { year: 2.5, month: 6, day: 15 },
      { year: null, month: 6, day: 15 },
      { year: 2030, month: 6, day: 15 }, // not yet born
    ] as never[]) {
      expect(calendarAgeInYears(bad, AT("2026-09-17T12:00:00Z")), JSON.stringify(bad)).toBeNull();
      expect(isAdultOn(bad, AT("2026-09-17T12:00:00Z"))).toBe(false);
    }
  });

  it("pins the minimum at 18", () => {
    expect(COURANR_RECIPIENT_MINIMUM_AGE).toBe(18);
  });
});

describe("whether the verified person is the person the sender named", () => {
  const m = (first: string, last: string, designated: string) =>
    matchesDesignatedRecipient({ firstName: first, lastName: last }, designated);

  it("accepts the forms a real sender actually types", () => {
    expect(m("Ann", "Smith", "Ann Smith")).toBe(true);
    expect(m("Ann", "Smith", "ann smith")).toBe(true);
    expect(m("Ann", "Smith", "Ann Marie Smith")).toBe(true);
    expect(m("Ann", "Smith", "Smith, Ann")).toBe(true);
    expect(m("Ann", "Smith-Jones", "Ann Smith-Jones")).toBe(true);
    expect(m("Ann", "Smith", "Ann Smith Jr.")).toBe(true);
    expect(m("José", "Núñez", "Jose Nunez")).toBe(true);
  });

  it("REFUSES a token swap — the case set membership alone would pass", () => {
    /* Designated "Ann Smith Jones"; a different person presents ID reading
       first "Jones", last "Smith". Both tokens appear in the designated name, so
       a subset test would call this a match. The final-token rule is what
       catches it. */
    expect(m("Jones", "Smith", "Ann Smith Jones")).toBe(false);
  });

  it("refuses a stranger, a partial name, and an empty side", () => {
    expect(m("Bob", "Smith", "Ann Smith")).toBe(false);
    expect(m("Ann", "Jones", "Ann Smith")).toBe(false);
    expect(m("Ann", "Smith", "Smith")).toBe(false); // one token cannot carry both
    expect(m("Ann", "Smith", "")).toBe(false);
    expect(m("", "Smith", "Ann Smith")).toBe(false);
    expect(m("Ann", "", "Ann Smith")).toBe(false);
    expect(matchesDesignatedRecipient({ firstName: null, lastName: null }, "Ann Smith")).toBe(false);
  });

  it("refuses a nickname, and that refusal is deliberate", () => {
    /* "Bob" against "Robert" is a real person being turned away. It is still the
       right answer: a loose match makes the protection the sender paid for
       indistinguishable from none, and Operations can resolve a nickname where
       nobody can un-hand a package to a stranger. */
    expect(m("Robert", "Smith", "Bob Smith")).toBe(false);
  });
});

describe("a `verified` session still has to clear both Couranr questions", () => {
  it("verifies only when adult AND named — and says so", () => {
    const out = evaluate(SESSION());
    expect(out.state).toBe("verified");
    expect(out.identityVerified).toBe(true);
    expect(out.adultVerified).toBe(true);
    expect(out.authorizedRecipientMatch).toBe(true);
    expect(out.reason).toBe("verified");
    expect(out.policyVersion).toBe(COURANR_IDENTITY_POLICY_VERSION);
    expect(out.providerReference).toBe("vs_test123");
  });

  it("fails a verified minor without ever claiming the derived flags", () => {
    const out = evaluate(SESSION({
      verifiedOutputs: { firstName: "Ann", lastName: "Smith", dob: { year: 2012, month: 6, day: 15 } },
    }));
    expect(out.state).toBe("failed");
    expect(out.reason).toBe("recipient_under_minimum_age");
    expect(out.identityVerified).toBe(true);
    expect(out.adultVerified).toBe(false);
    expect(out.authorizedRecipientMatch).toBe(false);
    expect(out.blockedByConfiguration).toBe(false);
  });

  it("fails a verified adult who is not the named recipient", () => {
    const out = evaluate(SESSION(), "Bob Jones");
    expect(out.state).toBe("failed");
    expect(out.reason).toBe("recipient_name_mismatch");
    expect(out.adultVerified).toBe(false);
  });

  it("tells a MISSING CREDENTIAL apart from a suspicious recipient", () => {
    /* The distinction this whole `reason`/`blockedByConfiguration` pair exists
       for. Both fail closed. Only one of them is evidence about a person, and
       Operations must never read the other one as such. */
    const noDob = SESSION({
      verifiedOutputs: { firstName: "Ann", lastName: "Smith", dob: null },
    });
    const misconfigured = evaluateVerificationSession(noDob, {
      designatedRecipientName: "Ann Smith",
      asOf: AT("2026-09-17T12:00:00Z"),
      restrictedKeyConfigured: false,
    });
    expect(misconfigured.state).toBe("failed");
    expect(misconfigured.reason).toBe("date_of_birth_unreadable");
    expect(misconfigured.blockedByConfiguration).toBe(true);

    const minor = evaluate(SESSION({
      verifiedOutputs: { firstName: "Ann", lastName: "Smith", dob: { year: 2012, month: 6, day: 15 } },
    }));
    expect(minor.blockedByConfiguration).toBe(false);
  });

  it("treats absent outputs as a configuration block, never as a pass", () => {
    const out = evaluate(SESSION({ verifiedOutputs: null }));
    expect(out.state).toBe("failed");
    expect(out.reason).toBe("outputs_unavailable");
    expect(out.adultVerified).toBe(false);
    expect(out.blockedByConfiguration).toBe(true);
  });
});

describe("what the adapter is allowed to remember", () => {
  it("returns no name, no date of birth, and no document data — structurally", () => {
    /* Asserted over the KEY SET rather than over a few known-bad names, so a
       field added later fails here instead of quietly shipping PII into a
       database row, a log line or the Operations bundle. */
    /* Distinctive fixture values, chosen so they cannot collide with a legitimate
       field. An earlier draft of this test used day 15 and failed against the
       `15` in the policy version string `...-2026-09-15` — the test was wrong,
       not the module, and a colliding token would have hidden a real leak. */
    const out = evaluate(
      SESSION({
        verifiedOutputs: {
          firstName: "Zqxname",
          lastName: "Wvsurname",
          dob: { year: 1987, month: 3, day: 22 },
        },
      }),
      "Zqxname Wvsurname"
    );
    expect(out.state).toBe("verified");
    expect(Object.keys(out).sort()).toEqual([
      "adultVerified",
      "authorizedRecipientMatch",
      "blockedByConfiguration",
      "identityVerified",
      "policyVersion",
      "providerReference",
      "reason",
      "state",
    ]);
    const serialized = JSON.stringify(out);
    for (const secret of ["Zqxname", "Wvsurname", "1987", "22"]) {
      expect(serialized, `${secret} survived into the outcome`).not.toContain(secret);
    }
  });

  it("drops every field it was not asked to read, at the boundary", () => {
    const parsed = parseVerificationSession({
      id: "vs_1",
      status: "verified",
      verified_outputs: {
        first_name: "Ann",
        last_name: "Smith",
        dob: { year: 2000, month: 6, day: 15 },
        address: { line1: "1 Main St", postal_code: "20001" },
        email: "ann@example.com",
        phone: "+12025550100",
        id_number: "000-00-1234",
        id_number_type: "us_ssn",
      },
      last_error: { code: "document_unverified_other", reason: "Ann Smith's document was blurry" },
      last_verification_report: { document: { number: "D1234567", files: ["file_1"] } },
    });
    const serialized = JSON.stringify(parsed);
    for (const leaked of ["Main St", "20001", "ann@example.com", "+12025550100", "000-00-1234", "D1234567", "file_1"]) {
      expect(serialized, `${leaked} crossed the boundary`).not.toContain(leaked);
    }
    // The error CODE is kept; the provider's prose — which quotes the person — is not.
    expect(parsed.lastErrorCode).toBe("document_unverified_other");
    expect(serialized).not.toContain("blurry");
  });

  it("refuses a payload with no session id rather than inventing one", () => {
    expect(() => parseVerificationSession({ status: "verified" })).toThrow(IdentityProviderError);
  });

  it("ignores a malformed date of birth instead of coercing it", () => {
    const parsed = parseVerificationSession({
      id: "vs_1",
      status: "verified",
      verified_outputs: { first_name: "Ann", last_name: "Smith", dob: { year: "2000", month: 6, day: 15 } },
    });
    expect(parsed.verifiedOutputs?.dob).toBeNull();
  });
});

describe("the request that actually goes to the provider", () => {
  const deps = (fetchImpl: typeof fetch, key = "rk_test_abc") => ({
    fetchImpl,
    restrictedKey: key,
    now: () => AT("2026-09-17T12:00:00Z"),
  });
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it("expands verified_outputs AND verified_outputs.dob — neither implies the other", () => {
    /* THE silent-failure guard for this module. Stripe's access table marks date
       of birth as unreachable with a secret key and gives it its own expand
       path. Drop either half and a genuinely verified adult computes
       adultVerified=false, the database refuses the row with an evidence error,
       and it looks exactly like a fraudulent recipient. */
    let seen = "";
    const f = (async (url: string) => {
      seen = String(url);
      return ok({ id: "vs_1", status: "processing" });
    }) as unknown as typeof fetch;
    return retrieveVerificationSession("vs_1", deps(f)).then(() => {
      expect(seen).toContain("expand[]=verified_outputs");
      expect(seen).toContain("expand[]=verified_outputs.dob");
      expect(seen).toContain("/v1/identity/verification_sessions/vs_1");
    });
  });

  it("authenticates with the RESTRICTED key and pins the API version", async () => {
    let init: RequestInit = {};
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return ok({ id: "vs_1", status: "processing" });
    }) as unknown as typeof fetch;
    await retrieveVerificationSession("vs_1", deps(f, "rk_live_xyz"));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer rk_live_xyz");
    expect(headers["Stripe-Version"]).toBe(STRIPE_IDENTITY_API_VERSION);
    expect(STRIPE_IDENTITY_API_VERSION).toBe("2024-04-10");
  });

  it("refuses LOUDLY without a restricted key rather than reporting not-adult", async () => {
    const f = (async () => ok({ id: "vs_1", status: "verified" })) as unknown as typeof fetch;
    await expect(retrieveVerificationSession("vs_1", deps(f, ""))).rejects.toBeInstanceOf(
      IdentityConfigurationError
    );
  });

  it("makes no call at all for a malformed session id", async () => {
    let calls = 0;
    const f = (async () => {
      calls += 1;
      return ok({});
    }) as unknown as typeof fetch;
    await expect(retrieveVerificationSession("not-a-session", deps(f))).rejects.toBeInstanceOf(
      IdentityProviderError
    );
    expect(calls).toBe(0);
  });

  it("surfaces only the HTTP status from a provider error", async () => {
    const f = (async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Ann Smith is not permitted" } }),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(retrieveVerificationSession("vs_1", deps(f))).rejects.toThrow(
      /identity_provider_http_403/
    );
    await expect(retrieveVerificationSession("vs_1", deps(f))).rejects.not.toThrow(/Ann Smith/);
  });

  it("resolves end to end without the personal data reaching the caller", async () => {
    const f = (async () =>
      ok({
        id: "vs_end",
        status: "verified",
        verified_outputs: {
          first_name: "Ann",
          last_name: "Smith",
          dob: { year: 2000, month: 6, day: 15 },
        },
      })) as unknown as typeof fetch;
    const out = await resolveRecipientIdentityOutcome(
      "vs_end",
      { designatedRecipientName: "Ann Smith" },
      deps(f)
    );
    expect(out.state).toBe("verified");
    expect(out.adultVerified).toBe(true);
    expect(JSON.stringify(out)).not.toContain("Smith");
  });
});

describe("no ambient credentials and no ambient transport", () => {
  it("reads no environment variable anywhere in the module", () => {
    /* `recipientIdentity.ts` documents why no code path may call Stripe by
       accident: the owner has already lost money to development-time provider
       calls. This module keeps that guarantee structurally — a caller must hand
       over a key and a transport explicitly, so every live call site is
       greppable and an accidental one cannot be written by omission. */
    expect(CODE).not.toMatch(/process\.env/);
  });

  it("supplies no default fetch, so a call cannot happen by omission", () => {
    expect(CODE).not.toMatch(/\?\?\s*fetch\b/);
    expect(CODE).not.toMatch(/fetchImpl\s*\|\|/);
    // The only fetch invoked is the injected one.
    const calls = [...CODE.matchAll(/(^|[^.\w])fetch\s*\(/g)];
    expect(calls, "an un-injected fetch( call exists").toHaveLength(0);
  });

  it("names the restricted-key requirement in the source, not only in a doc", () => {
    // The next person to touch this will reach for STRIPE_SECRET_KEY. Stop them here.
    expect(SOURCE).toMatch(/verified_outputs\.dob/);
    expect(SOURCE).toMatch(/restrictedKey/);
  });
});
