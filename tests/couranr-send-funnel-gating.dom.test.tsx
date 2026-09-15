import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * PUB-004 consumer /send — funnel activation gating, driven as a guest would.
 *
 * The invariants this guards, all in `live` mode against a stubbed consumer API:
 *  - free text cannot proceed: both canonical addresses must be SELECTED before
 *    leaving the trip step;
 *  - the estimate is requested EXPLICITLY and only after contact exists — no
 *    known-invalid estimate fired first and retried on blur;
 *  - the displayed price is the SERVER's number, echoed;
 *  - a stale quote (an input changed after pricing) blocks progression to
 *    payment;
 *  - a manual-review quote is a non-payable submit-for-review path;
 *  - optional AI (interpret) is never required to reach a payable price.
 *
 * Only the network and Stripe.js are stubbed; the component and both adapter
 * layers are the real code. (jest-dom is not loaded here, so button state is
 * asserted through the `.disabled` property.)
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ __stripe: true })) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { GUEST_STORAGE_KEY } from "@/lib/couranr/sameday/liveAdapters";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { SAME_DAY_CUTOFF_COPY } from "@/lib/couranr/public/governed";

const API = "/api/couranr/consumer";
const PLACES = `${API}/places`;
const ESTIMATE = `${API}/estimate`;
const MANIFEST = `${API}/pickup-manifest`;
const READINESS = `${API}/readiness`;
const INTERPRET = `${API}/interpret`;
const GUEST_TOKEN = "guest-funnel-token";

type Call = { path: string; method: string; body: unknown };
function installFetch(handlers: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const merged: Record<string, (c: Call) => { status?: number; body: unknown }> = {
    [PLACES]: () => ({ body: { suggestions: [{ placeId: "pl-1", text: "100 Main Street, Town, VA" }] } }),
    [MANIFEST]: () => ({ body: { pickupManifest: { manifestVersion: 1, manifest: {} } } }),
    [READINESS]: () => ({ body: { readiness: { state: "ready" } } }),
    ...handlers,
  };
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : String(input?.url ?? input);
    const call: Call = { path: url.split("?")[0], method: init?.method ?? "GET", body: init?.body };
    calls.push(call);
    const h = merged[call.path];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: "unhandled" }) };
    const r = h(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return { calls, of: (p: string) => calls.filter((c) => c.path === p) };
}

const ESTIMATED = (totalCents: number) => ({
  body: {
    estimate: {
      requestId: "req-funnel-1",
      quoteStatus: "estimated",
      pickupManifestVersion: 0,
      totalCents,
      reviewReasons: [],
      quoteVersionId: "qv-1",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    },
  },
});
const REVIEW = () => ({
  body: {
    estimate: {
      requestId: "req-funnel-2",
      quoteStatus: "manual_review_required",
      pickupManifestVersion: 0,
      totalCents: null,
      reviewReasons: ["weight_unresolved"],
    },
  },
});

const originalFetch = globalThis.fetch;

const btn = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

async function selectAddress(inputId: string) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  await userEvent.clear(input);
  await userEvent.type(input, "100 Main");
  await userEvent.click(await screen.findByRole("option", { name: /100 Main Street/ }));
}

/** Everything the estimate needs from the review step, V1 contract. */
async function fillSenderAndRecipient() {
  await userEvent.type(screen.getByLabelText("Mobile"), "+15715550100");
  await userEvent.type(screen.getByLabelText("Email"), "sender@example.test");
  await userEvent.type(screen.getByLabelText("Recipient name"), "Dana Reyes");
  await userEvent.type(screen.getByLabelText("Recipient email"), "dana@example.test");
}

async function driveToReviewStep() {
  render(<SendFlow mode="live" />);
  await userEvent.click(btn(/Send something I have/));
  await selectAddress("send-pickup");
  await selectAddress("send-destination");
  await userEvent.click(btn("Continue")); // trip -> item
  await userEvent.type(screen.getByLabelText(SEND_COPY.item_question), "a birthday cake");
  await userEvent.type(screen.getByLabelText("Weight (lb)"), "8");
  await userEvent.selectOptions(screen.getByLabelText("Restricted items"), "none");
  await userEvent.click(screen.getByLabelText(/ready to hand over/i));
  // V1: the item step will not advance without a readable declared value —
  // the protection level is derived from it and the draft stores both.
  await userEvent.type(screen.getByLabelText(SEND_COPY.declared_value_label), "20");
  await userEvent.click(btn("Continue")); // item -> timing
  await userEvent.click(screen.getByLabelText(SEND_COPY.timing_asap));
  await userEvent.click(btn("Continue")); // timing -> review
}

