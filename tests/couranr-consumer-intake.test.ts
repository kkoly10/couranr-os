import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * INT-002 Consumer Smart Intake — the server composition, executed against
 * an in-memory stand-in for the database commands and the REAL pipeline
 * around it (sanitizer, provider seam, output validation, policy engine).
 *
 * What the disposable suite proves in SQL (scope refusals, budgets, the race)
 * is not repeated here. These tests own what the TS layer must do:
 *   - the kill switch is absolute: off means zero commands and zero provider calls;
 *   - the body is `{ description }` and nothing else;
 *   - every command goes out under the GUEST scope (business null, guest set);
 *   - the provider sees sanitized text and NO business category;
 *   - identical words converge (one paid call), a rate limit and provider
 *     trouble degrade without a throw;
 *   - the view exposes proposed, allow-listed facts and the one question —
 *     never model prose;
 *   - the post-estimate evidence hook links, confirms with NO actor, and can
 *     never fail the estimate.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn<any>(),
  db: {
    session: null as any,
    facts: [] as any[],
    revisions: [] as any[],
    /** what `findConsumerIntakeSession` sees */
    consumerSession: null as any,
    lastSessionFilters: [] as Array<[string, unknown]>,
  },
  provider: { interpret: vi.fn<any>() },
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const c: any = {};
    c.select = () => c;
    c.eq = (col: string, v: unknown) => {
      filters.push([col, v]);
      return c;
    };
    c.order = () => c;
    c.maybeSingle = async () => {
      if (table === "couranr_intake_sessions") {
        const byGuest = filters.find(([col]) => col === "guest_session_id");
        const byBusiness = filters.find(([col]) => col === "business_account_id");
        h.db.lastSessionFilters = filters;
        if (byBusiness) return { data: null, error: null };
        if (filters.some(([col]) => col === "id")) return { data: h.db.session, error: null };
        if (byGuest) return { data: h.db.consumerSession, error: null };
      }
      return { data: null, error: null };
    };
    c.then = (resolve: any) => {
      if (table === "couranr_intake_facts") return resolve({ data: h.db.facts, error: null });
      if (table === "couranr_intake_description_revisions") return resolve({ data: h.db.revisions, error: null });
      return resolve({ data: [], error: null });
    };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

import { registerSmartIntakeTestProvider } from "@/lib/couranr/intake/testSeam";
import {
  CONSUMER_DESCRIPTION_MAX_CHARS,
  interpretConsumerDescription,
  parseConsumerIntakeBody,
  recordConsumerIntakeEvidenceAfterEstimate,
  viewFromIntakeSession,
} from "@/lib/couranr/consumer/intake";

const ROOT = path.resolve(__dirname, "..");
const GUEST = { id: "9e550000-0000-4000-8000-0000000000aa", requestId: null as string | null, expiresAt: "2099-01-01T00:00:00.000Z" };
const SESSION_ID = "1e000000-0000-4000-8000-0000000000ee";
const LIVE = { COURANR_CONSUMER_INTAKE: "live" };

function providerJson(facts: unknown[]) {
  return JSON.stringify({ facts, overallConfidence: 80 });
}

function calls(fn: string) {
  return h.rpc.mock.calls.filter((c: any[]) => c[0] === fn);
}

