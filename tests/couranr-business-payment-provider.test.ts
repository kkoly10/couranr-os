import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  customerCreate: vi.fn(),
  setupCreate: vi.fn(),
  setupRetrieve: vi.fn(),
  setupCancel: vi.fn(),
  methodRetrieve: vi.fn(),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("@/lib/stripeClient", () => ({ stripe: {
  customers: { create: mocks.customerCreate },
  setupIntents: { create: mocks.setupCreate, retrieve: mocks.setupRetrieve, cancel: mocks.setupCancel },
  paymentMethods: { retrieve: mocks.methodRetrieve },
} }));

import {
  completeBusinessPaymentSetup,
  getBusinessPaymentMethod,
  startBusinessPaymentSetup,
} from "@/lib/couranr/billing/paymentMethod";
import { BUSINESS_CARD_CONSENT, BUSINESS_CARD_CONSENT_VERSION } from "@/lib/couranr/billing/consent";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const input = { businessAccountId: BUSINESS, actorUserId: ACTOR };
const completion = { ...input, attemptId: ATTEMPT };
const profile = {
  business_account_id: BUSINESS,
  stripe_customer_id: "cus_TestBusiness",
  stripe_customer_livemode: false,
  customer_create_key: "44444444-4444-4444-8444-444444444444",
  created_at: new Date().toISOString(),
  current_generation: 1,
};
const attempt = {
  id: ATTEMPT, business_account_id: BUSINESS, generation: 1,
  actor_user_id: ACTOR,
  stripe_setup_intent_id: null, consent_version: BUSINESS_CARD_CONSENT_VERSION,
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
};
const setup = {
  id: "seti_TestBusiness", customer: "cus_TestBusiness", usage: "off_session",
  livemode: false,
  status: "requires_payment_method", client_secret: "seti_TestBusiness_secret_test",
  payment_method: null,
  metadata: {
    couranrBusinessAccountId: BUSINESS,
    couranrSetupAttemptId: ATTEMPT,
    consentVersion: BUSINESS_CARD_CONSENT_VERSION,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
    if (fn === "couranr_begin_business_payment_setup") return { data: attempt, error: null };
    if (fn === "couranr_rotate_business_payment_setup") return { data: { ...attempt, id: "55555555-5555-4555-8555-555555555555", generation: 2 }, error: null };
    if (fn === "couranr_attach_business_payment_setup") return { data: { ...attempt, stripe_setup_intent_id: setup.id }, error: null };
    if (fn === "couranr_complete_business_payment_setup") return { data: { card_brand: "visa", card_last4: "4242" }, error: null };
    return { data: null, error: { message: "unexpected RPC" } };
  });
  mocks.setupCreate.mockResolvedValue(setup);
  mocks.setupRetrieve.mockResolvedValue({ ...setup, status: "succeeded", payment_method: "pm_TestBusiness" });
  mocks.setupCancel.mockResolvedValue({ ...setup, status: "canceled" });
  mocks.methodRetrieve.mockResolvedValue({ id: "pm_TestBusiness", customer: "cus_TestBusiness", livemode: false,
    type: "card", card: { brand: "visa", last4: "4242" } });
  mocks.from.mockImplementation((table: string) => {
    const value = table === "couranr_business_payment_profiles"
      ? profile : { ...attempt, stripe_setup_intent_id: setup.id };
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: value, error: null }) };
    return chain;
  });
});

