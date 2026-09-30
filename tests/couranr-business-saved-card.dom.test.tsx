import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const confirmSetup = vi.fn();
const fetchAccounts = vi.fn();
vi.mock("@/components/couranr/requests/client", () => ({
  call: (...args: unknown[]) => call(...args),
  fetchMyBusinessAccounts: (...args: unknown[]) => fetchAccounts(...args),
  isApiFailure: (value: { ok: boolean }) => value.ok === false,
  withReference: (value: { error: string }) => value.error,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/couranr/payments/CouranrPaymentElement", () => ({
  getStripePromise: () => Promise.resolve({}),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: ({ onReady }: { onReady: () => void }) => <button type="button" onClick={onReady}>Secure form ready</button>,
  useElements: () => ({}),
  useStripe: () => ({ confirmSetup }),
}));

const { SavedBusinessCard } = await import("@/components/couranr/billing/SavedBusinessCard");
const { BillingRecords } = await import("@/components/couranr/billing/BillingRecords");
const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const NONE = { ok: true, value: { paymentMethod: { state: "none" } } };
const READY = { ok: true, value: { paymentMethod: { state: "ready", brand: "visa", last4: "4242" } } };

beforeEach(() => {
  call.mockReset();
  fetchAccounts.mockReset();
  confirmSetup.mockReset();
  window.history.replaceState({}, "", "/app/business/settings/billing");
  call.mockImplementation((_path: string, options?: { body?: { action?: string } }) => {
    if (!options) return Promise.resolve(NONE);
    if (options.body?.action === "start") return Promise.resolve({ ok: true, value: {
      clientSecret: "seti_test_secret", attemptId: ATTEMPT, alreadyConfirmed: false } });
    return Promise.resolve(READY);
  });
  confirmSetup.mockResolvedValue({ setupIntent: { status: "succeeded" } });
});