/** A minimal, faithful stand-in for the SQL commands' contracts. */
function installRpc(opts: { rateLimited?: boolean; sameWordsAgain?: boolean } = {}) {
  let revision = 0;
  let lastDescription: string | null = null;
  let runSeq = 0;
  const runs = new Map<string, any>();
  h.rpc.mockImplementation(async (fn: string, args: any) => {
    switch (fn) {
      case "couranr_upsert_consumer_intake_description": {
        const same = lastDescription !== null && lastDescription.trim() === String(args.p_description).trim();
        if (!same) {
          revision += 1;
          lastDescription = String(args.p_description);
          h.db.revisions.push({ revision, raw_description: lastDescription, source: "consumer_statement" });
        }
        h.db.session = {
          id: SESSION_ID,
          guest_session_id: args.p_guest_session_id,
          business_account_id: null,
          current_revision: revision,
          interpretation_status: h.db.session?.interpretation_status ?? "none",
          current_clarification: h.db.session?.current_clarification ?? null,
        };
        return { data: { session: h.db.session, revisionAdded: !same }, error: null };
      }
      case "couranr_begin_intake_run": {
        const key = String(args.p_idempotency_key);
        if (runs.has(key)) return { data: { run: runs.get(key), claimed: false }, error: null };
        if (opts.rateLimited) {
          const run = { id: `run-rl-${++runSeq}`, status: "rate_limited" };
          h.db.session.interpretation_status = "rate_limited";
          return { data: { run, claimed: false, rateLimited: true, sessionCallsLastHour: 12, consumerCallsLastHour: 12 }, error: null };
        }
        const run = { id: `run-${++runSeq}`, status: "pending", source_revision: args.p_source_revision };
        runs.set(key, run);
        return { data: { run, claimed: true }, error: null };
      }
      case "couranr_complete_intake_run": {
        const status = String(args.p_status);
        if (status === "success") {
          for (const p of args.p_proposals ?? []) {
            h.db.facts = h.db.facts.filter((f) => f.fact_key !== p.key);
            h.db.facts.push({
              fact_key: p.key, value: p.value, confidence: p.confidence,
              source: "ai_inference", authority: "proposed",
              requires_confirmation: p.requiresConfirmation, actor_user_id: null,
            });
          }
          h.db.session.interpretation_status = "interpreted";
          h.db.session.current_run_id = args.p_run_id;
        } else {
          h.db.session.interpretation_status = status === "unavailable" ? "provider_unavailable" : "manual";
        }
        return { data: { id: args.p_run_id, status }, error: null };
      }
      case "couranr_record_intake_policy": {
        h.db.session.current_clarification = args.p_clarification;
        h.db.session.policy_disposition = args.p_policy_disposition;
        return { data: h.db.session, error: null };
      }
      case "couranr_link_intake_session":
        return { data: { ...h.db.consumerSession, request_id: args.p_request_id }, error: null };
      case "couranr_confirm_intake_fact":
        h.db.facts = h.db.facts.filter((f) => f.fact_key !== args.p_fact_key);
        h.db.facts.push({ fact_key: args.p_fact_key, value: args.p_value, authority: args.p_authority, source: "consumer_statement", actor_user_id: null });
        return { data: { fact_key: args.p_fact_key }, error: null };
      case "couranr_retract_intake_fact":
        return { data: { fact_key: args.p_fact_key, authority: "unknown" }, error: null };
      default:
        return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
    }
  });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.provider.interpret.mockReset();
  h.db.session = null;
  h.db.facts = [];
  h.db.revisions = [];
  h.db.consumerSession = null;
  registerSmartIntakeTestProvider({
    name: "fake",
    requestedModel: "fake-model",
    interpret: h.provider.interpret,
  });
  h.provider.interpret.mockResolvedValue({
    outcome: "success",
    rawJson: providerJson([
      { key: "item_category", value: "home_goods", confidence: 90, sourceEvidence: "a lamp" },
      { key: "weight_band", value: "0_25_lb", confidence: 70, sourceEvidence: "a lamp" },
      { key: "restricted_class", value: "alcohol", confidence: 95, sourceEvidence: "12 bottles of beer" },
      // Not a consumer proposal key: must never reach the browser view.
      { key: "payer_type", value: "merchant", confidence: 99, sourceEvidence: "a lamp" },
    ]),
    model: "fake-model",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  installRpc();
});
afterEach(() => registerSmartIntakeTestProvider(null));

describe("the kill switch and the body", () => {
  it("off ⇒ unavailable with ZERO commands and ZERO provider calls", async () => {
    const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: {} });
    expect(r.ok && r.value.status).toBe("unavailable");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.provider.interpret).not.toHaveBeenCalled();
  });

  it("any value but exactly 'live' is off", async () => {
    for (const v of ["", "on", "true", "LIVE", " live "]) {
      h.rpc.mockClear();
      const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: { COURANR_CONSUMER_INTAKE: v } });
      // " live " trims to live and IS on; everything else is off.
      if (v.trim() === "live") expect(h.rpc).toHaveBeenCalled();
      else {
        expect(r.ok && r.value.status, v).toBe("unavailable");
        expect(h.rpc, v).not.toHaveBeenCalled();
      }
    }
  });

  it("the body is { description } and nothing else", () => {
    expect(parseConsumerIntakeBody({ description: "a lamp" })).toEqual({ ok: true, description: "a lamp" });
    expect(parseConsumerIntakeBody({ description: "a lamp", totalCents: 1 })).toEqual({ ok: false, reason: "unexpected_key:totalCents" });
    expect(parseConsumerIntakeBody({ description: "a lamp", businessAccountId: "x" }).ok).toBe(false);
    expect(parseConsumerIntakeBody({ description: "   " }).ok).toBe(false);
    expect(parseConsumerIntakeBody({ description: "x".repeat(CONSUMER_DESCRIPTION_MAX_CHARS + 1) })).toEqual({ ok: false, reason: "description_too_long" });
    expect(parseConsumerIntakeBody("a lamp").ok).toBe(false);
    expect(parseConsumerIntakeBody(["a lamp"]).ok).toBe(false);
    expect(parseConsumerIntakeBody(null).ok).toBe(false);
  });

  it("a bad body is refused before any command runs", async () => {
    const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp", state: "confirmed" }, env: LIVE });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("invalid_input");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.provider.interpret).not.toHaveBeenCalled();
  });
});

