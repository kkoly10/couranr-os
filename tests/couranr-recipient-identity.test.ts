import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COURANR_IDENTITY_POLICY_VERSION,
  IDENTITY_OUTCOME_COPY,
  isStripeIdentityActivated,
  resolveRecipientIdentity,
} from "@/lib/couranr/identity/recipientIdentity";

/**
 * Stripe Identity is NOT activated, by owner decision, and the owner has stated
 * cost safety as a release requirement after losing money to provider calls
 * during development. So the property under test is not "the flag is off" — it
 * is that there is no code path to turn on.
 */
const ROOT = path.resolve(__dirname, "..");
const SOURCE = readFileSync(
  path.join(ROOT, "lib/couranr/identity/recipientIdentity.ts"),
  "utf8"
);
/** Comments describe the absence of a call; only CODE could make one. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("the seam cannot call Stripe, rather than being switched off", () => {
  it("contains no network call of any kind", () => {
    /* A disabled branch is a branch a test written six weeks from now will
       exercise. This asserts the branch does not exist: no fetch, no SDK, no
       URL, no key read. When the provider IS activated, exactly one function in
       this module changes — and this test is where that decision surfaces for
       review rather than slipping in beside something else. */
    for (const forbidden of [
      /\bfetch\s*\(/,
      /\bhttps?:\/\//,
      /require\s*\(\s*['"]stripe/,
      /from\s+['"]stripe/,
      /STRIPE_SECRET|STRIPE_API_KEY|sk_live|sk_test/,
      /\bXMLHttpRequest\b/,
    ]) {
      expect(forbidden.test(CODE), `seam contains ${forbidden}`).toBe(false);
    }
  });

  it("needs BOTH production and an explicit flag to be considered active", () => {
    // Either alone is how a preview deployment carrying production env vars
    // bills an account by surprise.
    for (const env of [
      {},
      { VERCEL_ENV: "production" },
      { COURANR_STRIPE_IDENTITY_ACTIVATED: "true" },
      { VERCEL_ENV: "preview", COURANR_STRIPE_IDENTITY_ACTIVATED: "true" },
    ]) {
      process.env = { ...ENV, ...env } as never;
      expect(isStripeIdentityActivated(), JSON.stringify(env)).toBe(false);
    }
    process.env = {
      ...ENV,
      VERCEL_ENV: "production",
      COURANR_STRIPE_IDENTITY_ACTIVATED: "true",
    } as never;
    expect(isStripeIdentityActivated()).toBe(true);
  });

  it("records 'unavailable' — a fact, not an absence", async () => {
    /* `unavailable` is in couranr_riv_state_chk's vocabulary and the drop-off
       trigger accepts exactly it and 'verified'. A protected handoff that
       proceeded on the recipient code is a DIFFERENT fact from one that passed
       an identity check, and a claim months later has to tell them apart. */
    const out = await resolveRecipientIdentity("11111111-1111-4111-8111-111111111111");
    expect(out.state).toBe("unavailable");
    expect(out.providerReference).toBeNull();
    expect(out.identityVerified).toBe(false);
    expect(out.adultVerified).toBe(false);
    expect(out.authorizedRecipientMatch).toBe(false);
    expect(out.policyVersion).toBe(COURANR_IDENTITY_POLICY_VERSION);
  });

  it("the ACTIVATION FLAG ALONE cannot make a shipment look verified", async () => {
    /* The dangerous shape: someone sets the flag in production expecting the
       integration to exist, and every protected handoff starts reporting
       'verified' against a provider that was never called. */
    process.env = {
      ...ENV,
      VERCEL_ENV: "production",
      COURANR_STRIPE_IDENTITY_ACTIVATED: "true",
    } as never;
    expect(isStripeIdentityActivated()).toBe(true);

    const out = await resolveRecipientIdentity("11111111-1111-4111-8111-111111111111");
    expect(out.state).toBe("unavailable");
    expect(out.identityVerified).toBe(false);
  });
});

describe("what the recipient is told", () => {
  it("does not apologise for a check that was never attempted", () => {
    /* Nothing was attempted and nothing went wrong, so `unavailable` must not
       read as a failure. A recipient reading it is deciding whether to answer
       the door, not auditing Couranr's provider integrations. */
    const copy = IDENTITY_OUTCOME_COPY.unavailable;
    expect(copy).not.toMatch(/fail|error|sorry|unable|problem|could not/i);
    // And it says what actually governs the handoff instead.
    expect(copy).toMatch(/code/i);
    expect(copy).toMatch(/in person|recipient/i);
  });

  it("covers every state the database allows, so no outcome renders blank", () => {
    for (const state of ["pending", "processing", "verified", "failed", "unavailable", "canceled"]) {
      const copy = (IDENTITY_OUTCOME_COPY as Record<string, string>)[state];
      expect(copy, `${state} has no copy`).toBeTruthy();
      expect(copy.trim().length, `${state} copy is too short to mean anything`).toBeGreaterThan(12);
    }
  });
});
