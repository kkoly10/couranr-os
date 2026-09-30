import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const fetchMyBusinessAccounts = vi.fn();
const createDeliveryRequest = vi.fn();
const fetchDeliveryRequest = vi.fn();
const fetchRouteRun = vi.fn();
const saveBusinessPickupManifest = vi.fn();
const recordBusinessDeclaredValue = vi.fn();
const saveRouteRunDraft = vi.fn();
const acceptRouteRun = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/couranr/requests/BusinessPlaceAutocomplete", () => ({
  BusinessPlaceAutocomplete: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onChange({
        googlePlaceId: crypto.randomUUID(),
        formattedAddress: "100 Route Test Rd, Stafford, VA 22554",
        line1: "100 Route Test Rd",
        line2: null,
        city: "Stafford",
        region: "VA",
        postalCode: "22554",
        country: "US",
        lat: 38.4,
        lng: -77.4,
      })}
    >
      Choose fake address
    </button>
  ),
}));

vi.mock("@/components/couranr/requests/client", () => ({
  fetchMyBusinessAccounts: (...args: unknown[]) => fetchMyBusinessAccounts(...args),
  createDeliveryRequest: (...args: unknown[]) => createDeliveryRequest(...args),
  fetchDeliveryRequest: (...args: unknown[]) => fetchDeliveryRequest(...args),
  saveBusinessPickupManifest: (...args: unknown[]) => saveBusinessPickupManifest(...args),
  newIdempotencyKey: () => crypto.randomUUID(),
  isApiFailure: (value: { ok: boolean }) => value.ok === false,
  withReference: (value: { error?: string }) => value.error ?? "Request failed.",
}));

vi.mock("@/components/couranr/routes/client", () => ({
  recordBusinessDeclaredValue: (...args: unknown[]) => recordBusinessDeclaredValue(...args),
  saveRouteRunDraft: (...args: unknown[]) => saveRouteRunDraft(...args),
  fetchRouteRun: (...args: unknown[]) => fetchRouteRun(...args),
  acceptRouteRun: (...args: unknown[]) => acceptRouteRun(...args),
}));

const { RouteBuilder } = await import("@/components/couranr/routes/RouteBuilder");

const BIZ = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "33333333-3333-4333-8333-333333333333";
const ROUTE = "44444444-4444-4444-8444-444444444444";

function account(role = "owner") {
  return {
    ok: true,
    value: { businessAccounts: [{ businessAccountId: BIZ, name: "Route Shop", role }] },
  };
}

function delivery(id: string, subtotal: number, input: Record<string, unknown>) {
  return {
    ...input,
    id,
    businessAccountId: BIZ,
    requestState: "draft",
    payerType: "merchant",
    singleDestinationContract: true,
    version: 1,
    currentQuoteVersionId: id,
    quote: { deliverySubtotalCents: subtotal },
  };
}

