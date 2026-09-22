import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createIntent: vi.fn(),
  retrieveIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listDisputes: vi.fn(),
}));

vi.mock("@/lib/stripeClient", () => ({
  stripe: {
    paymentIntents: {
      create: doubles.createIntent,
      retrieve: doubles.retrieveIntent,
    },
    charges: { retrieve: doubles.retrieveCharge },
    disputes: { list: doubles.listDisputes },
  },
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc: doubles.rpc, from: doubles.from },
}));

import {
  prepareDriverTip,
  reconcileDriverTipIntent,
} from "@/lib/couranr/driver/feedback";

const tip = {
  id: "10000000-0000-4000-8000-000000000001",
  delivery_id: "20000000-0000-4000-8000-000000000002",
  driver_id: "30000000-0000-4000-8000-000000000003",
  request_id: "40000000-0000-4000-8000-000000000004",
  amount_cents: 725,
  currency: "usd",
  provider_payment_intent_id: null as string | null,
  payment_state: "prepared",
  intent_generation: 0,
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_tipprovider123",
    amount: 725,
    amount_received: 0,
    currency: "usd",
    capture_method: "automatic",
    status: "requires_payment_method",
    client_secret: "pi_tipprovider123_secret_test",
    latest_charge: null,
    metadata: {
      couranrTipId: tip.id,
      couranrTipDeliveryId: tip.delivery_id,
      couranrTipDriverId: tip.driver_id,
    },
    ...overrides,
  };
}

