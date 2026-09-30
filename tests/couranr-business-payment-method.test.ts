import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  member: vi.fn(),
  may: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/couranr/requests/actor", () => ({
  resolveRequestActor: mocks.actor,
  isActorDenied: (result: { ok: boolean }) => result.ok === false,
}));
vi.mock("@/lib/couranr/settings/commands", () => ({ settingsActorFrom: mocks.member }));
vi.mock("@/lib/couranr/settings/permissions", () => ({ memberMay: mocks.may }));
vi.mock("@/lib/couranr/billing/paymentMethod", () => ({
  startBusinessPaymentSetup: mocks.start,
  completeBusinessPaymentSetup: mocks.complete,
  getBusinessPaymentMethod: mocks.read,
  isBusinessPaymentFailure: (result: { ok: boolean }) => result.ok === false,
}));

import { GET, POST } from "@/app/api/couranr/merchant/billing/payment-method/route";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const URL = "http://localhost/api/couranr/merchant/billing/payment-method";
function post(body: unknown) {
  return POST(new NextRequest(URL, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: "Bearer test" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ ok: true, userId: ACTOR, actor: { kind: "member", membership: { role: "owner", status: "active" } } });
  mocks.member.mockReturnValue({ userId: ACTOR, role: "owner", status: "active" });
  mocks.may.mockReturnValue(true);
  mocks.start.mockResolvedValue({ ok: true, value: { clientSecret: "seti_verified_secret_test",
    attemptId: ATTEMPT, alreadyConfirmed: false } });
  mocks.complete.mockResolvedValue({ ok: true, value: { state: "ready", brand: "visa", last4: "4242" } });
  mocks.read.mockResolvedValue({ ok: true, value: { state: "none" } });
});

describe("RR-003a saved Business card route", () => {
  it("rejects a browser-selected Stripe Customer, method, or amount before any command", async () => {
    for (const extra of ["stripeCustomerId", "paymentMethodId", "amountCents", "setupIntentId", "routeRunId"]) {
      const response = await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: true, [extra]: "forged" });
      expect(response.status, extra).toBe(400);
    }
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("requires affirmative consent for start and never accepts it on complete", async () => {
    expect((await post({ businessAccountId: BUSINESS, action: "start" })).status).toBe(400);
    expect((await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: false })).status).toBe(400);
    expect((await post({ businessAccountId: BUSINESS, action: "complete", consentAccepted: true })).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("starts under the server-resolved tenant actor with no browser payment identity", async () => {
    const response = await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clientSecret: "seti_verified_secret_test",
      attemptId: ATTEMPT, alreadyConfirmed: false });
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith({ businessAccountId: BUSINESS, actorUserId: ACTOR });
  });

  it("completion re-reads stored provider identity rather than trusting any browser ID", async () => {
    const response = await post({ businessAccountId: BUSINESS, action: "complete", attemptId: ATTEMPT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentMethod: { state: "ready", brand: "visa", last4: "4242" } });
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledWith({ businessAccountId: BUSINESS, actorUserId: ACTOR,
      attemptId: ATTEMPT });
  });

  it("requires a valid attempt selector on complete and never accepts a browser Stripe ID", async () => {
    expect((await post({ businessAccountId: BUSINESS, action: "complete" })).status).toBe(400);
    expect((await post({ businessAccountId: BUSINESS, action: "complete", attemptId: "seti_fake" })).status).toBe(400);
    expect((await post({ businessAccountId: BUSINESS, action: "complete", attemptId: ATTEMPT,
      setupIntentId: "seti_fake" })).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("refuses a viewer before provider interaction", async () => {
    mocks.may.mockReturnValue(false);
    expect((await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: true })).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated status", async () => {
    mocks.actor.mockResolvedValue({ ok: false, code: "unauthenticated", error: "Sign in to continue." });
    expect((await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: true })).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("read returns only the safe method summary", async () => {
    mocks.read.mockResolvedValue({ ok: true, value: { state: "ready", brand: "visa", last4: "4242" } });
    const response = await GET(new NextRequest(`${URL}?businessAccountId=${BUSINESS}`, { headers: { authorization: "Bearer test" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentMethod: { state: "ready", brand: "visa", last4: "4242" } });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledWith(BUSINESS);
  });

  it("uses the shared safe failure response without leaking provider details", async () => {
    mocks.start.mockResolvedValue({ ok: false, code: "internal", correlationId: "cr_rr003test", message: "Card setup could not be verified." });
    const response = await post({ businessAccountId: BUSINESS, action: "start", consentAccepted: true });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ correlationId: "cr_rr003test" }));
    expect(JSON.stringify(body)).not.toContain("stripe_customer_id");
  });
});
