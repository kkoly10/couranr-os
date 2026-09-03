/**
 * §3/§4/§5 — provider-payload sanitization, the control-tag boundary and
 * source-evidence verification.
 *
 * The unit half exercises `sanitizeDescriptionForProvider` and
 * `verifySourceEvidence` as pure functions. The orchestration half drives
 * `runInterpretation` with the database mocked and a captured test provider,
 * proving the provider is shown the SANITIZED text and that invented
 * evidence is nulled while the proposal survives. The complementary halves —
 * the RAW description surviving verbatim in the database, and the durable
 * proposal record — live in the disposable DB suites, not here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    session: { id: "sess-1", business_account_id: "biz-1", current_revision: 1 },
    facts: [
      {
        fact_key: "fragile",
        value: true,
        confidence: null,
        source: "merchant_stated",
        source_evidence: null,
        requires_confirmation: false,
        authority: "confirmed",
      },
    ],
    revisions: [] as Array<Record<string, unknown>>,
  };
  return state;
});

vi.mock("@/lib/supabaseAdmin", () => {
  const rows = (table: string): { data: unknown; error: null } => {
    if (table === "couranr_intake_facts") return { data: db.facts, error: null };
    if (table === "couranr_intake_description_revisions") {
      return { data: db.revisions, error: null };
    }
    return { data: [], error: null };
  };
  const single = (table: string): { data: unknown; error: null } => {
    if (table === "couranr_intake_sessions") return { data: db.session, error: null };
    // couranr_merchant_workspaces: no workspace row -> null category.
    return { data: null, error: null };
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => Promise.resolve(rows(table));
    b.maybeSingle = () => Promise.resolve(single(table));
    return b;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, args });
        if (fn === "couranr_begin_intake_run") {
          return { data: { run: { id: "run-1", status: "pending" }, claimed: true }, error: null };
        }
        if (fn === "couranr_complete_intake_run") {
          return {
            data: { id: "run-1", status: args.p_status, proposals: args.p_proposals },
            error: null,
          };
        }
        if (fn === "couranr_record_intake_policy") {
          return { data: { id: "sess-1" }, error: null };
        }
        return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
      },
    },
  };
});

import {
  PROVIDER_CONTROL_TAGS,
  neutralizeControlTags,
  sanitizeDescriptionForProvider,
} from "@/lib/couranr/intake/sanitize";
import {
  isValidationFailure,
  validateProviderOutput,
  verifySourceEvidence,
} from "@/lib/couranr/intake/interpret";
import { runInterpretation } from "@/lib/couranr/intake/commands";
import { registerSmartIntakeTestProvider } from "@/lib/couranr/intake/testSeam";
import type {
  IntakeProviderRequest,
  SmartIntakeProvider,
} from "@/lib/couranr/intake/provider";

const sanitize = (text: string) => sanitizeDescriptionForProvider(text);

describe("§3 sanitizeDescriptionForProvider", () => {
  it("redacts an email address", () => {
    const r = sanitize("please contact jane@example.com about this parcel");
    expect(r.sanitized).toBe("please contact [redacted-email] about this parcel");
    expect(r.redactions).toEqual({ emails: 1, phones: 0, cardLike: 0 });
  });

  it("redacts every common phone format", () => {
    for (const phone of [
      "+1 (555) 123-4567",
      "(555) 123-4567",
      "555-123-4567",
      "555.123.4567",
      "555 123 4567",
      "5551234567",
      "1-555-123-4567",
      "+15551234567",
    ]) {
      const r = sanitize(`call ${phone} on arrival`);
      expect(r.sanitized, phone).toBe("call [redacted-phone] on arrival");
      expect(r.redactions.phones, phone).toBe(1);
    }
  });

  it("redacts card-like sequences of 13-19 digits, Luhn not required", () => {
    for (const card of [
      "4111 1111 1111 1111",
      "4111-1111-1111-1111",
      "4111111111111111",
      "4111111111111", // 13 digits
      "1234 5678 9012 3456 789", // 19-digit lookalike, fails Luhn on purpose
    ]) {
      const r = sanitize(`card ${card} on file`);
      expect(r.sanitized, card).toBe("card [redacted-number] on file");
      expect(r.redactions.cardLike, card).toBe(1);
    }
  });

  it("shipment vocabulary survives byte-identical", () => {
    for (const text of [
      "20 lb",
      "12 boxes of wine glasses",
      "9mm",
      "5.56",
      "a 60 by 40 inch mirror",
      "zip 22554",
      "about 20 lb total, keep upright",
    ]) {
      const r = sanitize(text);
      expect(r.sanitized, text).toBe(text);
      expect(r.redactions, text).toEqual({ emails: 0, phones: 0, cardLike: 0 });
    }
  });

  it("tracking-number-adjacent digit runs survive: 12 digits and 20 digits are neither card nor phone", () => {
    for (const tracking of ["961102098765", "12345678901234567890"]) {
      const r = sanitize(`tracking ${tracking} attached`);
      expect(r.sanitized, tracking).toBe(`tracking ${tracking} attached`);
      expect(r.redactions, tracking).toEqual({ emails: 0, phones: 0, cardLike: 0 });
    }
  });

  it("order matters: a card next to a phone redacts as card + phone, never half-eaten", () => {
    const r = sanitize("pay 4111 1111 1111 1111 then call 555-123-4567");
    expect(r.sanitized).toBe("pay [redacted-number] then call [redacted-phone]");
    expect(r.redactions).toEqual({ emails: 0, phones: 1, cardLike: 1 });
  });

  it("is idempotent — sanitize(sanitize(x).sanitized) is a fixed point, even for merged digit runs", () => {
    const inputs = [
      "call 555-123-4567, jane@example.com, card 4111 1111 1111 1111",
      // Adversarial: the phone and card digits merge into one 26-digit run,
      // which only the fixed-point loop fully cleans.
      "4111 1111 1111 1111 555-123-4567",
      "plain shipment text, 12 boxes, 20 lb",
      "",
    ];
    for (const input of inputs) {
      const once = sanitize(input).sanitized;
      const twice = sanitize(once);
      expect(twice.sanitized, input).toBe(once);
      expect(twice.redactions, input).toEqual({ emails: 0, phones: 0, cardLike: 0 });
    }
  });

  it("counts every redaction exactly once", () => {
    const r = sanitize(
      "call 555-123-4567 or 555 987 6543, mail jane@example.com and joe@example.org, card 4111 1111 1111 1111"
    );
    expect(r.redactions).toEqual({ emails: 2, phones: 2, cardLike: 1 });
    expect(r.sanitized).not.toMatch(/\d{4}/);
  });
});

describe("§4 neutralizeControlTags", () => {
  it("covers all three control tags in every look-alike form", () => {
    for (const tag of PROVIDER_CONTROL_TAGS) {
      for (const form of [`<${tag}>`, `</${tag}>`, `<${tag}/>`, `</ ${tag} >`, `<${tag.toUpperCase()} a=b>`]) {
        expect(neutralizeControlTags(`x ${form} y`), form).toBe("x [tag removed] y");
      }
    }
  });

  it("leaves ordinary angle brackets and unrelated tags alone", () => {
    expect(neutralizeControlTags("weight < 20 lb and <b>bold</b>")).toBe(
      "weight < 20 lb and <b>bold</b>"
    );
  });
});

describe("§5 verifySourceEvidence", () => {
  const validated = (evidence: string | null) => {
    const v = validateProviderOutput(
      JSON.stringify({
        facts: [{ key: "weight_lb_exact", value: 20, confidence: 80, sourceEvidence: evidence }],
        overallConfidence: 80,
      })
    );
    if (isValidationFailure(v)) throw new Error("fixture must validate");
    return v;
  };

  it("keeps evidence that occurs verbatim, nulls evidence that does not, and keeps the proposal either way", () => {
    const text = "about 20 lb total";
    const kept = verifySourceEvidence(validated("about 20 lb"), text);
    const dropped = verifySourceEvidence(validated("the merchant swears it is safe"), text);
    if (isValidationFailure(kept) || isValidationFailure(dropped)) throw new Error("unreachable");
    expect(kept.proposals[0].sourceEvidence).toBe("about 20 lb");
    expect(dropped.proposals[0].sourceEvidence).toBeNull();
    expect(dropped.proposals[0].key).toBe("weight_lb_exact");
    expect(dropped.proposals[0].value).toBe(20);
  });

  it("is case-sensitive — EXACT span means exact", () => {
    const v = verifySourceEvidence(validated("About 20 LB"), "about 20 lb total");
    if (isValidationFailure(v)) throw new Error("unreachable");
    expect(v.proposals[0].sourceEvidence).toBeNull();
  });

  it("null evidence stays null, failures pass through, and the input is not mutated", () => {
    const nullEv = validated(null);
    const before = JSON.stringify(nullEv);
    const out = verifySourceEvidence(nullEv, "anything");
    if (isValidationFailure(out)) throw new Error("unreachable");
    expect(out.proposals[0].sourceEvidence).toBeNull();
    const invented = validated("not in the text");
    const inventedBefore = JSON.stringify(invented);
    verifySourceEvidence(invented, "some other text");
    expect(JSON.stringify(invented)).toBe(inventedBefore); // no mutation
    expect(JSON.stringify(nullEv)).toBe(before);
    const failure = validateProviderOutput("{ nope");
    expect(verifySourceEvidence(failure, "text")).toBe(failure);
  });
});

describe("runInterpretation shows every provider the SANITIZED text and verifies evidence", () => {
  const RAW =
    "12 boxed flower arrangements, about 20 lb total, call 555-123-4567 or email jane@example.com";
  const SANITIZED =
    "12 boxed flower arrangements, about 20 lb total, call [redacted-phone] or email [redacted-email]";

  afterEach(() => {
    registerSmartIntakeTestProvider(null);
    db.rpcCalls.length = 0;
  });

  it("the provider receives the sanitized description; invented evidence is nulled while the proposal survives", async () => {
    db.revisions.length = 0;
    db.revisions.push({
      revision: 1,
      raw_description: RAW,
      source: "merchant_statement",
      created_at: "2026-09-03T00:00:00Z",
    });

    const seen: IntakeProviderRequest[] = [];
    const provider: SmartIntakeProvider = {
      name: "fake",
      requestedModel: "fake-deterministic-v0",
      async interpret(request) {
        seen.push(request);
        return {
          outcome: "success",
          model: "fake-deterministic-v0",
          usage: null,
          rawJson: JSON.stringify({
            facts: [
              // Genuine verbatim span of the sanitized text: evidence KEPT.
              { key: "weight_lb_exact", value: 20, confidence: 80, sourceEvidence: "about 20 lb" },
              // Invented: evidence NULLED, proposal kept.
              {
                key: "fragile",
                value: true,
                confidence: 70,
                sourceEvidence: "the merchant swears it is safe",
              },
              // Quotes the RAW phone the provider never saw: evidence NULLED.
              { key: "package_count", value: 12, confidence: 90, sourceEvidence: "555-123-4567" },
            ],
            overallConfidence: 80,
          }),
        };
      },
    };
    registerSmartIntakeTestProvider(provider);

    const result = await runInterpretation({
      sessionId: "sess-1",
      businessAccountId: "biz-1",
      sourceRevision: 1,
    });
    expect(result.ok).toBe(true);

    // The provider was called exactly once, with the SANITIZED words only.
    expect(seen).toHaveLength(1);
    expect(seen[0].shipmentDescription).toBe(SANITIZED);
    expect(seen[0].shipmentDescription).not.toContain("555-123-4567");
    expect(seen[0].shipmentDescription).not.toContain("jane@example.com");
    // Confirmed non-PII facts still travel.
    expect(seen[0].confirmedFacts).toEqual({ fragile: true });

    // What the run persisted: evidence verified against the provider-visible
    // text, proposals intact.
    const complete = db.rpcCalls.find((c) => c.fn === "couranr_complete_intake_run");
    expect(complete).toBeDefined();
    expect(complete!.args.p_status).toBe("success");
    const persisted = complete!.args.p_proposals as Array<Record<string, unknown>>;
    const byKey = Object.fromEntries(persisted.map((p) => [String(p.key), p]));
    expect(Object.keys(byKey).sort()).toEqual(["fragile", "package_count", "weight_lb_exact"]);
    expect(byKey.weight_lb_exact.sourceEvidence).toBe("about 20 lb");
    expect(byKey.fragile.sourceEvidence).toBeNull();
    expect(byKey.fragile.value).toBe(true);
    expect(byKey.package_count.sourceEvidence).toBeNull();
    expect(byKey.package_count.value).toBe(12);
  });

  it("a description with no redactable patterns reaches the provider byte-identical", async () => {
    db.revisions.length = 0;
    db.revisions.push({
      revision: 1,
      raw_description: "an oversized fragile mirror, 60 by 40 inches",
      source: "merchant_statement",
      created_at: "2026-09-03T00:00:00Z",
    });
    const seen: IntakeProviderRequest[] = [];
    registerSmartIntakeTestProvider({
      name: "fake",
      requestedModel: "fake-deterministic-v0",
      async interpret(request) {
        seen.push(request);
        return {
          outcome: "success",
          model: "fake-deterministic-v0",
          usage: null,
          rawJson: JSON.stringify({ facts: [], overallConfidence: 0 }),
        };
      },
    });
    const result = await runInterpretation({
      sessionId: "sess-1",
      businessAccountId: "biz-1",
      sourceRevision: 1,
    });
    expect(result.ok).toBe(true);
    expect(seen[0].shipmentDescription).toBe("an oversized fragile mirror, 60 by 40 inches");
  });
});
