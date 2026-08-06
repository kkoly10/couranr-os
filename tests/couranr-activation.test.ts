import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGEMENT_KINDS,
  ACKNOWLEDGEMENT_VERSIONS,
  ACTIVATION_STATES,
  ACTIVATION_STATE_DESCRIPTIONS,
  activationRequirements,
  blockReasonMessage,
  canRequestActivation,
  derivedProgressState,
  type ActivationFacts,
} from "@/lib/couranr/activation/states";

const ROOT = path.resolve(__dirname, "..");

/**
 * MER-003 — the activation gate.
 *
 * The rule this file protects: a merchant can reach `pending_couranr_review`
 * and no further, and they can only get there having met every requirement at
 * its CURRENT version.
 */

const NONE: ActivationFacts = {
  state: "not_started",
  acknowledgements: {},
  contactVerifiedAt: null,
  testDeliveryRequestId: null,
};

const ALL: ActivationFacts = {
  state: "in_progress",
  acknowledgements: { ...ACKNOWLEDGEMENT_VERSIONS },
  contactVerifiedAt: "2026-08-06T00:00:00Z",
  testDeliveryRequestId: "11111111-1111-4111-8111-111111111111",
};

describe("the registry's states are the machine", () => {
  it("declares exactly the five required states", () => {
    expect([...ACTIVATION_STATES]).toEqual([
      "not_started",
      "in_progress",
      "pending_couranr_review",
      "live",
      "blocked",
    ]);
  });

  it("every state tells the merchant whether deliveries are live", () => {
    // This screen exists to answer one question. Each description must answer
    // it rather than describing an internal process.
    for (const s of ACTIVATION_STATES) {
      expect(ACTIVATION_STATE_DESCRIPTIONS[s], s).toBeTruthy();
      expect(
        /test workspace|dispatched|live/i.test(ACTIVATION_STATE_DESCRIPTIONS[s]),
        `${s} does not say whether deliveries are live`
      ).toBe(true);
    }
  });
});

describe("requirements", () => {
  it("nothing done: every requirement unmet, six of them", () => {
    const rs = activationRequirements(NONE);
    expect(rs).toHaveLength(ACKNOWLEDGEMENT_KINDS.length + 2);
    expect(rs.every((r) => !r.met)).toBe(true);
  });

  it("everything done: every requirement met", () => {
    expect(activationRequirements(ALL).every((r) => r.met)).toBe(true);
  });

  it("an acknowledgement at an OLD version does not count, and says why", () => {
    const stale: ActivationFacts = {
      ...ALL,
      acknowledgements: { ...ACKNOWLEDGEMENT_VERSIONS, delivery_terms: "couranr-delivery-terms-2025-01" },
    };
    const req = activationRequirements(stale).find((r) => r.id === "ack:delivery_terms")!;
    expect(req.met).toBe(false);
    expect(req.detail).toContain("updated since you accepted it");
    expect(canRequestActivation(stale)).toBe(false);
  });

  it("each single missing requirement blocks the request on its own", () => {
    const variants: [string, ActivationFacts][] = [
      ["no contact", { ...ALL, contactVerifiedAt: null }],
      ["no test delivery", { ...ALL, testDeliveryRequestId: null }],
      ...ACKNOWLEDGEMENT_KINDS.map(
        (k): [string, ActivationFacts] => {
          const acks: Record<string, string> = { ...ACKNOWLEDGEMENT_VERSIONS };
          delete acks[k];
          return [`missing ${k}`, { ...ALL, acknowledgements: acks }];
        }
      ),
    ];
    for (const [name, facts] of variants) {
      expect(canRequestActivation(facts), name).toBe(false);
    }
  });

  it("all six met: the request becomes available", () => {
    expect(canRequestActivation(ALL)).toBe(true);
  });
});

describe("a merchant can never self-grant activation", () => {
  it("derivedProgressState returns ONLY not_started or in_progress", () => {
    // If this could ever return `live`, a filled checklist would activate a
    // workspace with no Couranr review at all.
    expect(derivedProgressState(NONE)).toBe("not_started");
    expect(derivedProgressState(ALL)).toBe("in_progress");
    const partial: ActivationFacts = { ...NONE, contactVerifiedAt: "2026-08-06T00:00:00Z" };
    expect(derivedProgressState(partial)).toBe("in_progress");
    for (const facts of [NONE, ALL, partial]) {
      expect(["not_started", "in_progress"]).toContain(derivedProgressState(facts));
    }
  });

  it("requesting again while already pending or live is refused", () => {
    expect(canRequestActivation({ ...ALL, state: "pending_couranr_review" })).toBe(false);
    expect(canRequestActivation({ ...ALL, state: "live" })).toBe(false);
  });

  it("a BLOCKED workspace that has fixed everything may request again", () => {
    // Blocked is not terminal: the whole point of a reason is that it can be
    // resolved.
    expect(canRequestActivation({ ...ALL, state: "blocked" })).toBe(true);
  });
});

describe("block reasons are merchant-safe copy derived from a code", () => {
  it("a known code maps to its message", () => {
    expect(blockReasonMessage("contact_unreachable")).toContain("could not reach");
  });

  it("an unknown or missing code falls back rather than leaking the code", () => {
    for (const code of [null, undefined, "", "some_internal_note_key"]) {
      const msg = blockReasonMessage(code as any);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("some_internal_note_key");
    }
  });
});

describe("activation asks for nothing the specification forbids", () => {
  /**
   * The specification is explicit: activation must NOT require a website, an
   * EIN, a storefront, a business-registration upload, or any subscription
   * purchase. This asserts the requirement list never mentions one — a
   * requirement added later that asks for a website fails here.
   */
  it("no requirement mentions a website, EIN, registration or subscription", () => {
    const text = activationRequirements(NONE)
      .map((r) => `${r.label} ${r.detail}`)
      .join(" ")
      .toLowerCase();
    for (const forbidden of ["website", "ein", "storefront", "registration", "subscription", "credit card"]) {
      expect(text, `activation asks for a ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the module records why those are excluded", () => {
    // Whitespace is collapsed before matching, the same lesson
    // `couranr-public-claims` learned: a sentence wrapped across source lines
    // is the sentence it reads as, and a test that misses it is testing the
    // line width rather than the claim.
    // Comment CONTINUATION markers are stripped before whitespace is
    // collapsed. Without that, a sentence wrapped inside a block comment reads
    // as "never * self-granted" and a literal match misses a claim that is
    // plainly present — testing the line width, not the claim.
    const src = readFileSync(path.join(ROOT, "lib/couranr/activation/states.ts"), "utf8")
      .replace(/^\s*\*\s?/gm, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(src).toContain("what is deliberately not required");
    expect(src).toContain("never self-granted");
  });
});
