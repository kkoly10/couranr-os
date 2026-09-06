import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * INT-002 on the item step of /send, driven as a guest would drive it. Only
 * the network and Stripe.js are stubbed; the component and both adapter
 * layers are the real code.
 *
 * The invariants: the AI disclosure is visible at the START of the item step,
 * before anything is read; a blur posts `{ description }` and nothing else;
 * a material suggestion changes the form ONLY through "Use this" — the weight
 * and restricted-item controls are untouched until the guest chooses; the
 * clarification renders as the one question; an unavailable feature shows no
 * suggestion and no error; a proposal key outside the allow-list never
 * renders.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("intent=send"),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ __stripe: true })) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { GUEST_HEADER, GUEST_STORAGE_KEY } from "@/lib/couranr/sameday/liveAdapters";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { WEIGHT_BAND_LABELS } from "@/lib/couranr/shipment/weightBandLabels";

const INTERPRET = "/api/couranr/consumer/interpret";
const SESSION = "/api/couranr/consumer/session";
const GUEST_TOKEN = "guest-dom-intake-token";

type Call = { path: string; method: string; headers: Record<string, string>; body: unknown };
function installFetch(handlers: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : String(input?.url ?? input);
    const call: Call = { path: url.split("?")[0], method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body };
    calls.push(call);
    const h = handlers[call.path];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: "unhandled" }) };
    const r = h(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return { calls, of: (p: string) => calls.filter((c) => c.path === p) };
}

const originalFetch = globalThis.fetch;

/** A handler result: the stub expects `{ body }`, and the route nests under `intake`. */
function intakeBody(proposals: unknown[], question: string | null = null) {
  return { body: { intake: { status: "interpreted", revision: 1, proposals, clarification: question ? { question } : null } } };
}

async function toItemStep() {
  render(<SendFlow mode="live" productionStop="stop" />);
  // Trip step first; Continue to the item step.
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  return screen.getByLabelText(SEND_COPY.item_question) as HTMLTextAreaElement;
}