describe("RR-003a provider verification", () => {
  it("pins the exact displayed consent in the immutable migration", () => {
    const migration = readFileSync(resolve(process.cwd(),
      "supabase/migrations/20260930124500_couranr_business_payment_method_foundation.sql"), "utf8");
    expect(migration.split(BUSINESS_CARD_CONSENT)).toHaveLength(4);
  });

  it("creates a card-only off-session SetupIntent for the stored Customer and pins consent", async () => {
    const result = await startBusinessPaymentSetup(input);
    expect(result).toEqual({ ok: true, value: { clientSecret: setup.client_secret,
      attemptId: ATTEMPT, alreadyConfirmed: false } });
    expect(mocks.setupCreate).toHaveBeenCalledWith({
      customer: "cus_TestBusiness", usage: "off_session", payment_method_types: ["card"],
      metadata: { couranrBusinessAccountId: BUSINESS, couranrSetupAttemptId: ATTEMPT,
        consentVersion: BUSINESS_CARD_CONSENT_VERSION },
    }, { idempotencyKey: `couranr:business-setup:${ATTEMPT}` });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_begin_business_payment_setup", {
      p_business_account_id: BUSINESS, p_actor_user_id: ACTOR,
      p_consent_version: BUSINESS_CARD_CONSENT_VERSION, p_consent_text: BUSINESS_CARD_CONSENT,
    });
  });

  it("never saves a browser claim: only retrieved succeeded SetupIntent and customer-owned card", async () => {
    const result = await completeBusinessPaymentSetup(completion);
    expect(result).toEqual({ ok: true, value: { state: "ready", brand: "visa", last4: "4242" } });
    expect(mocks.methodRetrieve).toHaveBeenCalledWith("pm_TestBusiness");
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_business_payment_setup", {
      p_business_account_id: BUSINESS, p_actor_user_id: ACTOR,
      p_attempt_id: ATTEMPT, p_setup_intent_id: setup.id,
      p_payment_method_id: "pm_TestBusiness", p_card_brand: "visa", p_card_last4: "4242",
    });
  });

  it("rejects a SetupIntent for another Customer", async () => {
    mocks.setupRetrieve.mockResolvedValue({ ...setup, status: "succeeded", customer: "cus_Foreign", payment_method: "pm_TestBusiness" });
    const result = await completeBusinessPaymentSetup(completion);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a PaymentMethod attached to another Customer", async () => {
    mocks.methodRetrieve.mockResolvedValue({ id: "pm_TestBusiness", customer: "cus_Foreign", type: "card", card: { brand: "visa", last4: "4242" } });
    const result = await completeBusinessPaymentSetup(completion);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not treat processing or a missing method as saved", async () => {
    for (const bad of [
      { ...setup, status: "processing", payment_method: "pm_TestBusiness" },
      { ...setup, status: "succeeded", payment_method: null },
    ]) {
      mocks.setupRetrieve.mockResolvedValue(bad);
      const result = await completeBusinessPaymentSetup(completion);
      expect(result.ok).toBe(false);
      expect(mocks.methodRetrieve).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });

  it("unknown Customer creation beyond provider idempotency horizon hard-refuses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...profile, stripe_customer_id: null,
      created_at: new Date(Date.now() - 24 * 60 * 60_000).toISOString() }, error: null });
    const result = await startBusinessPaymentSetup(input);
    expect(result.ok).toBe(false);
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.setupCreate).not.toHaveBeenCalled();
  });

  it("rotates a provider-canceled intent instead of trapping the owner for an hour", async () => {
    const nextId = "55555555-5555-4555-8555-555555555555";
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
      if (fn === "couranr_begin_business_payment_setup") return {
        data: { ...attempt, stripe_setup_intent_id: setup.id }, error: null,
      };
      if (fn === "couranr_rotate_business_payment_setup") return {
        data: { ...attempt, id: nextId, generation: 2 }, error: null,
      };
      if (fn === "couranr_attach_business_payment_setup") return { data: {}, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    });
    mocks.setupRetrieve.mockResolvedValue({ ...setup, status: "canceled" });
    mocks.setupCreate.mockResolvedValue({ ...setup, id: "seti_Replacement",
      metadata: { ...setup.metadata, couranrSetupAttemptId: nextId } });
    const result = await startBusinessPaymentSetup(input);
    expect(result).toEqual({ ok: true, value: {
      attemptId: nextId, clientSecret: setup.client_secret, alreadyConfirmed: false,
    } });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_rotate_business_payment_setup",
      expect.objectContaining({ p_old_attempt_id: ATTEMPT, p_old_setup_intent_id: setup.id }));
  });

  it("cancels an expired active Stripe intent before rotating its generation", async () => {
    const nextId = "55555555-5555-4555-8555-555555555555";
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
      if (fn === "couranr_begin_business_payment_setup") return { data: { ...attempt,
        stripe_setup_intent_id: setup.id, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null };
      if (fn === "couranr_rotate_business_payment_setup") return {
        data: { ...attempt, id: nextId, generation: 2 }, error: null };
      if (fn === "couranr_attach_business_payment_setup") return { data: {}, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    });
    mocks.setupRetrieve.mockResolvedValue(setup);
    mocks.setupCreate.mockResolvedValue({ ...setup, id: "seti_Replacement",
      metadata: { ...setup.metadata, couranrSetupAttemptId: nextId } });
    const result = await startBusinessPaymentSetup(input);
    expect(result.ok).toBe(true);
    expect(mocks.setupCancel).toHaveBeenCalledWith(setup.id);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_rotate_business_payment_setup", expect.any(Object));
  });

  it("does not rotate if provider cancellation loses a confirmation race", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
      if (fn === "couranr_begin_business_payment_setup") return { data: { ...attempt,
        stripe_setup_intent_id: setup.id, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    });
    mocks.setupRetrieve.mockResolvedValue(setup);
    mocks.setupCancel.mockRejectedValue(new Error("setup intent already confirmed"));
    const result = await startBusinessPaymentSetup(input);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_rotate_business_payment_setup", expect.any(Object));
    expect(mocks.setupCreate).not.toHaveBeenCalled();
  });

  it("does not hand one manager another manager's active client secret", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
      if (fn === "couranr_begin_business_payment_setup") return { data: { ...attempt,
        actor_user_id: "66666666-6666-4666-8666-666666666666", stripe_setup_intent_id: setup.id }, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    });
    mocks.setupRetrieve.mockResolvedValue(setup);
    const result = await startBusinessPaymentSetup(input);
    expect(result.ok).toBe(false);
    expect(mocks.setupCancel).not.toHaveBeenCalled();
    expect(mocks.setupCreate).not.toHaveBeenCalled();
  });

  it("refuses a stale cross-actor redirect even if another setup has succeeded", async () => {
    mocks.from.mockImplementation((table: string) => {
      const isProfile = table === "couranr_business_payment_profiles";
      const value = isProfile
        ? { ...profile, current_generation: 2 }
        : { ...attempt, id: "55555555-5555-4555-8555-555555555555", generation: 2,
          actor_user_id: "66666666-6666-4666-8666-666666666666", stripe_setup_intent_id: setup.id };
      let selectedId: string | null = null;
      const chain = { select: () => chain, eq: (field: string, selected: string) => {
        if (field === "id") selectedId = selected;
        return chain;
      }, maybeSingle: async () => ({ data: selectedId && !isProfile &&
        selectedId !== "55555555-5555-4555-8555-555555555555" ? null : value, error: null }) };
      return chain;
    });
    const result = await completeBusinessPaymentSetup(completion);
    expect(result.ok).toBe(false);
    expect(mocks.setupRetrieve).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows a current manager to reconcile another manager's verified success without rewriting consent", async () => {
    const otherActor = "66666666-6666-4666-8666-666666666666";
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_begin_business_payment_customer") return { data: profile, error: null };
      if (fn === "couranr_begin_business_payment_setup") return { data: { ...attempt,
        actor_user_id: otherActor, stripe_setup_intent_id: setup.id }, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    });
    mocks.setupRetrieve.mockResolvedValue({ ...setup, status: "succeeded", payment_method: "pm_TestBusiness" });
    const begun = await startBusinessPaymentSetup(input);
    expect(begun).toEqual({ ok: true, value: { clientSecret: null, attemptId: ATTEMPT,
      alreadyConfirmed: true } });
    mocks.rpc.mockImplementation(async (fn: string) => fn === "couranr_complete_business_payment_setup"
      ? { data: { card_brand: "visa", card_last4: "4242" }, error: null }
      : { data: null, error: { message: "unexpected RPC" } });
    const completed = await completeBusinessPaymentSetup(completion);
    expect(completed).toEqual({ ok: true, value: { state: "ready", brand: "visa", last4: "4242" } });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_business_payment_setup",
      expect.objectContaining({ p_actor_user_id: ACTOR, p_attempt_id: ATTEMPT }));
  });

  it("fails closed on a Customer saved by a deployment in the wrong Stripe mode", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...profile, stripe_customer_livemode: true }, error: null });
    const result = await startBusinessPaymentSetup(input);
    expect(result.ok).toBe(false);
    expect(mocks.setupCreate).not.toHaveBeenCalled();
  });

  it("does not present a wrong-mode saved card as usable", async () => {
    mocks.from.mockImplementation(() => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: {
        default_payment_method_id: "pm_TestBusiness", stripe_customer_livemode: true,
        card_brand: "visa", card_last4: "4242",
      }, error: null }) };
      return chain;
    });
    const result = await getBusinessPaymentMethod(BUSINESS);
    expect(result.ok).toBe(false);
  });

  it("rejects test-mode provider evidence in production", async () => {
    const prior = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      const result = await completeBusinessPaymentSetup(completion);
      expect(result.ok).toBe(false);
      expect(mocks.methodRetrieve).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prior;
    }
  });
});