describe("RR-003a saved Business card", () => {
  it("does no provider or setup write merely by rendering", async () => {
    render(<SavedBusinessCard businessAccountId={BIZ} mayManage />);
    expect(await screen.findByText("No card is saved for this business.")).toBeTruthy();
    expect(call.mock.calls.every(([, options]) => !options)).toBe(true);
    expect(confirmSetup).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add a card" })).toHaveProperty("disabled", true);
  });

  it("keeps read-only roles away from card setup", async () => {
    render(<SavedBusinessCard businessAccountId={BIZ} mayManage={false} />);
    expect(await screen.findByText(/Only an owner or manager/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
  });

  it("requires affirmative consent then verifies with the server after Stripe confirms", async () => {
    const user = userEvent.setup();
    render(<SavedBusinessCard businessAccountId={BIZ} mayManage />);
    await screen.findByText("No card is saved for this business.");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add a card" }));
    expect(await screen.findByRole("button", { name: "Secure form ready" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Secure form ready" }));
    await user.click(screen.getByRole("button", { name: "Confirm and save card" }));
    await screen.findByText(/visa ending in 4242/);
    expect(confirmSetup).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: "POST", body: { businessAccountId: BIZ, action: "start", consentAccepted: true },
    }));
    expect(call).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: "POST", body: { businessAccountId: BIZ, action: "complete", attemptId: ATTEMPT },
    }));
  });

  it("redirect completion succeeds without a preliminary saved-card GET", async () => {
    call.mockImplementation((_path: string, options?: { body?: { action?: string } }) => {
      if (!options) return Promise.resolve({ ok: false, error: "Temporary read failure" });
      return Promise.resolve(READY);
    });
    render(<SavedBusinessCard businessAccountId={BIZ} mayManage returnAttemptId={ATTEMPT} />);
    expect(await screen.findByText(/visa ending in 4242/)).toBeTruthy();
    expect(call.mock.calls.some(([, options]) => !options)).toBe(false);
    expect(call).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: { businessAccountId: BIZ, action: "complete", attemptId: ATTEMPT },
    }));
  });

  it("keeps a retry control if redirect verification and GET both fail", async () => {
    call.mockImplementation((_path: string, options?: { body?: { action?: string } }) => {
      if (!options) return Promise.resolve({ ok: false, error: "Temporary read failure" });
      if (options.body?.action === "complete" && call.mock.calls.filter(([, o]) => o?.body?.action === "complete").length === 1)
        return Promise.resolve({ ok: false, error: "Temporary verification failure" });
      return Promise.resolve(READY);
    });
    const user = userEvent.setup();
    render(<SavedBusinessCard businessAccountId={BIZ} mayManage returnAttemptId={ATTEMPT} />);
    expect(await screen.findByRole("button", { name: "Check card setup status" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Check card setup status" }));
    expect(await screen.findByText(/visa ending in 4242/)).toBeTruthy();
  });
});

describe("RR-003a billing return entry", () => {
  it("scrubs Stripe secrets even when account loading fails", async () => {
    fetchAccounts.mockResolvedValue({ ok: false, status: 500, error: "Account lookup failed" });
    window.history.replaceState({}, "", "/app/business/settings/billing?setup_intent_client_secret=private_secret");
    render(<BillingRecords />);
    await screen.findByText(/We could not check your account/);
    expect(window.location.search).toBe("");
  });

  it("retries failed account lookup without losing the scrubbed Stripe return attempt", async () => {
    fetchAccounts.mockResolvedValueOnce({ ok: false, status: 500, error: "Temporary account failure" })
      .mockResolvedValueOnce({ ok: true, value: { businessAccounts: [
        { businessAccountId: BIZ, name: "Returning", role: "owner" },
      ] } });
    window.history.replaceState({}, "", `/app/business/settings/billing?setupBusinessAccountId=${BIZ}&setupAttemptId=${ATTEMPT}&setup_intent_client_secret=private_secret`);
    call.mockImplementation((path: string, options?: { body?: { action?: string } }) => {
      if (options?.body?.action === "complete") return Promise.resolve(READY);
      if (path.includes("/payment-method")) return Promise.resolve(NONE);
      return Promise.resolve({ ok: false, error: "Billing projection unavailable" });
    });
    const user = userEvent.setup();
    render(<BillingRecords />);
    await screen.findByText(/We could not check your account/);
    expect(window.location.search).toBe("");
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(call.mock.calls.some(([, options]) =>
      options?.body?.action === "complete" && options.body.attemptId === ATTEMPT)).toBe(true));
    expect(await screen.findByText(/visa ending in 4242/)).toBeTruthy();
  });

  it("selects a readable Business instead of trapping an owner behind a first-account viewer role", async () => {
    fetchAccounts.mockResolvedValue({ ok: true, value: { businessAccounts: [
      { businessAccountId: OTHER, name: "Viewer account", role: "viewer" },
      { businessAccountId: BIZ, name: "Owner account", role: "owner" },
    ] } });
    call.mockImplementation((path: string) => path.includes("/payment-method")
      ? Promise.resolve(NONE) : Promise.resolve({ ok: false, error: "Billing projection unavailable" }));
    render(<BillingRecords />);
    expect(await screen.findByText("No card is saved for this business.")).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("value", BIZ);
  });

  it("completes only the matching tenant's return and removes the URL secret", async () => {
    fetchAccounts.mockResolvedValue({ ok: true, value: { businessAccounts: [
      { businessAccountId: OTHER, name: "Other", role: "owner" },
      { businessAccountId: BIZ, name: "Returning", role: "owner" },
    ] } });
    window.history.replaceState({}, "", `/app/business/settings/billing?setupBusinessAccountId=${BIZ}&setupAttemptId=${ATTEMPT}&setup_intent_client_secret=private_secret`);
    call.mockImplementation((path: string, options?: { body?: { action?: string } }) => {
      if (options?.body?.action === "complete") return Promise.resolve(READY);
      if (path.includes("/payment-method")) return Promise.resolve(NONE);
      return Promise.resolve({ ok: false, error: "Billing projection unavailable" });
    });
    render(<BillingRecords />);
    await waitFor(() => expect(call.mock.calls.some(([, options]) =>
      options?.body?.action === "complete" && options.body.businessAccountId === BIZ)).toBe(true));
    expect(window.location.search).toBe("");
  });
});
