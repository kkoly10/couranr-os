import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * PUB-004 merchant-hosted flow (/request/[merchantSlug]) — TMZ-001 timing,
 * driven as the customer and then as the merchant would (jsdom is the
 * owner-approved stand-in for a browser drive until MVP completion).
 *
 * Customer side (HostedRequestFlow):
 *  - ASAP is the default and the submit body says so explicitly;
 *  - choosing "Schedule it" blocks submit until the words parse, and the body
 *    carries ONLY { intent, requestedPickupLocal } — never a zone or instant;
 *  - the governed cutoff copy is on screen, read from governed.ts;
 *  - the status card echoes the SERVER's understanding of the timing.
 *
 * Merchant side (HostedRequestValidationPanel):
 *  - the customer's requested timing is shown as evidence and pre-fills the
 *    confirmation controls, so an untouched validation confirms it unchanged;
 *  - the merchant may adjust; garbage blocks the button; the POST carries
 *    timingIntent + requestedPickupLocal alongside the other confirmed facts.
 *
 * Only the network (and the browser Supabase session for the merchant call)
 * is stubbed; the components are the real code. jest-dom is not loaded, so
 * button state is asserted through `.disabled`.
 */

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "merchant-jwt" } } }) },
  },
}));

import { HostedRequestFlow } from "@/components/couranr/hosted/HostedRequestFlow";
import { HostedRequestValidationPanel } from "@/components/couranr/requests/HostedRequestValidationPanel";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { SAME_DAY_CUTOFF_COPY } from "@/lib/couranr/public/governed";

const SLUG = "bloom";
const API = `/api/couranr/hosted/${SLUG}`;
const PLACES = `${API}/places`;
const SUBMIT = `${API}/submit`;
const REQUEST = `${API}/request`;
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const VALIDATE = `/api/couranr/delivery-requests/${REQUEST_ID}/validate-hosted`;

type Call = { path: string; method: string; body: unknown; headers: Record<string, string> };
function installFetch(handlers: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const merged: Record<string, (c: Call) => { status?: number; body: unknown }> = {
    [PLACES]: () => ({ body: { suggestions: [{ placeId: "pl-dest", text: "100 Main Street, Town, VA" }] } }),
    ...handlers,
  };
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : String(input?.url ?? input);
    const call: Call = {
      path: url.split("?")[0],
      method: init?.method ?? "GET",
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const h = merged[call.path];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: "unhandled" }) };
    const r = h(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return { calls, of: (p: string) => calls.filter((c) => c.path === p) };
}

const originalFetch = globalThis.fetch;
const btn = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

/**
 * The GET /request route: "nothing submitted yet" until the submit lands, then
 * the status view with the SERVER's timing echo — exactly the two answers a
 * returning visitor's browser sees.
 */
function requestRoute(timing: Record<string, unknown>) {
  let submitted = false;
  return {
    [SUBMIT]: () => {
      submitted = true;
      return { body: { requestState: "awaiting_merchant_confirmation" } };
    },
    [REQUEST]: () =>
      submitted
        ? {
            body: {
              submitted: true,
              requestState: "awaiting_merchant_confirmation",
              quoteStatus: "not_quoted",
              merchantValidated: false,
              paymentPending: false,
              terminal: false,
              timing,
            },
          }
        : {
            body: {
              submitted: false,
              requestState: null,
              quoteStatus: null,
              merchantValidated: false,
              paymentPending: false,
              terminal: false,
              timing: null,
            },
          },
  };
}

async function fillCustomerForm() {
  render(<HostedRequestFlow merchantName="Bloom" merchantSlug={SLUG} />);
  await userEvent.type(screen.getByLabelText(/Delivery destination/), "100 Main");
  await userEvent.click(await screen.findByRole("option", { name: /100 Main Street/ }));
  await userEvent.type(screen.getByLabelText(/Recipient name/), "Rae Recipient");
  await userEvent.type(screen.getByLabelText(/^Phone/), "+15715550188");
  await userEvent.type(screen.getByLabelText(/Describe the order/), "one boxed lamp");
}

