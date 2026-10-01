import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), action: vi.fn(), call: vi.fn(), confirmCardPayment: vi.fn(),
}));
vi.mock("@/components/couranr/routes/client", () => ({
  fetchRouteProgress: mocks.fetch, routeCheckoutAction: mocks.action,
}));
vi.mock("@/components/couranr/requests/client", () => ({
  call: mocks.call,
  isApiFailure: (value: { ok: boolean }) => value.ok === false,
  withReference: (value: { error?: string }) => value.error ?? "Request failed.",
}));
vi.mock("@/components/couranr/payments/CouranrPaymentElement", () => ({
  getStripePromise: () => Promise.resolve({ confirmCardPayment: mocks.confirmCardPayment }),
}));

import { RouteCheckoutPanel } from "@/components/couranr/routes/RouteCheckoutPanel";

const businessAccountId = "11111111-1111-4111-8111-111111111111";
const routeRunId = "22222222-2222-4222-8222-222222222222";
const props = { businessAccountId, routeRunId, acceptedVersion: 3,
  stopCount: 2, totalCents: 4000, mayPay: true };
const payerAccess = { billingRead: true, authorizeRoute: true };
const readerAccess = { billingRead: true, authorizeRoute: false };
const operationalAccess = { billingRead: false, authorizeRoute: false };
const settlement = (state: string, pickupReadyConfirmed = false) => ({
  settlementId: "33333333-3333-4333-8333-333333333333",
  routeRunId, state, version: 1, referenceTotalCents: 4000,
  currency: "usd", card: { brand: "visa", last4: "4242" },
  pickupReadyConfirmed, uncertainObligationId: null,
  items: [],
});
const progress = (state: string, next: string, pickupReadyConfirmed = false,
  actionClientSecret?: string) => ({ kind: "billing", settlement: settlement(state, pickupReadyConfirmed),
    next, ...(actionClientSecret ? { actionClientSecret } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: {
    progress: null, access: payerAccess, checkoutAvailable: true,
  } });
  mocks.call.mockResolvedValue({ ok: true, value: { paymentMethod: {
    state: "ready", brand: "visa", last4: "4242",
  } } });
  mocks.confirmCardPayment.mockResolvedValue({ paymentIntent: { status: "requires_capture" } });
});

