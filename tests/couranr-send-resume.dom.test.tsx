import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * PUB-004 consumer /send — the RESUME path, driven as a visitor would drive it
 * (final closure pass §5).
 *
 * The defect this guards: a reloaded page whose stored request was already
 * submitted and is awaiting the payer's authorization used to run the SUBMIT
 * path again when the visitor pressed the payment button — a second POST to
 * /submit against a request that is no longer a draft. The resumed action must
 * call /pay directly, render the one Payment Element with the SERVER's
 * clientSecret and amount, and never touch /submit. And when QVL-001 has aged
 * the quote out on that reload, recovery must re-price the SAME request from
 * its STORED facts (/refresh-quote, no body) — not re-estimate from a form the
 * reload emptied, and not mint a second guest request.
 *
 * Only the network and Stripe.js are stubbed. The component, both adapters
 * layers and the guest-session storage logic are the real code.
 */

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => ({ __stripe: true })),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, options }: any) => (
    <div
      data-testid="elements-provider"
      data-client-secret={options?.clientSecret ?? ""}
      data-has-amount={options?.amount === undefined ? "no" : "yes"}
    >
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({ __elements: true }),
}));

import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { GUEST_HEADER, GUEST_STORAGE_KEY } from "@/lib/couranr/sameday/liveAdapters";

const API = "/api/couranr/consumer";
const SESSION = `${API}/session`;
const ESTIMATE = `${API}/estimate`;
const SUBMIT = `${API}/submit`;
const REQUEST = `${API}/request`;
const PAY = `${API}/pay`;
const REFRESH = `${API}/refresh-quote`;

const GUEST_TOKEN = "guest-dom-resume-token";
const SERVER_SECRET = "pi_resume_123_secret_fromserver";