describe("consumer /send funnel gating", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify({ token: GUEST_TOKEN, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    );
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  it("free text cannot proceed: the trip Continue needs BOTH selected Place IDs", async () => {
    installFetch({});
    render(<SendFlow mode="live" />);
    await userEvent.click(btn(/Send something I have/));
    expect(btn("Continue").disabled).toBe(true);
    // Free text without choosing a suggestion — still blocked.
    await userEvent.type(document.getElementById("send-pickup") as HTMLInputElement, "just some words");
    expect(btn("Continue").disabled).toBe(true);
    // Select pickup only — still blocked (one address is not a trip).
    await selectAddress("send-pickup");
    expect(btn("Continue").disabled).toBe(true);
    // Select the destination too — now enabled.
    await selectAddress("send-destination");
    await waitFor(() => expect(btn("Continue").disabled).toBe(false));
  });

  it("the estimate fires only after contact, shows the SERVER price, and works with AI off", async () => {
    // Optional AI is OFF/failing here (interpret 500s). The delivery must still
    // be orderable with no model in the loop.
    const f = installFetch({
      [ESTIMATE]: () => ESTIMATED(1234),
      [INTERPRET]: () => ({ status: 500, body: { error: "intake disabled" } }),
    });
    await driveToReviewStep();

    // No estimate yet, and the price request is BLOCKED until contact exists.
    expect(f.of(ESTIMATE)).toHaveLength(0);
    expect(btn(/Check the price/).disabled).toBe(true);

    // A mobile alone no longer opens it: V1 is EMAIL-FIRST and the recipient is
    // required, because the tracking link and any claim travel by email.
    await userEvent.type(screen.getByLabelText("Mobile"), "+15715550100");
    expect(btn(/Check the price/).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Email"), "sender@example.test");
    expect(btn(/Check the price/).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Recipient name"), "Dana Reyes");
    expect(btn(/Check the price/).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Recipient email"), "dana@example.test");
    await waitFor(() => expect(btn(/Check the price/).disabled).toBe(false));
    await userEvent.click(btn(/Check the price/));

    // Exactly one estimate, and the SERVER's number is shown despite the failing
    // interpret feature — AI is enrichment, never a gate on ordering.
    await waitFor(() => expect(f.of(ESTIMATE)).toHaveLength(1));
    await screen.findByText("Total: $12.34");

    // Payment progression needs the acknowledgement AND a proceedable quote.
    expect(btn("Continue to payment").disabled).toBe(true);
    /* BOTH acknowledgements, and neither of them gated the price above — the
       estimate creates a draft, and the database exempts a draft from
       couranr_dr_consumer_acceptance_chk for the same reason. */
    await userEvent.click(screen.getByLabelText(SEND_COPY.acknowledgement));
    expect(btn("Continue to payment").disabled).toBe(true);
    await userEvent.click(screen.getByLabelText(SEND_COPY.electronic_consent));
    await waitFor(() => expect(btn("Continue to payment").disabled).toBe(false));
  });

  it("a stale quote (an input changed after pricing) blocks progression to payment", async () => {
    installFetch({ [ESTIMATE]: () => ESTIMATED(1234) });
    await driveToReviewStep();
    await fillSenderAndRecipient();
    await userEvent.click(btn(/Check the price/));
    await screen.findByText("Total: $12.34");
    /* BOTH acknowledgements, and neither of them gated the price above — the
       estimate creates a draft, and the database exempts a draft from
       couranr_dr_consumer_acceptance_chk for the same reason. */
    await userEvent.click(screen.getByLabelText(SEND_COPY.acknowledgement));
    expect(btn("Continue to payment").disabled).toBe(true);
    await userEvent.click(screen.getByLabelText(SEND_COPY.electronic_consent));
    await waitFor(() => expect(btn("Continue to payment").disabled).toBe(false));

    // Changing a quote input (contact here) stales the standing quote.
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await screen.findByText(/You changed the trip/);
    expect(btn("Continue to payment").disabled).toBe(true);
  });

  it("a manual-review quote is a non-payable submit-for-review path, not a fake price", async () => {
    installFetch({ [ESTIMATE]: () => REVIEW() });
    await driveToReviewStep();
    await fillSenderAndRecipient();
    await userEvent.click(btn(/Check the price/));
    await waitFor(() =>
      expect(document.querySelector('[data-couranr-quote="manual-review"]')).not.toBeNull(),
    );
    // No fabricated total is shown.
    expect(screen.queryByText(/^Total:/)).toBeNull();
    await userEvent.click(screen.getByLabelText(SEND_COPY.acknowledgement));
    await userEvent.click(screen.getByLabelText(SEND_COPY.electronic_consent));
    // The action is a review submission, not a payment.
    await waitFor(() => expect(btn("Continue to Couranr review").disabled).toBe(false));
  });

  it("discloses what the declared value changes about handling, as it is typed", async () => {
    /* PROGRESSIVE DISCLOSURE. The sender is told what their declared value
       changes about how the shipment is handled AT THE MOMENT THEY ENTER IT —
       not after they have paid, and not in terms accepted sight unseen. The
       level is derived by the same function the server and the database use, so
       what the form promises and what the driver is instructed to do cannot
       become two different answers.

       The band edges are asserted at CENT precision because that is how the
       owner decision is written: $30.01 begins secure pickup. */
    installFetch({});
    render(<SendFlow mode="live" />);
    await userEvent.click(btn(/Send something I have/));
    await selectAddress("send-pickup");
    await selectAddress("send-destination");
    await userEvent.click(btn("Continue"));
    await userEvent.type(screen.getByLabelText(SEND_COPY.item_question), "a watch");
    await userEvent.type(screen.getByLabelText("Weight (lb)"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Restricted items"), "none");
    await userEvent.click(screen.getByLabelText(/ready to hand over/i));

    const value = screen.getByLabelText(SEND_COPY.declared_value_label) as HTMLInputElement;
    const level = () =>
      document.querySelector("[data-couranr-protection]")?.getAttribute("data-couranr-protection");

    // Nothing stated yet: no level, and the step will not advance. An unstated
    // value is NOT a $0 shipment.
    expect(level()).toBe("none");
    expect(btn("Continue").disabled).toBe(true);

    for (const [dollars, want, copy] of [
      ["30.00", "standard", SEND_COPY.protection_standard],
      ["30.01", "secure_pickup", SEND_COPY.protection_secure_pickup],
      ["150.00", "secure_pickup", SEND_COPY.protection_secure_pickup],
      ["150.01", "protected_handoff", SEND_COPY.protection_protected_handoff],
      ["500.00", "protected_handoff", SEND_COPY.protection_protected_handoff],
    ] as const) {
      fireEvent.change(value, { target: { value: dollars } });
      expect(level(), `$${dollars}`).toBe(want);
      expect(screen.getByText(copy)).toBeTruthy();
      expect(btn("Continue").disabled, `$${dollars} should advance`).toBe(false);
    }

    // Over the ceiling: refused, with the ceiling named, and the step blocked.
    fireEvent.change(value, { target: { value: "500.01" } });
    expect(level()).toBe("none");
    expect(btn("Continue").disabled).toBe(true);
    expect(screen.getByText(new RegExp(`${SEND_COPY.declared_value_max_note}\\s+\\$500\\.00`))).toBeTruthy();

    // Unreadable input is refused too, rather than coerced to zero — coercion
    // would route a $500 item onto the standard path with no seal.
    for (const bad of ["abc", "-5", "20.005", "1e3"]) {
      fireEvent.change(value, { target: { value: bad } });
      expect(level(), bad).toBe("none");
      expect(btn("Continue").disabled, bad).toBe(true);
    }
  });

  it("a scheduled pickup needs valid Eastern local words to continue, and the estimate carries them (TMZ-001)", async () => {
    const f = installFetch({ [ESTIMATE]: () => ESTIMATED(1234) });
    render(<SendFlow mode="live" />);
    await userEvent.click(btn(/Send something I have/));
    await selectAddress("send-pickup");
    await selectAddress("send-destination");
    await userEvent.click(btn("Continue")); // -> item
    await userEvent.type(screen.getByLabelText(SEND_COPY.item_question), "a cake");
    await userEvent.type(screen.getByLabelText("Weight (lb)"), "8");
    await userEvent.selectOptions(screen.getByLabelText("Restricted items"), "none");
    await userEvent.click(screen.getByLabelText(/ready to hand over/i));
    // The item step will not advance without a readable declared value.
    await userEvent.type(screen.getByLabelText(SEND_COPY.declared_value_label), "20");
    await userEvent.click(btn("Continue")); // -> timing

    // Both governed intents are offered; choose a scheduled pickup.
    expect(screen.getByLabelText(SEND_COPY.timing_asap)).toBeTruthy();
    await userEvent.click(screen.getByLabelText(SEND_COPY.timing_schedule));
    // No time yet: blocked. The governed cutoff copy is on screen.
    expect(btn("Continue").disabled).toBe(true);
    expect(screen.getByText(new RegExp(SAME_DAY_CUTOFF_COPY.replace(/[.:]/g, "\\$&")))).toBeTruthy();
    const when = screen.getByLabelText("Requested pickup time") as HTMLInputElement;
    // Garbage cannot advance; valid local words can.
    fireEvent.change(when, { target: { value: "tomorrow" } });
    expect(btn("Continue").disabled).toBe(true);
    fireEvent.change(when, { target: { value: "2027-03-10T10:30" } });
    await waitFor(() => expect(btn("Continue").disabled).toBe(false));
    await userEvent.click(btn("Continue")); // -> review
    expect(screen.getByText(/Schedule it: 2027-03-10 10:30 \(Eastern\)/)).toBeTruthy();

    await fillSenderAndRecipient();
    await userEvent.click(btn(/Check the price/));
    await waitFor(() => expect(f.of(ESTIMATE)).toHaveLength(1));
    const sent = JSON.parse(String(f.of(ESTIMATE)[0].body));
    expect(sent.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
    // Only the sender's words left the browser: no zone, no instant.
    expect(JSON.stringify(sent)).not.toMatch(/requestedDepartureAt|America\/New_York/);
    await screen.findByText("Total: $12.34");
  });
});