describe("hosted customer flow — TMZ-001 timing", () => {
  beforeEach(() => {
    // A live intake session, as a returning visitor's browser would hold it.
    window.sessionStorage.setItem(`couranr-hosted-request:${SLUG}`, "hosted-intake-token");
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("ASAP is the default, is stated EXPLICITLY on the wire, and is echoed back from the server", async () => {
    const f = installFetch(
      requestRoute({ intent: "asap", requestedPickupLocal: null, requestedDepartureAt: null, reviewReasons: [] })
    );
    await fillCustomerForm();
    // The governed choice is offered with MKT-005 copy; ASAP is selected.
    const timing = screen.getByLabelText(/Pickup timing/) as HTMLSelectElement;
    expect(timing.value).toBe("asap");
    expect(screen.getByText(SEND_COPY.timing_live_note)).toBeTruthy();
    expect(btn(/Send request to Bloom/).disabled).toBe(false);
    await userEvent.click(btn(/Send request to Bloom/));

    await waitFor(() => expect(f.of(SUBMIT)).toHaveLength(1));
    const sent = JSON.parse(String(f.of(SUBMIT)[0].body));
    expect(sent.timing).toEqual({ intent: "asap", requestedPickupLocal: null });
    expect(f.of(SUBMIT)[0].headers["x-couranr-hosted-request"]).toBe("hosted-intake-token");
    // The status card echoes what Couranr understood.
    await screen.findByText(SEND_COPY.timing_asap);
    expect(document.querySelector('[data-couranr-hosted-timing="true"]')).not.toBeNull();
  });

  it("a scheduled pickup needs parseable Eastern local words; only the words leave the browser; the server echo names the review", async () => {
    const f = installFetch(
      requestRoute({
        intent: "scheduled",
        requestedPickupLocal: "2027-03-10T10:30",
        requestedDepartureAt: "2027-03-10T15:30:00+00:00",
        reviewReasons: ["requested_time_on_non_business_day"],
      })
    );
    await fillCustomerForm();
    await userEvent.selectOptions(screen.getByLabelText(/Pickup timing/), "scheduled");
    // No time yet: blocked. The governed cutoff copy is on screen.
    expect(btn(/Send request to Bloom/).disabled).toBe(true);
    expect(screen.getByText(new RegExp(SAME_DAY_CUTOFF_COPY.replace(/[.:]/g, "\\$&")))).toBeTruthy();
    const when = screen.getByLabelText(/Requested pickup time/) as HTMLInputElement;
    fireEvent.change(when, { target: { value: "tomorrow" } });
    expect(btn(/Send request to Bloom/).disabled).toBe(true);
    fireEvent.change(when, { target: { value: "2027-03-10T10:30" } });
    await waitFor(() => expect(btn(/Send request to Bloom/).disabled).toBe(false));
    await userEvent.click(btn(/Send request to Bloom/));

    await waitFor(() => expect(f.of(SUBMIT)).toHaveLength(1));
    const sent = JSON.parse(String(f.of(SUBMIT)[0].body));
    expect(sent.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
    // Only the customer's words left the browser: no zone, no instant, no reasons.
    expect(JSON.stringify(sent)).not.toMatch(/requestedDepartureAt|America\/New_York|reviewReasons|operatingTimezone/);
    // The echo is the SERVER's understanding, and the review is named — no promise of a time.
    await screen.findByText(`${SEND_COPY.timing_schedule}: 2027-03-10 10:30 (Eastern)`);
    expect(screen.getByText(/Couranr will confirm this pickup time/)).toBeTruthy();
  });
});

describe("hosted merchant validation panel — TMZ-001 timing", () => {
  const request = (timing: { timingIntent: string | null; requestedPickupLocal: string | null }) =>
    ({
      id: REQUEST_ID,
      source: "hosted_request",
      requestState: "awaiting_merchant_confirmation",
      version: 1,
      payerType: "customer",
      weightBand: "0_25_lb",
      signatureRequired: false,
      ...timing,
    }) as any;
  const context = (timing: { customerTimingIntent: "asap" | "scheduled" | null; customerRequestedPickupLocal: string | null }) => ({
    orderReference: "ORDER-42",
    requestedPayerType: "customer" as const,
    destinationLabel: "100 Main Street, Town, VA",
    shipmentDescription: "one boxed lamp",
    customerPackageCount: 1,
    pickupManifestVersion: 0,
    customerWeightLb: null,
    customerWeightBand: "0_25_lb",
    customerRestrictedClass: "none",
    signatureRequested: false,
    ...timing,
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("shows the customer's requested schedule as evidence, pre-fills the confirmation, and the merchant may adjust it", async () => {
    const f = installFetch({ [VALIDATE]: () => ({ body: { request: { id: REQUEST_ID, version: 2 } } }) });
    const onChanged = vi.fn();
    render(
      <HostedRequestValidationPanel
        request={request({ timingIntent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" })}
        context={context({ customerTimingIntent: "scheduled", customerRequestedPickupLocal: "2027-03-10T10:30" })}
        businessAccountId="22222222-2222-4222-8222-222222222222"
        canValidate
        onChanged={onChanged}
      />
    );
    expect(document.querySelector('[data-couranr-customer-timing="true"]')?.textContent).toBe(
      "Scheduled: 2027-03-10 10:30 (Eastern)"
    );
    const intent = screen.getByLabelText(/Pickup timing/) as HTMLSelectElement;
    const when = screen.getByLabelText(/Requested pickup time/) as HTMLInputElement;
    expect(intent.value).toBe("scheduled");
    expect(when.value).toBe("2027-03-10T10:30");
    expect(screen.getByText(new RegExp(SAME_DAY_CUTOFF_COPY.replace(/[.:]/g, "\\$&")))).toBeTruthy();

    await userEvent.click(screen.getByLabelText(/I verified the pickup description/));
    const validate = () => btn(/Validate request/);
    await waitFor(() => expect(validate().disabled).toBe(false));
    // Garbage blocks; an adjusted valid time re-enables.
    fireEvent.change(when, { target: { value: "noon" } });
    expect(validate().disabled).toBe(true);
    fireEvent.change(when, { target: { value: "2027-03-10T11:00" } });
    await waitFor(() => expect(validate().disabled).toBe(false));
    await userEvent.click(validate());

    await waitFor(() => expect(f.of(VALIDATE)).toHaveLength(1));
    const sent = JSON.parse(String(f.of(VALIDATE)[0].body));
    expect(sent.timingIntent).toBe("scheduled");
    expect(sent.requestedPickupLocal).toBe("2027-03-10T11:00");
    expect(sent.expectedVersion).toBe(1);
    expect(f.of(VALIDATE)[0].headers.authorization).toBe("Bearer merchant-jwt");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("an ASAP customer statement pre-fills ASAP and is confirmed as ASAP, with no time control shown", async () => {
    const f = installFetch({ [VALIDATE]: () => ({ body: { request: { id: REQUEST_ID, version: 2 } } }) });
    render(
      <HostedRequestValidationPanel
        request={request({ timingIntent: "asap", requestedPickupLocal: null })}
        context={context({ customerTimingIntent: "asap", customerRequestedPickupLocal: null })}
        businessAccountId="22222222-2222-4222-8222-222222222222"
        canValidate
        onChanged={vi.fn()}
      />
    );
    expect(document.querySelector('[data-couranr-customer-timing="true"]')?.textContent).toBe("As soon as possible");
    expect((screen.getByLabelText(/Pickup timing/) as HTMLSelectElement).value).toBe("asap");
    expect(screen.queryByLabelText(/Requested pickup time/)).toBeNull();
    await userEvent.click(screen.getByLabelText(/I verified the pickup description/));
    await userEvent.click(btn(/Validate request/));
    await waitFor(() => expect(f.of(VALIDATE)).toHaveLength(1));
    const sent = JSON.parse(String(f.of(VALIDATE)[0].body));
    expect(sent.timingIntent).toBe("asap");
    expect(sent.requestedPickupLocal).toBeNull();
  });
});