describe("RR-003 merchant Route checkout", () => {
  it("shows a truthful non-operational state without a payment action", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: null, access: payerAccess, checkoutAvailable: false,
    } });
    render(<RouteCheckoutPanel {...props} />);
    await screen.findByText(/Route checkout is not available yet/);
    expect(screen.queryByRole("button", { name: "Confirm Route checkout" })).toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("requires explicit separate-charge consent and sends no browser price authority", async () => {
    const user = userEvent.setup();
    mocks.action.mockResolvedValue({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
    } });
    render(<RouteCheckoutPanel {...props} />);
    const begin = await screen.findByRole("button", { name: "Confirm Route checkout" });
    expect(begin).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox"));
    await user.click(begin);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    const request = mocks.action.mock.calls[0][0];
    expect(request).toMatchObject({ businessAccountId, routeRunId, action: "begin", expectedVersion: 3 });
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(request).not.toHaveProperty("totalCents");
    expect(request).not.toHaveProperty("amountCents");
    expect(request).not.toHaveProperty("paymentMethodId");
  });

  it("shows billing readers full status but no payment action", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
      access: readerAccess, checkoutAvailable: true,
    } });
    render(<RouteCheckoutPanel {...props} mayPay={false} />);
    await screen.findByText(/Only a business owner or manager can authorize Route payment/);
    expect(screen.getByText(/visa ending in 4242/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm Route checkout" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pickup readiness and continue" })).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("requires a separate pickup-readiness acknowledgement with accepted generation", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
      access: payerAccess, checkoutAvailable: true,
    } });
    mocks.action.mockResolvedValue({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready", true),
    } });
    render(<RouteCheckoutPanel {...props} />);
    const ready = await screen.findByRole("button", { name: "Confirm pickup readiness and continue" });
    expect(ready).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox"));
    await user.click(ready);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledWith({ businessAccountId,
      routeRunId, action: "confirm_pickup_ready", expectedVersion: 3 }));
  });

  it("uses the existing child SCA secret but asks the server for payment truth afterward", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: progress("authorization_required", "authenticate_card"),
      access: payerAccess, checkoutAvailable: true,
    } });
    mocks.action.mockResolvedValueOnce({ ok: true, value: {
      progress: progress("authorization_required", "authenticate_card", false, "pi_existing_secret"),
    } }).mockResolvedValueOnce({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
    } });
    render(<RouteCheckoutPanel {...props} />);
    await user.click(await screen.findByRole("button", { name: "Complete secure card authentication" }));
    await waitFor(() => expect(mocks.confirmCardPayment).toHaveBeenCalledWith("pi_existing_secret"));
    expect(mocks.action).toHaveBeenCalledTimes(2);
    expect(mocks.action.mock.calls[1][0]).toEqual({ businessAccountId, routeRunId, action: "advance" });
    await screen.findByRole("button", { name: "Confirm pickup readiness and continue" });
  });

  it("does not offer a retry button for an ambiguous child capture", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: progress("capture_pending", "operations_review"),
      access: payerAccess, checkoutAvailable: true,
    } });
    render(<RouteCheckoutPanel {...props} />);
    await screen.findByText(/Do not start pickup/);
    expect(screen.queryByRole("button", { name: "Continue Route checkout" })).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("shows ordered child outcomes and released resource without exposing recipient details", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: { ...progress("ready_for_execution", "ready", true), execution: {
        state: "completed", currentSequence: 2, resourceState: "released",
        stops: [{ sequence: 1, fulfillmentState: "delivered" },
          { sequence: 2, fulfillmentState: "delivered" }],
      } }, access: payerAccess, checkoutAvailable: true,
    } });
    render(<RouteCheckoutPanel {...props} />);
    await screen.findByText("Route completed");
    expect(screen.getByText("Stop 1: delivered")).toBeTruthy();
    expect(screen.getByText("Stop 2: delivered")).toBeTruthy();
    expect(screen.getByText(/Shared resource: released/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue Route checkout" })).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it.each(["dispatcher", "viewer"])("%s sees only coarse operational status after checkout", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: {
      progress: { kind: "operational", status: "payment_pending" },
      access: operationalAccess, checkoutAvailable: true,
    } });
    render(<RouteCheckoutPanel {...props} mayPay={false} />);
    await screen.findByText("Route payment is being prepared.");
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("4242");
    expect(body).not.toContain("$40.00");
    expect(body).not.toContain("Save a business card first");
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("discards an older full billing GET after a later role-downgrade refresh", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    mocks.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, value: {
        progress: { kind: "operational", status: "operations_review" },
        access: operationalAccess, checkoutAvailable: true,
      } });
    const { rerender } = render(<RouteCheckoutPanel {...props} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    rerender(<RouteCheckoutPanel {...props} mayPay={false} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await screen.findByText("Couranr Operations is reviewing payment.");
    await act(async () => resolveOld?.({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
      access: payerAccess, checkoutAvailable: true,
    } }));
    expect(document.body.textContent).not.toContain("4242");
    expect(screen.getByText("Couranr Operations is reviewing payment.")).toBeTruthy();
  });

  it("clears visible card details while the downgraded role refresh is pending", async () => {
    let resolveDowngraded: ((value: unknown) => void) | undefined;
    mocks.fetch.mockResolvedValueOnce({ ok: true, value: {
      progress: progress("authorized", "confirm_pickup_ready"),
      access: payerAccess, checkoutAvailable: true,
    } }).mockImplementationOnce(() => new Promise((resolve) => { resolveDowngraded = resolve; }));
    const user = userEvent.setup();
    render(<RouteCheckoutPanel {...props} />);
    await screen.findByText(/visa ending in 4242/);
    await user.click(screen.getByRole("button", { name: "Refresh checkout status" }));
    expect(document.body.textContent).not.toContain("4242");
    await act(async () => resolveDowngraded?.({ ok: true, value: {
      progress: { kind: "operational", status: "payment_pending" },
      access: operationalAccess, checkoutAvailable: true,
    } }));
    await screen.findByText("Route payment is being prepared.");
    expect(document.body.textContent).not.toContain("4242");
    expect(screen.queryByRole("button", { name: "Continue Route checkout" })).toBeNull();
  });
});
