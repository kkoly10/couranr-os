import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const call = vi.fn();

vi.mock("@/components/couranr/requests/client", () => ({
  call,
  isApiFailure: (r: any) => r?.ok === false,
}));

vi.mock("@/components/couranr/payments/CouranrPaymentElement", () => ({
  CouranrPaymentElement: () => <div data-testid="payment-element-double" />,
}));

import { MerchantPaymentPanel } from "@/components/couranr/payments/MerchantPaymentPanel";

const REQUEST: any = {
  id: "11111111-2222-4333-8444-555555555555",
  requestState: "awaiting_quote_acceptance",
  payerType: "customer",
  quote: { deliverySubtotalCents: 1299 },
};

describe("merchant customer payment link", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    call.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("creates the real token-scoped payment link instead of claiming Couranr already sent one", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: {
        token: "customer-secure-token",
        expiresAt: "2026-09-11T12:00:00.000Z",
      },
    });

    render(
      <MerchantPaymentPanel
        request={REQUEST}
        businessAccountId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
      />
    );

    expect(screen.getByRole("button", { name: /create secure payment link/i })).toBeTruthy();
    expect(screen.queryByText(/Couranr sends the recipient/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /create secure payment link/i }));

    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][0]).toBe(
      "/api/couranr/delivery-requests/11111111-2222-4333-8444-555555555555/payment-link"
    );
    expect(call.mock.calls[0][1]).toEqual({
      method: "POST",
      body: { businessAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    });

    const input = screen.getByLabelText("Customer payment link") as HTMLInputElement;
    expect(input.value).toMatch(/\/pay\/customer-secure-token$/);
    expect(screen.getByRole("button", { name: /copy payment link/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /replace link/i })).toBeTruthy();
  });

  it("copies only the server-issued link and makes the one-time-token behavior explicit", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: {
        token: "copy-me",
        expiresAt: "2026-09-11T12:00:00.000Z",
      },
    });

    render(
      <MerchantPaymentPanel
        request={REQUEST}
        businessAccountId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /create secure payment link/i }));
    const input = await screen.findByLabelText("Customer payment link") as HTMLInputElement;

    await userEvent.click(screen.getByRole("button", { name: /copy payment link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value));
    expect(screen.getByText(/Payment link copied/i)).toBeTruthy();
    expect(screen.getByText(/does not show this raw link again/i)).toBeTruthy();
  });

  it("surfaces link-creation failure without inventing a URL", async () => {
    call.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "This payment is already authorized.",
    });

    render(
      <MerchantPaymentPanel
        request={REQUEST}
        businessAccountId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /create secure payment link/i }));

    expect(await screen.findByText("This payment is already authorized.")).toBeTruthy();
    expect(screen.queryByLabelText("Customer payment link")).toBeNull();
  });
});