const scope = {
  audience: "sender" as const,
  guestSessionId: "50000000-0000-4000-8000-000000000005",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("driver tip provider double", () => {
  it("creates one separate company automatic-capture intent and attaches its identity", async () => {
    doubles.rpc.mockImplementation(async (name: string) => {
      if (name === "couranr_prepare_driver_tip") return { data: { ...tip }, error: null };
      if (name === "couranr_attach_driver_tip_intent") {
        return { data: { ...tip, provider_payment_intent_id: "pi_tipprovider123", payment_state: "pending" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    doubles.createIntent.mockResolvedValue(intent());

    await expect(prepareDriverTip({
      deliveryId: tip.delivery_id,
      scope,
      amountCents: tip.amount_cents,
    })).resolves.toEqual({
      clientSecret: "pi_tipprovider123_secret_test",
      state: "pending",
      amountCents: 725,
    });

    expect(doubles.createIntent).toHaveBeenCalledTimes(1);
    const [body, options] = doubles.createIntent.mock.calls[0];
    expect(body).toMatchObject({
      amount: 725,
      currency: "usd",
      capture_method: "automatic",
      automatic_payment_methods: { enabled: true },
      metadata: {
        couranrTipId: tip.id,
        couranrTipDeliveryId: tip.delivery_id,
        couranrTipDriverId: tip.driver_id,
      },
    });
    expect(body).not.toHaveProperty("transfer_data");
    expect(body).not.toHaveProperty("destination");
    expect(body).not.toHaveProperty("on_behalf_of");
    expect(options).toEqual({ idempotencyKey: `couranr:driver-tip:${tip.id}:intent:0` });
  });

  it("retrieves the already attached intent instead of creating another charge", async () => {
    const attached = { ...tip, provider_payment_intent_id: "pi_tipprovider123", payment_state: "pending" };
    doubles.rpc.mockResolvedValue({ data: attached, error: null });
    doubles.retrieveIntent.mockResolvedValue(intent());

    await prepareDriverTip({ deliveryId: tip.delivery_id, scope, amountCents: 725 });

    expect(doubles.retrieveIntent).toHaveBeenCalledWith("pi_tipprovider123");
    expect(doubles.createIntent).not.toHaveBeenCalled();
  });

  it("rotates a terminal canceled intent once with generation CAS", async () => {
    const attached = { ...tip, provider_payment_intent_id: "pi_tipprovider123",
      payment_state: "pending", intent_generation: 0 };
    const replacement = intent({ id: "pi_tipreplacement123",
      client_secret: "pi_tipreplacement123_secret_test" });
    replacement.metadata = {
      couranrTipId: tip.id,
      couranrTipDeliveryId: tip.delivery_id,
      couranrTipDriverId: tip.driver_id,
    };
    doubles.rpc.mockImplementation(async (name: string) => {
      if (name === "couranr_prepare_driver_tip") return { data: attached, error: null };
      if (name === "couranr_replace_driver_tip_intent") {
        return { data: { ...attached, provider_payment_intent_id: replacement.id,
          payment_state: "pending", intent_generation: 1 }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    doubles.retrieveIntent.mockResolvedValue(intent({ status: "canceled" }));
    doubles.createIntent.mockResolvedValue(replacement);

    await expect(prepareDriverTip({
      deliveryId: tip.delivery_id, scope, amountCents: 725,
    })).resolves.toMatchObject({
      clientSecret: "pi_tipreplacement123_secret_test",
      state: "pending",
    });
    expect(doubles.createIntent).toHaveBeenCalledTimes(1);
    expect(doubles.createIntent.mock.calls[0][1]).toEqual({
      idempotencyKey: `couranr:driver-tip:${tip.id}:intent:1`,
    });
    expect(doubles.rpc).toHaveBeenCalledWith("couranr_replace_driver_tip_intent", {
      p_tip_id: tip.id,
      p_expected_intent_id: "pi_tipprovider123",
      p_expected_generation: 0,
      p_new_intent_id: "pi_tipreplacement123",
    });
  });

  it("re-reads the provider, checks the charge, and settles only the exact stored tip", async () => {
    const stored = { ...tip, provider_payment_intent_id: "pi_tipprovider123", payment_state: "pending" };
    doubles.retrieveIntent.mockResolvedValue(intent({
      status: "succeeded",
      amount_received: 725,
      latest_charge: "ch_tipprovider123",
    }));
    doubles.retrieveCharge.mockResolvedValue({
      id: "ch_tipprovider123",
      payment_intent: "pi_tipprovider123",
      amount: 725,
      amount_refunded: 0,
      disputed: false,
    });
    doubles.listDisputes.mockResolvedValue({ data: [], has_more: false });
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: stored, error: null })),
    };
    doubles.from.mockReturnValue(chain);
    doubles.rpc.mockImplementation(async (name: string) => {
      if (name === "couranr_settle_driver_tip") {
        return { data: { ...stored, payment_state: "succeeded" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    await expect(reconcileDriverTipIntent("pi_tipprovider123"))
      .resolves.toEqual({ outcome: "settled", state: "succeeded" });
    expect(doubles.retrieveCharge).toHaveBeenCalledWith("ch_tipprovider123");
    expect(doubles.listDisputes).toHaveBeenCalledWith({ charge: "ch_tipprovider123", limit: 10 });
    expect(doubles.rpc).toHaveBeenCalledWith("couranr_settle_driver_tip", expect.objectContaining({
      p_tip_id: tip.id,
      p_intent_id: "pi_tipprovider123",
      p_amount_cents: 725,
      p_amount_received_cents: 725,
      p_refunded_amount_cents: 0,
      p_currency: "usd",
      p_dispute_id: null,
      p_dispute_status: null,
      p_disputed_amount_cents: 0,
    }));
  });

  it("acknowledges an exact canceled superseded intent without mutating its replacement", async () => {
    const stored = { ...tip, provider_payment_intent_id: "pi_tipreplacement123",
      payment_state: "pending", intent_generation: 1 };
    doubles.retrieveIntent.mockResolvedValue(intent({ status: "canceled" }));
    const chain: any = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: stored, error: null })),
    };
    doubles.from.mockReturnValue(chain);

    await expect(reconcileDriverTipIntent("pi_tipprovider123"))
      .resolves.toEqual({ outcome: "superseded" });
    expect(doubles.rpc).not.toHaveBeenCalled();
    expect(doubles.retrieveCharge).not.toHaveBeenCalled();
  });

  it("refuses a mismatched noncanceled intent even after a rotation", async () => {
    const stored = { ...tip, provider_payment_intent_id: "pi_tipreplacement123",
      payment_state: "pending", intent_generation: 1 };
    doubles.retrieveIntent.mockResolvedValue(intent({ status: "succeeded", amount_received: 725 }));
    const chain: any = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: stored, error: null })),
    };
    doubles.from.mockReturnValue(chain);

    await expect(reconcileDriverTipIntent("pi_tipprovider123"))
      .rejects.toThrow("tip_provider_mismatch");
    expect(doubles.rpc).not.toHaveBeenCalled();
  });

  it("persists exact provider dispute identity, amount, and status", async () => {
    const stored = { ...tip, provider_payment_intent_id: "pi_tipprovider123", payment_state: "succeeded" };
    doubles.retrieveIntent.mockResolvedValue(intent({
      status: "succeeded", amount_received: 725, latest_charge: "ch_tipprovider123",
    }));
    doubles.retrieveCharge.mockResolvedValue({
      id: "ch_tipprovider123", payment_intent: "pi_tipprovider123",
      amount: 725, amount_refunded: 0, disputed: true,
    });
    doubles.listDisputes.mockResolvedValue({ has_more: false, data: [{
      id: "du_tipprovider123", charge: "ch_tipprovider123",
      payment_intent: "pi_tipprovider123", currency: "usd",
      amount: 300, status: "under_review",
    }] });
    const chain: any = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: stored, error: null })),
    };
    doubles.from.mockReturnValue(chain);
    doubles.rpc.mockResolvedValue({ data: { ...stored, payment_state: "disputed" }, error: null });

    await reconcileDriverTipIntent("pi_tipprovider123");
    expect(doubles.rpc).toHaveBeenCalledWith("couranr_settle_driver_tip", expect.objectContaining({
      p_dispute_id: "du_tipprovider123",
      p_dispute_status: "under_review",
      p_disputed_amount_cents: 300,
    }));
  });
});
