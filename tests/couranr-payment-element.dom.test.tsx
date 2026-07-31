import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Stripe.js, mocked.
 *
 * The real `@stripe/react-stripe-js` needs `js.stripe.com`, which this
 * container cannot reach and which a unit test should not depend on anyway.
 * What is mocked is the PROVIDER; what is under test is entirely our own
 * logic — when confirmPayment runs, when reconciliation runs, when it must
 * NOT run, and what the payer is shown at each point.
 *
 * These are contract tests against the Stripe React API surface. They prove
 * our orchestration is correct. They do not prove Stripe accepts a card —
 * that is PAYMENT_REAL_STRIPE_VERIFICATION, a prelaunch gate.
 */

const confirmPayment = vi.fn();
const elementsInstance = { __elements: true };

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => ({ __stripe: true })),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  // Records what the provider was handed, so the client secret can be asserted.
  Elements: ({ children, options, stripe }: any) => (
    <div
      data-testid="elements-provider"
      data-client-secret={options?.clientSecret ?? ""}
      data-has-amount={options?.amount === undefined ? "no" : "yes"}
      data-stripe={stripe ? "present" : "absent"}
    >
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => elementsInstance,
}));

import { CouranrPaymentElement } from "@/components/couranr/payments/CouranrPaymentElement";

const SECRET = "pi_test_123_secret_abc";

function setup(overrides: Partial<React.ComponentProps<typeof CouranrPaymentElement>> = {}) {
  const reconcile = vi.fn(async () => ({ paymentState: "authorized" as string | null }));
  const onAuthorized = vi.fn();
  const props = {
    clientSecret: SECRET,
    amountCents: 2299,
    reconcile,
    onAuthorized,
    ...overrides,
  } as React.ComponentProps<typeof CouranrPaymentElement>;
  render(<CouranrPaymentElement {...props} />);
  return { reconcile: props.reconcile as any, onAuthorized: props.onAuthorized as any };
}