function routeDraft() {
  return {
    routeRunId: ROUTE,
    businessAccountId: BIZ,
    state: "draft",
    version: 1,
    currentVersion: 1,
    title: "Friday local orders",
    draftOnly: true,
    bookingAvailable: false,
    executionAvailable: false,
    stopCount: 2,
    referenceQuoteTotalCents: 4000,
    quoteBasis: "independent_delivery_quotes_not_a_route_offer",
    acceptedVersion: null,
    acceptedAt: null,
    abandonedAt: null,
    stops: [
      { sequence: 1, requestId: R1, quoteVersionId: R1, requestVersion: 2, pickupManifestVersion: 1, stale: false, claimed: false },
      { sequence: 2, requestId: R2, quoteVersionId: R2, requestVersion: 2, pickupManifestVersion: 1, stale: false, claimed: false },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  fetchMyBusinessAccounts.mockResolvedValue(account());
  let created = 0;
  createDeliveryRequest.mockImplementation(({ request }: { request: Record<string, unknown> }) => {
    const id = created++ === 0 ? R1 : R2;
    return Promise.resolve({ ok: true, value: { request: delivery(id, id === R1 ? 1800 : 2200, request) } });
  });
  saveBusinessPickupManifest.mockResolvedValue({
    ok: true,
    value: { pickupManifest: { manifestVersion: 1 } },
  });
  recordBusinessDeclaredValue
    .mockResolvedValueOnce({ ok: true, value: { requestId: R1, version: 2, declaredValueCents: 10000, protectionLevel: "secure_pickup" } })
    .mockResolvedValueOnce({ ok: true, value: { requestId: R2, version: 2, declaredValueCents: 10000, protectionLevel: "secure_pickup" } });
  saveRouteRunDraft.mockResolvedValue({ ok: true, value: { routeRun: routeDraft() } });
  acceptRouteRun.mockResolvedValue({
    ok: true,
    value: { routeRun: { ...routeDraft(), state: "accepted", draftOnly: false, acceptedVersion: 1, acceptedAt: "2026-09-26T08:00:00Z", stops: routeDraft().stops.map((s) => ({ ...s, claimed: true })) } },
  });
});

async function fillTwoStops(user: ReturnType<typeof userEvent.setup>) {
  const addressButtons = await screen.findAllByRole("button", { name: "Choose fake address" });
  await user.click(addressButtons[0]);

  await user.type(screen.getByLabelText(/Route title/i), "Friday local orders");
  await user.click(screen.getByRole("checkbox", { name: /none of the packages/i }));

  const recipientNames = screen.getAllByLabelText(/Recipient name/i);
  const recipientEmails = screen.getAllByLabelText(/Recipient email/i);
  const weightRanges = screen.getAllByLabelText(/Weight range/i);
  const declaredValues = screen.getAllByLabelText(/Declared shipment value/i);
  const pickupDescriptions = screen.getAllByLabelText(/What should the driver pick up\?/i);

  for (let i = 0; i < 2; i++) {
    const buttons = screen.getAllByRole("button", { name: "Choose fake address" });
    await user.click(buttons[i + 1]);
    await user.type(recipientNames[i], `Recipient ${i + 1}`);
    await user.type(recipientEmails[i], `recipient${i + 1}@example.test`);
    await user.selectOptions(weightRanges[i], "0_25_lb");
    await user.type(declaredValues[i], "100.00");
    await user.type(pickupDescriptions[i], `Package ${i + 1}`);
  }
}

describe("RR-002 RouteBuilder", () => {
  it("starts with two stops, caps the offered weight at 50 lb and does no provider work on render", async () => {
    render(<RouteBuilder />);
    await screen.findByLabelText(/Route title/i);
    expect(screen.getByText("Stop 1")).toBeTruthy();
    expect(screen.getByText("Stop 2")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /over 50/i })).toBeNull();
    expect(createDeliveryRequest).not.toHaveBeenCalled();
    expect(saveRouteRunDraft).not.toHaveBeenCalled();
  });

  it("denies a read-only Business role before showing write controls", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(account("viewer"));
    render(<RouteBuilder />);
    expect(await screen.findByText(/do not have access/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /calculate delivery estimates/i })).toBeNull();
  });

  it("creates canonical child drafts, records package/value evidence, then saves one Route draft", async () => {
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));

    await screen.findByText("Review Route Run");
    expect(createDeliveryRequest).toHaveBeenCalledTimes(2);
    expect(saveBusinessPickupManifest).toHaveBeenCalledTimes(2);
    expect(recordBusinessDeclaredValue).toHaveBeenCalledTimes(2);
    expect(saveRouteRunDraft).toHaveBeenCalledTimes(1);

    const routeCall = saveRouteRunDraft.mock.calls[0][0];
    expect(routeCall.businessAccountId).toBe(BIZ);
    expect(routeCall.requestIds).toEqual([R1, R2]);
    expect(routeCall).not.toHaveProperty("price");
    expect(screen.getByText(/\$40\.00 combined delivery estimates/i)).toBeTruthy();
    expect(screen.getByText(/no payment or driver booking happens yet/i)).toBeTruthy();
    expect(screen.getByText(/approves each displayed delivery estimate/i)).toBeTruthy();
  });

  it("accepts only the immutable stop set and then navigates to Route detail", async () => {
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    await screen.findByText("Review Route Run");
    await user.click(screen.getByRole("button", { name: "Approve estimates and accept stops" }));

    await waitFor(() => expect(acceptRouteRun).toHaveBeenCalledTimes(1));
    expect(acceptRouteRun.mock.calls[0][0]).toEqual(expect.objectContaining({
      businessAccountId: BIZ,
      routeRunId: ROUTE,
      expectedVersion: 1,
    }));
    expect(push).toHaveBeenCalledWith(`/app/business/routes/${ROUTE}?businessAccountId=${BIZ}`);
  });

  it("locks prepared server facts after a partial failure so retry cannot drift", async () => {
    createDeliveryRequest
      .mockReset()
      .mockImplementationOnce(({ request }: { request: Record<string, unknown> }) => Promise.resolve({ ok: true, value: { request: delivery(R1, 1800, request) } }))
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Second stop failed." });
    recordBusinessDeclaredValue
      .mockReset()
      .mockResolvedValueOnce({ ok: true, value: { requestId: R1, version: 2, declaredValueCents: 10000, protectionLevel: "secure_pickup" } });

    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));

    expect(await screen.findByText("Prepared details are locked")).toBeTruthy();
    expect(screen.getByText("This stop is prepared")).toBeTruthy();
    expect(screen.getByLabelText(/Route title/i)).toHaveProperty("disabled", true);
    expect(screen.getAllByLabelText(/Recipient name/i)[0]).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add stop" })).toHaveProperty("disabled", true);
  });

  it("locks editing while the first child is being persisted so an in-flight retry cannot drift", async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    createDeliveryRequest.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockImplementationOnce(({ request }: { request: Record<string, unknown> }) => Promise.resolve({ ok: true, value: { request: delivery(R2, 2200, request) } }));
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    await waitFor(() => expect(createDeliveryRequest).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText(/Route title/i)).toHaveProperty("disabled", true);
    expect(screen.getAllByLabelText(/Recipient name/i).every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByRole("button", { name: /^(Up|Down|Remove)$/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "Choose fake address" })).toBeNull();
    await user.type(screen.getByLabelText(/Route title/i), "changed while saving");
    expect(screen.getByLabelText(/Route title/i)).toHaveProperty("value", "Friday local orders");

    const firstInput = createDeliveryRequest.mock.calls[0][0].request;
    await act(async () => { releaseFirst({ ok: true, value: { request: delivery(R1, 1800, firstInput) } }); });
    await screen.findByText("Review Route Run");
    expect(saveRouteRunDraft.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: "Friday local orders", requestIds: [R1, R2],
    }));
  });

  it("refuses acceptance when an idempotent save replays an older displayed draft", async () => {
    saveRouteRunDraft.mockResolvedValue({ ok: true, value: { routeRun: { ...routeDraft(), currentVersion: 2 } } });
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    expect(await screen.findByText("This review is out of date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve estimates and accept stops" })).toHaveProperty("disabled", true);
    expect(acceptRouteRun).not.toHaveBeenCalled();
  });

  it("rejects an idempotent child replay whose stored destination differs from the browser attempt", async () => {
    createDeliveryRequest.mockReset().mockImplementationOnce(({ request }: { request: Record<string, unknown> }) =>
      Promise.resolve({ ok: true, value: { request: delivery(R1, 1800, {
        ...request,
        dropoffAddress: { googlePlaceId: "different-place" },
      }) } }),
    );
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    expect(await screen.findByText(/this retry key belongs to a different delivery draft/i)).toBeTruthy();
    expect(saveBusinessPickupManifest).not.toHaveBeenCalled();
    expect(saveRouteRunDraft).not.toHaveBeenCalled();
  });

  it("resumes a partial attempt after reload with the original child keys and no duplicate first child", async () => {
    createDeliveryRequest.mockReset()
      .mockImplementationOnce(({ request }: { request: Record<string, unknown> }) => Promise.resolve({ ok: true, value: { request: delivery(R1, 1800, request) } }))
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Second stop failed." })
      .mockImplementationOnce(({ request }: { request: Record<string, unknown> }) => Promise.resolve({ ok: true, value: { request: delivery(R2, 2200, request) } }));
    recordBusinessDeclaredValue.mockReset()
      .mockResolvedValueOnce({ ok: true, value: { requestId: R1, version: 2, declaredValueCents: 10000, protectionLevel: "secure_pickup" } })
      .mockResolvedValueOnce({ ok: true, value: { requestId: R2, version: 2, declaredValueCents: 10000, protectionLevel: "secure_pickup" } });

    const user = userEvent.setup();
    const page = render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    await screen.findByText("Prepared details are locked");
    const firstCreate = createDeliveryRequest.mock.calls[0][0];
    const firstRequest = firstCreate.request;
    expect(window.sessionStorage.getItem("couranr-route-builder-pending-v1")).toContain(R1);
    page.unmount();

    fetchDeliveryRequest.mockResolvedValue({ ok: true, value: { request: {
      ...delivery(R1, 1800, firstRequest),
      version: 2,
      businessAccountId: BIZ,
      requestState: "draft",
      payerType: "merchant",
      pickupAddress: firstRequest.pickupAddress,
      dropoffAddress: firstRequest.dropoffAddress,
      recipientEmail: firstRequest.recipientEmail,
      recipientName: firstRequest.recipientName,
    } } });

    render(<RouteBuilder />);
    await screen.findByText("Continue your unfinished Route Run?");
    expect(createDeliveryRequest).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Continue saved attempt" }));
    await screen.findByText("Prepared details are locked");
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    await screen.findByText("Review Route Run");

    expect(createDeliveryRequest).toHaveBeenCalledTimes(3);
    expect(createDeliveryRequest.mock.calls[2][0].idempotencyKey).toBe(createDeliveryRequest.mock.calls[1][0].idempotencyKey);
    expect(saveBusinessPickupManifest).toHaveBeenCalledTimes(2);
    expect(recordBusinessDeclaredValue).toHaveBeenCalledTimes(2);
    expect(saveRouteRunDraft.mock.calls[0][0].requestIds).toEqual([R1, R2]);
  });

  it("does not reveal a saved Route attempt to a different signed-in business", async () => {
    createDeliveryRequest.mockReset()
      .mockImplementationOnce(({ request }: { request: Record<string, unknown> }) => Promise.resolve({ ok: true, value: { request: delivery(R1, 1800, request) } }))
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Second stop failed." });
    const user = userEvent.setup();
    const page = render(<RouteBuilder />);
    await fillTwoStops(user);
    await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
    await screen.findByText("Prepared details are locked");
    page.unmount();
    fetchMyBusinessAccounts.mockResolvedValue({ ok: true, value: { businessAccounts: [{
      businessAccountId: "99999999-9999-4999-8999-999999999999", name: "Other Shop", role: "owner",
    }] } });

    render(<RouteBuilder />);
    expect(await screen.findByText("An unfinished attempt belongs to another business")).toBeTruthy();
    expect(screen.queryByText("Friday local orders")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue saved attempt" })).toBeNull();
    expect(fetchDeliveryRequest).not.toHaveBeenCalled();
  });

  it("does not create a child when the browser cannot persist retry keys", async () => {
    const user = userEvent.setup();
    render(<RouteBuilder />);
    await fillTwoStops(user);
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new Error("quota denied"); },
        removeItem: () => {},
      },
    });
    try {
      await user.click(screen.getByRole("button", { name: "Calculate delivery estimates" }));
      expect(await screen.findByText(/cannot save the Route Run retry keys/i)).toBeTruthy();
      expect(createDeliveryRequest).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