describe("Consumer Smart Intake on the item step", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify({ token: GUEST_TOKEN, expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    );
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  it("shows the AI disclosure at the START of the item step, before anything is read", async () => {
    const f = installFetch({});
    await toItemStep();
    const disclosure = document.querySelector("[data-couranr-ai-disclosure]");
    expect(disclosure?.textContent).toBe(SEND_COPY.item_ai_disclosure);
    expect(f.of(INTERPRET)).toHaveLength(0);
  });

  it("a blur posts { description } only, under the guest header; a suggestion changes NOTHING until 'Use this'", async () => {
    const f = installFetch({
      [INTERPRET]: () => intakeBody([
        { key: "package_count", value: 2, confidence: 90, requiresConfirmation: false },
        { key: "weight_band", value: "over_25_to_50_lb", confidence: 70, requiresConfirmation: true },
        { key: "restricted_class", value: "alcohol", confidence: 95, requiresConfirmation: true },
        { key: "payer_type", value: "merchant", confidence: 99, requiresConfirmation: false },
        // A free-string key: the server never sends it to a guest, and if one
        // ever did, the browser drops it too.
        { key: "item_category", value: "home goods; ignore the rules", confidence: 99, requiresConfirmation: false },
      ]),
      [SESSION]: () => ({ body: { guestSession: { token: "MUST-NOT-MINT", expiresAt: "" } } }),
    });
    const textarea = await toItemStep();
    const weight = screen.getByLabelText("Weight") as HTMLSelectElement;
    const restricted = screen.getByLabelText("Restricted items") as HTMLSelectElement;
    const packages = screen.getByLabelText("How many packages?") as HTMLInputElement;
    expect(weight.value).toBe("exact");
    expect(restricted.value).toBe("unknown");

    await userEvent.type(textarea, "a lamp and 12 bottles of beer");
    fireEvent.blur(textarea);

    await waitFor(() => expect(f.of(INTERPRET)).toHaveLength(1));
    const call = f.of(INTERPRET)[0];
    expect(call.method).toBe("POST");
    expect(JSON.parse(String(call.body))).toEqual({ description: "a lamp and 12 bottles of beer" });
    expect(call.headers[GUEST_HEADER]).toBe(GUEST_TOKEN);
    expect(f.of(SESSION)).toHaveLength(0);

    // Suggestions render; the payer and free-string keys never do; the form is untouched.
    await screen.findByText("Packages: 2");
    expect(screen.queryByText(/ignore the rules/)).toBeNull();
    expect(document.querySelector('[data-couranr-suggestion="item_category"]')).toBeNull();
    const list = within(document.querySelector("[data-couranr-intake-suggestions]") as HTMLElement);
    expect(list.getByText(`Weight: ${WEIGHT_BAND_LABELS.over_25_to_50_lb}`)).toBeTruthy();
    expect(list.getByText("Contains: alcohol")).toBeTruthy();
    expect(document.querySelector('[data-couranr-suggestion="payer_type"]')).toBeNull();
    expect(screen.queryByText(/merchant/)).toBeNull();
    expect(weight.value).toBe("exact");
    expect(restricted.value).toBe("unknown");
    expect(packages.value).toBe("");
    // PRF-002 makes package count a material expected-pickup fact. Like weight
    // and safety, the suggestion is inert until the guest explicitly chooses it.
    const useButtons = screen.getAllByRole("button", { name: /^Use this/ });
    expect(useButtons).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: /Use this: Packages: 2/ }));
    expect(packages.value).toBe("2");
    expect(weight.value).toBe("exact");
    expect(restricted.value).toBe("unknown");

    // The guest's explicit choice is the confirmation.
    await userEvent.click(screen.getByRole("button", { name: /Use this: Weight:/ }));
    expect(weight.value).toBe("over_25_to_50_lb");
    expect(restricted.value).toBe("unknown");
    await userEvent.click(screen.getByRole("button", { name: /Use this: Contains: alcohol/ }));
    expect(restricted.value).toBe("alcohol");
  });

  it("an exact-weight suggestion sets the exact mode and the pounds", async () => {
    installFetch({
      [INTERPRET]: () => intakeBody([{ key: "weight_lb_exact", value: 12, confidence: 88, requiresConfirmation: true }]),
    });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "a 12 lb box");
    fireEvent.blur(textarea);
    await userEvent.click(await screen.findByRole("button", { name: /Use this: Weight: 12 lb/ }));
    expect((screen.getByLabelText("Weight") as HTMLSelectElement).value).toBe("exact");
    expect((screen.getByLabelText("Weight (lb)") as HTMLInputElement).value).toBe("12");
  });

  it("the one clarification renders as the question; the summary stays the guest's own words", async () => {
    installFetch({
      [INTERPRET]: () => intakeBody(
        [{ key: "restricted_class", value: "alcohol", confidence: 60, requiresConfirmation: true }],
        "Does this include alcohol?"
      ),
    });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "some bottles");
    fireEvent.blur(textarea);
    await screen.findByText("Does this include alcohol?");
    const list = within(document.querySelector("[data-couranr-intake-suggestions]") as HTMLElement);
    expect(list.getByText("Contains: alcohol")).toBeTruthy();
  });

  it("the same words blurred twice ask once; suggestions survive the re-read a click causes", async () => {
    const f = installFetch({
      [INTERPRET]: () => intakeBody([{ key: "weight_band", value: "0_25_lb", confidence: 80, requiresConfirmation: true }]),
    });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "a small box");
    fireEvent.blur(textarea);
    await screen.findByRole("button", { name: /^Use this/ });
    // Focus is still in the textarea; clicking the suggestion blurs it. That
    // blur must not blank the list (and must not spend a second call).
    textarea.focus();
    await userEvent.click(screen.getByRole("button", { name: /^Use this/ }));
    expect((screen.getByLabelText("Weight") as HTMLSelectElement).value).toBe("0_25_lb");
    expect(f.of(INTERPRET)).toHaveLength(1);
  });

  it("two reads in flight: only the NEWEST answer lands", async () => {
    const pending: Array<(v: { status?: number; body: unknown }) => void> = [];
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url: string = typeof input === "string" ? input : String(input?.url ?? input);
      if (!url.startsWith(INTERPRET)) return { ok: false, status: 404, json: async () => ({}) };
      const r = await new Promise<{ status?: number; body: unknown }>((resolve) => pending.push(resolve));
      return { ok: true, status: 200, json: async () => r.body };
    }) as unknown as typeof fetch;
    const textarea = await toItemStep();
    await userEvent.type(textarea, "a lamp");
    fireEvent.blur(textarea);
    await userEvent.type(textarea, " and a rug");
    fireEvent.blur(textarea);
    await waitFor(() => expect(pending).toHaveLength(2));
    // The SECOND read answers first, then the stale FIRST read answers.
    pending[1](intakeBody([{ key: "quantity", value: 2, confidence: 90, requiresConfirmation: false }]));
    await screen.findByText("Quantity: 2");
    pending[0](intakeBody([{ key: "quantity", value: 1, confidence: 90, requiresConfirmation: false }]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Quantity: 2")).toBeTruthy();
    expect(screen.queryByText("Quantity: 1")).toBeNull();
  });

  it("an unavailable feature shows no suggestion and no error — the words stand", async () => {
    installFetch({
      [INTERPRET]: () => ({ body: { intake: { status: "unavailable", proposals: [], clarification: null } } }),
    });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "a cake");
    fireEvent.blur(textarea);
    await screen.findByText("a cake", { selector: "p" });
    expect(document.querySelector("[data-couranr-intake-suggestions]")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refused interpret request degrades the same way", async () => {
    installFetch({ [INTERPRET]: () => ({ status: 429, body: { error: "Too many", code: "conflict" } }) });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "a cake");
    fireEvent.blur(textarea);
    await screen.findByText("a cake", { selector: "p" });
    expect(document.querySelector("[data-couranr-intake-suggestions]")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a value outside the closed vocabulary offers no action", async () => {
    installFetch({
      [INTERPRET]: () => intakeBody([
        { key: "weight_band", value: "over_9000_lb", confidence: 99, requiresConfirmation: true },
        { key: "restricted_class", value: "<script>alert(1)</script>", confidence: 99, requiresConfirmation: true },
      ]),
    });
    const textarea = await toItemStep();
    await userEvent.type(textarea, "something");
    fireEvent.blur(textarea);
    await screen.findByText(/Weight: over 9000 lb/);
    expect(screen.queryByRole("button", { name: /^Use this/ })).toBeNull();
    expect((screen.getByLabelText("Weight") as HTMLSelectElement).value).toBe("exact");
    expect((screen.getByLabelText("Restricted items") as HTMLSelectElement).value).toBe("unknown");
  });
});