describe("CouranrPaymentElement", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_dom_placeholder";
    confirmPayment.mockReset();
    confirmPayment.mockResolvedValue({});
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  it("mounts the PaymentElement", () => {
    setup();
    expect(screen.getByTestId("payment-element")).toBeTruthy();
    expect(screen.getByRole("button", { name: /authorize/i })).toBeTruthy();
  });

  it("hands the SERVER's client secret to Elements, and no amount", () => {
    setup();
    const provider = screen.getByTestId("elements-provider");
    expect(provider.getAttribute("data-client-secret")).toBe(SECRET);
    expect(provider.getAttribute("data-stripe")).toBe("present");
    /*
     * No amount reaches Elements. The intent already carries it, so there is
     * no number in the browser that could be edited on its way to Stripe.
     */
    expect(provider.getAttribute("data-has-amount")).toBe("no");
  });

  it("invokes confirmPayment on submit, with redirect: if_required", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(confirmPayment).toHaveBeenCalledTimes(1));
    const arg = confirmPayment.mock.calls[0][0];
    expect(arg.redirect).toBe("if_required");
    expect(arg.elements).toBe(elementsInstance);
    // No amount, no currency, no destination is passed from the browser.
    expect(arg.amount).toBeUndefined();
    expect(arg.currency).toBeUndefined();
  });

  /** The core invariant: nothing is asked of the server before confirmation. */
  it("never reconciles before confirmation completes", async () => {
    let release: (v: any) => void = () => {};
    confirmPayment.mockImplementation(() => new Promise((r) => (release = r)));
    const { reconcile } = setup();

    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(confirmPayment).toHaveBeenCalled());
    // Confirmation is still in flight.
    expect(reconcile).not.toHaveBeenCalled();

    release({});
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  });

  it("does NOT reconcile when confirmation errors", async () => {
    confirmPayment.mockResolvedValue({ error: { message: "Your card was declined." } });
    const { reconcile, onAuthorized } = setup();

    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(screen.getByText("Your card was declined.")).toBeTruthy());

    expect(reconcile).not.toHaveBeenCalled();
    expect(onAuthorized).not.toHaveBeenCalled();
    // And the payer can try again.
    expect(screen.getByRole("button", { name: /authorize/i })).toBeTruthy();
  });

  it("reconciles exactly once on a successful confirmation", async () => {
    const { reconcile, onAuthorized } = setup();
    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledTimes(1));
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    // Reconcile is told nothing by the browser.
    expect(reconcile.mock.calls[0]).toHaveLength(0);
  });

  /**
   * The whole point. A green confirmPayment is the browser's claim; the
   * authorized state appears only when the SERVER says so.
   */
  it("shows the authorized state only after the server reports authorization", async () => {
    const reconcile = vi.fn(async () => ({ paymentState: "requires_action" }));
    setup({ reconcile } as any);

    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(reconcile).toHaveBeenCalled());

    // confirmPayment succeeded, and still no success is shown.
    expect(screen.queryByText(/Payment authorized/i)).toBeNull();
    expect(screen.getByText(/still confirming/i)).toBeTruthy();
  });

  it("shows the authorized state when the server does report it", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(screen.getByText(/Payment authorized/i)).toBeTruthy());
    // And says the true thing about manual capture.
    expect(screen.getByText(/Nothing has been taken/i)).toBeTruthy();
    expect(screen.queryByText(/has been charged/i)).toBeNull();
  });

  it("surfaces a server-reported failure as retryable", async () => {
    const reconcile = vi.fn(async () => ({ paymentState: "failed" }));
    setup({ reconcile } as any);
    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(screen.getByText(/did not go through/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /authorize/i })).toBeTruthy();
  });

  it("prevents a duplicate submission while one is in flight", async () => {
    let release: (v: any) => void = () => {};
    confirmPayment.mockImplementation(() => new Promise((r) => (release = r)));
    const { reconcile } = setup();

    const button = screen.getByRole("button", { name: /authorize/i });
    // Three clicks before the first resolves.
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    expect(confirmPayment).toHaveBeenCalledTimes(1);
    release({});
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  });

  it("recovers from a thrown reconcile without claiming success", async () => {
    const reconcile = vi.fn(async () => {
      throw new Error("network");
    });
    const { onAuthorized } = setup({ reconcile } as any);
    await userEvent.click(screen.getByRole("button", { name: /authorize/i }));
    await waitFor(() => expect(screen.getByText(/could not reach Couranr/i)).toBeTruthy());
    expect(onAuthorized).not.toHaveBeenCalled();
    expect(screen.queryByText(/Payment authorized/i)).toBeNull();
  });

  it("says so plainly when no publishable key is configured", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    render(
      <CouranrPaymentElement clientSecret={SECRET} amountCents={100} reconcile={vi.fn() as any} />
    );
    expect(screen.getByText(/not available right now/i)).toBeTruthy();
    // Never an empty box that reads as a slow network.
    expect(screen.queryByTestId("payment-element")).toBeNull();
  });
});

/**
 * Both payer paths must go through the SAME component. Two copies of card
 * confirmation is two places to get `redirect`, the reconcile ordering or the
 * duplicate guard wrong.
 */
describe("merchant and customer use one implementation", () => {
  it("both surfaces render CouranrPaymentElement and neither keeps a placeholder", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");

    for (const f of [
      "components/couranr/payments/PaymentLinkPage.tsx",
      "components/couranr/payments/MerchantPaymentPanel.tsx",
    ]) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, `${f} does not use the shared element`).toMatch(/<CouranrPaymentElement/);
      // The placeholder div both surfaces used to carry is gone.
      expect(src, `${f} still has a placeholder`).not.toMatch(/data-couranr-payment-element/);
    }

    /*
     * Exactly ONE confirmPayment CALL SITE in the whole app.
     *
     * Comments legitimately mention it — the customer page explains that its
     * reconcile callback runs only after `stripe.confirmPayment` succeeds — so
     * comments are stripped first. Counting mentions instead of calls is how a
     * test ends up failing on its own documentation.
     */
    const { execSync } = await import("node:child_process");
    const mentions = execSync(
      `grep -rl "confirmPayment" ${root}/components ${root}/app ${root}/lib || true`,
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);

    const callSites = mentions.filter((f) => {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /\bstripe\.confirmPayment\s*\(/.test(code);
    });

    expect(callSites).toEqual([
      path.join(root, "components/couranr/payments/CouranrPaymentElement.tsx"),
    ]);
    // Positive control: the phrase really does appear in more than one file,
    // so the filter above is doing work rather than matching nothing.
    expect(mentions.length).toBeGreaterThan(callSites.length);
  });
});
