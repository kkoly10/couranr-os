import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  maybeSingle: vi.fn(),
  listProof: vi.fn(),
}));

vi.mock("@/lib/couranr/requests/actor", () => ({
  resolveRequestActor: h.actor,
  isActorDenied: (value: any) => Boolean(value?.code),
}));
vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }) }),
  },
}));
vi.mock("@/lib/couranr/driver/proof", () => ({
  listProofMetadata: h.listProof,
  isDriverFailure: (value: any) => value?.ok === false,
}));

import { GET } from "@/app/api/couranr/operations/deliveries/[id]/proof/route";

const ID = "b31a4272-804f-4d52-8c22-9345351e27c7";
const call = () => GET({} as any, { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  h.actor.mockReset();
  h.maybeSingle.mockReset();
  h.listProof.mockReset();
  h.actor.mockResolvedValue({ actor: { kind: "operations", userId: "ops" } });
  h.maybeSingle.mockResolvedValue({ data: { id: ID }, error: null });
  h.listProof.mockResolvedValue({ ok: true, value: [{ proofId: "pickup-photo", proofStage: "pickup" }] });
});

describe("Operations proof metadata is delivery-scoped", () => {
  it("reads direct Consumer proof without asking for merchant tenancy", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proof: [{ proofId: "pickup-photo", proofStage: "pickup" }] });
    expect(h.listProof).toHaveBeenCalledWith(ID);
    expect(h.actor).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("denies a merchant before looking up proof", async () => {
    h.actor.mockResolvedValue({ actor: { kind: "member", userId: "merchant" } });
    const response = await call();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(h.maybeSingle).not.toHaveBeenCalled();
    expect(h.listProof).not.toHaveBeenCalled();
  });

  it("does not describe a missing delivery as an empty proof list", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await call();
    expect(response.status).toBe(404);
    expect(h.listProof).not.toHaveBeenCalled();
  });
});