type Call = { path: string; method: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => { status?: number; body: unknown };

/**
 * A fetch stub that records every request the page makes and answers by path.
 * Unhandled paths answer 404 — a call the test did not expect must fail
 * loudly rather than be swallowed by the adapters' "service down" branch.
 */
function installFetch(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : String(input?.url ?? input);
    const path = url.split("?")[0];
    const call: Call = {
      path,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    const h = handlers[path];
    if (!h) {
      return { ok: false, status: 404, json: async () => ({ error: "unhandled", code: "not_found" }) };
    }
    const r = h(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  });
  globalThis.fetch = impl as unknown as typeof fetch;
  return {
    calls,
    of: (path: string) => calls.filter((c) => c.path === path),
  };
}

function storeGuest() {
  window.sessionStorage.setItem(
    GUEST_STORAGE_KEY,
    JSON.stringify({
      token: GUEST_TOKEN,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
  );
}

/** The canonical own-request view for a submitted request awaiting the payer. */
const awaitingView = (state: "awaiting_quote_acceptance" | "quote_revision_required") => ({
  request: {
    state,
    quoteStatus: "estimated",
    totalCents: 1299,
    paymentState: "not_started",
  },
});

const payOk = (amountCents: number) => ({
  payment: { clientSecret: SERVER_SECRET, amountCents },
});

const originalFetch = globalThis.fetch;

describe("SendFlow live resume — awaiting the payer's authorization", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_dom_placeholder";
    window.sessionStorage.clear();
    routerReplace.mockReset();
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  it("reload + Continue to payment ⇒ /submit 0, /pay 1, Element gets the server's secret and amount", async () => {
    storeGuest();
    const f = installFetch({
      [REQUEST]: () => ({ body: awaitingView("awaiting_quote_acceptance") }),
      // A DIFFERENT amount from the request view, so the assertion below can
      // only pass if the Element received /pay's own server figure.
      [PAY]: () => ({ body: payOk(1349) }),
      [SUBMIT]: () => ({ body: { request: { state: "awaiting_quote_acceptance" } } }),
      [SESSION]: () => ({ body: { guestSession: { token: "MUST-NOT-MINT", expiresAt: "" } } }),
    });

    render(<SendFlow mode="live" productionStop="Same Day ordering is not open yet." />);

    // The resume landed on the payment step with the server's stored total.
    const cta = await screen.findByRole("button", { name: "Continue to payment" });
    expect(screen.getByText("Total: $12.99")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request this delivery" })).toBeNull();

    // The stored session was reused: exactly one GET /request, with the guest
    // header, and NO new session was minted by loading the page.
    expect(f.of(REQUEST)).toHaveLength(1);
    expect(f.of(REQUEST)[0].headers[GUEST_HEADER]).toBe(GUEST_TOKEN);
    expect(f.of(SESSION)).toHaveLength(0);

    await userEvent.click(cta);

    const provider = await screen.findByTestId("elements-provider");
    expect(provider.getAttribute("data-client-secret")).toBe(SERVER_SECRET);
    // No amount reaches Elements; the intent already carries it.
    expect(provider.getAttribute("data-has-amount")).toBe("no");
    expect(screen.getByTestId("payment-element")).toBeTruthy();
    // The amount SHOWN is /pay's server echo, not the request view's number.
    expect(screen.getByRole("button", { name: "Authorize $13.49" })).toBeTruthy();

    // THE INVARIANT.
    expect(f.of(SUBMIT)).toHaveLength(0);
    expect(f.of(PAY)).toHaveLength(1);
    expect(f.of(PAY)[0].method).toBe("POST");
    expect(f.of(PAY)[0].headers[GUEST_HEADER]).toBe(GUEST_TOKEN);
    // /pay carries no body: nothing the browser holds is an amount or a state.
    expect(f.of(PAY)[0].body).toBeUndefined();
    expect(f.of(ESTIMATE)).toHaveLength(0);
    expect(f.of(SESSION)).toHaveLength(0);
  });

  it("a quote_revision_required resume says the price changed and still pays without /submit", async () => {
    storeGuest();
    const f = installFetch({
      [REQUEST]: () => ({ body: awaitingView("quote_revision_required") }),
      [PAY]: () => ({ body: payOk(1299) }),
      [SUBMIT]: () => ({ body: { request: { state: "awaiting_quote_acceptance" } } }),
    });

    render(<SendFlow mode="live" productionStop="stop" />);

    const cta = await screen.findByRole("button", { name: "Continue to payment" });
    expect(screen.getByRole("status").textContent).toMatch(/Couranr updated the price/);

    await userEvent.click(cta);
    await screen.findByTestId("elements-provider");

    expect(f.of(SUBMIT)).toHaveLength(0);
    expect(f.of(PAY)).toHaveLength(1);
  });

  it("quote expired on resume ⇒ /refresh-quote (no body) re-prices the SAME request; no /estimate, no /submit, no new session", async () => {
    storeGuest();
    let payCalls = 0;
    const f = installFetch({
      [REQUEST]: () => ({ body: awaitingView("awaiting_quote_acceptance") }),
      [PAY]: () => {
        payCalls += 1;
        // First attempt: QVL-001 aged the quote out. Second: Quote N+1 pays.
        return payCalls === 1
          ? { status: 410, body: { error: "The quote expired.", code: "quote_expired" } }
          : { body: payOk(1399) };
      },
      [REFRESH]: () => ({
        body: {
          estimate: {
            requestId: "req-same-1",
            quoteStatus: "estimated",
            totalCents: 1399,
            quoteVersionId: "qv-2",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
        },
      }),
      [ESTIMATE]: () => ({ body: { estimate: { requestId: "MUST-NOT-RUN", quoteStatus: "estimated", totalCents: 1 } } }),
      [SUBMIT]: () => ({ body: { request: { state: "awaiting_quote_acceptance" } } }),
      [SESSION]: () => ({ body: { guestSession: { token: "MUST-NOT-MINT", expiresAt: "" } } }),
    });

    render(<SendFlow mode="live" productionStop="stop" />);

    await userEvent.click(await screen.findByRole("button", { name: "Continue to payment" }));

    // Real same-request recovery: the fresh total is on screen with the
    // reason it changed, and the payment CTA is back — not a dead end.
    await waitFor(() => expect(screen.getByText("Total: $13.99")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toMatch(/The price was refreshed/);
    expect(screen.queryByRole("alert")).toBeNull();

    expect(f.of(REFRESH)).toHaveLength(1);
    expect(f.of(REFRESH)[0].method).toBe("POST");
    expect(f.of(REFRESH)[0].body).toBeUndefined();
    expect(f.of(REFRESH)[0].headers[GUEST_HEADER]).toBe(GUEST_TOKEN);
    // Never a re-estimate from emptied local state, never a second request.
    expect(f.of(ESTIMATE)).toHaveLength(0);
    expect(f.of(SESSION)).toHaveLength(0);
    expect(f.of(SUBMIT)).toHaveLength(0);

    // And Quote N+1 is what gets paid.
    await userEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    const provider = await screen.findByTestId("elements-provider");
    expect(provider.getAttribute("data-client-secret")).toBe(SERVER_SECRET);
    expect(screen.getByRole("button", { name: "Authorize $13.99" })).toBeTruthy();
    expect(f.of(PAY)).toHaveLength(2);
    expect(f.of(SUBMIT)).toHaveLength(0);
  });

  it("a refresh that cannot re-price never claims a refreshed total", async () => {
    storeGuest();
    const f = installFetch({
      [REQUEST]: () => ({ body: awaitingView("awaiting_quote_acceptance") }),
      [PAY]: () => ({ status: 410, body: { error: "The quote expired.", code: "quote_expired" } }),
      [REFRESH]: () => ({
        status: 422,
        body: { error: "Couranr could not re-verify this trip.", code: "invalid_input" },
      }),
    });

    render(<SendFlow mode="live" productionStop="stop" />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue to payment" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not re-verify this trip/);
    expect(screen.queryByText(/The price was refreshed/)).toBeNull();
    expect(screen.queryByText(/^Total:/)).toBeNull();
    expect(f.of(SUBMIT)).toHaveLength(0);
    expect(f.of(ESTIMATE)).toHaveLength(0);
  });

  it("a first visit with no stored session makes no network call at all on load", async () => {
    const f = installFetch({});
    render(<SendFlow mode="live" productionStop="stop" />);
    // The intent choice renders; nothing resumed, nothing minted.
    expect(await screen.findByText("What do you need?")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).toHaveLength(0);
  });
});