describe("one pipeline under the guest scope", () => {
  it("upsert → begin → provider → complete → policy, every command under the GUEST scope, business null", async () => {
    const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp and 12 bottles of beer, call 571-555-0100" }, env: LIVE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(h.rpc.mock.calls.map((c: any[]) => c[0])).toEqual([
      "couranr_upsert_consumer_intake_description",
      "couranr_begin_intake_run",
      "couranr_complete_intake_run",
      "couranr_record_intake_policy",
    ]);
    expect(calls("couranr_upsert_consumer_intake_description")[0][1]).toMatchObject({
      p_guest_session_id: GUEST.id,
      p_description: "a lamp and 12 bottles of beer, call 571-555-0100",
    });
    for (const fn of ["couranr_begin_intake_run", "couranr_complete_intake_run", "couranr_record_intake_policy"]) {
      const args = calls(fn)[0][1];
      expect(args.p_business_account_id, fn).toBeNull();
      expect(args.p_guest_session_id, fn).toBe(GUEST.id);
    }
    expect(calls("couranr_begin_intake_run")[0][1].p_source_revision).toBe(1);

    // The provider saw sanitized text (the phone number redacted) and NO business category.
    expect(h.provider.interpret).toHaveBeenCalledTimes(1);
    const req = h.provider.interpret.mock.calls[0][0];
    expect(req.businessCategory).toBeNull();
    expect(req.shipmentDescription).not.toContain("571-555-0100");
    expect(req.shipmentDescription).toContain("a lamp");

    // The view: proposed, allow-listed facts only; never the payer key; the one question.
    expect(r.value.status).toBe("interpreted");
    expect(r.value.revision).toBe(1);
    expect(r.value.proposals.map((p) => p.key).sort()).toEqual(["item_category", "restricted_class", "weight_band"]);
    expect(r.value.proposals.find((p) => p.key === "restricted_class")).toMatchObject({ value: "alcohol", confidence: 95, requiresConfirmation: true });
    // Every fact persisted under the guest carries no actor.
    expect(h.db.facts.every((f) => f.actor_user_id === null)).toBe(true);
  });

  it("the SAME words twice spend exactly one provider call", async () => {
    await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: LIVE });
    const second = await interpretConsumerDescription({ session: GUEST, body: { description: "  a lamp  " }, env: LIVE });
    expect(second.ok && second.value.status).toBe("interpreted");
    expect(h.provider.interpret).toHaveBeenCalledTimes(1);
    expect(calls("couranr_complete_intake_run")).toHaveLength(1);
    // The second pass converged: begin was asked, and answered claimed=false.
    expect(calls("couranr_begin_intake_run")).toHaveLength(2);
  });

  it("changed words are a new revision and a second paid call", async () => {
    await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: LIVE });
    await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp and a rug" }, env: LIVE });
    expect(h.provider.interpret).toHaveBeenCalledTimes(2);
    expect(calls("couranr_begin_intake_run")[1][1].p_source_revision).toBe(2);
  });

  it("a rate-limited begin makes NO provider call and reads as rate_limited", async () => {
    installRpc({ rateLimited: true });
    const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: LIVE });
    expect(r.ok && r.value.status).toBe("rate_limited");
    expect(h.provider.interpret).not.toHaveBeenCalled();
    expect(calls("couranr_complete_intake_run")).toHaveLength(0);
  });

  it("provider trouble degrades to manual without a throw and without proposals", async () => {
    h.provider.interpret.mockResolvedValue({ outcome: "timeout" });
    const r = await interpretConsumerDescription({ session: GUEST, body: { description: "a lamp" }, env: LIVE });
    expect(r.ok && r.value.status).toBe("manual");
    expect(r.ok && r.value.proposals).toEqual([]);
    expect(calls("couranr_complete_intake_run")[0][1].p_status).toBe("timeout");
  });

  it("model prose never reaches the view — only allow-listed keys with authority proposed", () => {
    const view = viewFromIntakeSession(
      { interpretation_status: "interpreted", current_revision: 3, current_clarification: { factKey: "weight_band", question: "How heavy is it?" } },
      [
        { fact_key: "weight_band", value: "0_25_lb", confidence: 60, authority: "proposed", requires_confirmation: true },
        { fact_key: "weight_band", value: "over_25_to_50_lb", authority: "confirmed" }, // confirmed: not a proposal
        { fact_key: "payer_type", value: "merchant", authority: "proposed" }, // not a consumer key
        { fact_key: "service_level", value: "priority", authority: "proposed" }, // not a consumer key
        { fact_key: "fragile", value: true, confidence: 88, authority: "proposed", requires_confirmation: false },
      ]
    );
    expect(view).toEqual({
      status: "interpreted",
      revision: 3,
      proposals: [
        { key: "weight_band", value: "0_25_lb", confidence: 60, requiresConfirmation: true },
        { key: "fragile", value: true, confidence: 88, requiresConfirmation: false },
      ],
      clarification: { question: "How heavy is it?" },
    });
    expect(JSON.stringify(view)).not.toContain("merchant");
  });
});

describe("the confirmation trail after an estimate", () => {
  const statement = { weightLb: 12, weightBand: null, restrictedClass: "none" as const };

  it("switch off ⇒ nothing is read or written", async () => {
    await recordConsumerIntakeEvidenceAfterEstimate({ session: GUEST, requestId: "req-1", statement, env: {} });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("no intake session ⇒ nothing is written", async () => {
    await recordConsumerIntakeEvidenceAfterEstimate({ session: GUEST, requestId: "req-1", statement, env: LIVE });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("links the guest's request and confirms the form facts with NO actor under the guest scope", async () => {
    h.db.consumerSession = { id: SESSION_ID, current_revision: 1, request_id: null };
    h.db.session = { id: SESSION_ID, guest_session_id: GUEST.id, business_account_id: null, current_revision: 1, interpretation_status: "interpreted" };
    h.db.facts = [{ fact_key: "weight_band", value: "0_25_lb", authority: "proposed" }];
    await recordConsumerIntakeEvidenceAfterEstimate({ session: GUEST, requestId: "req-1", statement, env: LIVE });

    const link = calls("couranr_link_intake_session")[0][1];
    expect(link).toMatchObject({ p_session_id: SESSION_ID, p_request_id: "req-1", p_business_account_id: null, p_guest_session_id: GUEST.id });
    const confirms = calls("couranr_confirm_intake_fact").map((c: any[]) => c[1]);
    expect(confirms.length).toBeGreaterThan(0);
    for (const c of confirms) {
      expect(c.p_actor_user_id).toBeNull();
      expect(c.p_business_account_id).toBeNull();
      expect(c.p_guest_session_id).toBe(GUEST.id);
      expect(["confirmed", "overridden"]).toContain(c.p_authority);
    }
    expect(confirms.map((c: any) => c.p_fact_key)).toContain("weight_lb_exact");
    expect(confirms.map((c: any) => c.p_fact_key)).toContain("restricted_class");
    // Policy is re-recorded over the actual fact state, guest-scoped, no run.
    const policy = calls("couranr_record_intake_policy")[0][1];
    expect(policy).toMatchObject({ p_business_account_id: null, p_guest_session_id: GUEST.id, p_run_id: null });
  });

  it("a thrown failure inside the hook is logged and swallowed — the estimate is never blocked", async () => {
    h.db.consumerSession = { id: SESSION_ID, current_revision: 1, request_id: null };
    h.rpc.mockImplementation(async () => {
      throw new Error("database exploded");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordConsumerIntakeEvidenceAfterEstimate({ session: GUEST, requestId: "req-1", statement, env: LIVE })
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).toContain("recordConsumerIntakeEvidenceAfterEstimate");
    err.mockRestore();
  });

  it("the estimate awaits the hook AFTER its command and BEFORE returning (source guard)", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/consumer/send.ts"), "utf8");
    const hookAt = src.indexOf("await recordConsumerIntakeEvidenceAfterEstimate(");
    const estimateReturn = src.indexOf("return { ok: true, value: await estimateFromRow(result.value) };", hookAt);
    expect(hookAt).toBeGreaterThan(0);
    expect(estimateReturn).toBeGreaterThan(hookAt);
    // And the consumer lib never reaches a provider adapter directly.
    const lib = readFileSync(path.join(ROOT, "lib/couranr/consumer/intake.ts"), "utf8");
    expect(lib).toMatch(/from "@\/lib\/couranr\/intake\/commands"/);
    expect(lib).not.toMatch(/anthropicProvider|@anthropic-ai/);
  });
});

describe("the numbers are pinned in ONE place — the registry", () => {
  it("SQL budgets, the input cap and the disclosure copy match INT-002 / MKT-005", () => {
    const registry = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
    const int002 = registry.decisions.find((d: any) => d.id === "INT-002");
    const mkt005 = registry.decisions.find((d: any) => d.id === "MKT-005");
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/20260903050000_couranr_consumer_smart_intake.sql"), "utf8");
    expect(sql).toContain(`c_session_budget constant integer := ${int002.value.abuse_controls.per_guest_session_paid_calls_per_hour};`);
    expect(sql).toContain(`c_consumer_budget constant integer := ${int002.value.abuse_controls.consumer_global_paid_calls_per_hour};`);
    expect(sql).toContain(`length(p_description) > ${int002.value.abuse_controls.description_max_chars}`);
    expect(CONSUMER_DESCRIPTION_MAX_CHARS).toBe(int002.value.abuse_controls.description_max_chars);
    const copy = readFileSync(path.join(ROOT, "lib/couranr/public/masterSameDayCopy.ts"), "utf8");
    expect(copy).toContain(JSON.stringify(mkt005.value.send.item_ai_disclosure));
    expect(int002.value.disclosure.copy_key).toBe("MKT-005.value.send.item_ai_disclosure");
  });
});
