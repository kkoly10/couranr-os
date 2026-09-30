import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMyBusinessAccounts = vi.fn();
const fetchDeliveryRequest = vi.fn();
const fetchRouteRun = vi.fn();
const saveRouteRunDraft = vi.fn();
const acceptRouteRun = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`businessAccountId=${BIZ}`),
}));
vi.mock("@/components/couranr/requests/client", () => ({
  fetchMyBusinessAccounts: (...args: unknown[]) => fetchMyBusinessAccounts(...args),
  fetchDeliveryRequest: (...args: unknown[]) => fetchDeliveryRequest(...args),
  isApiFailure: (value: { ok: boolean }) => value.ok === false,
  withReference: (value: { error?: string }) => value.error ?? "Request failed.",
}));
vi.mock("@/components/couranr/routes/client", () => ({
  fetchRouteRun: (...args: unknown[]) => fetchRouteRun(...args),
  saveRouteRunDraft: (...args: unknown[]) => saveRouteRunDraft(...args),
  acceptRouteRun: (...args: unknown[]) => acceptRouteRun(...args),
}));

const { RouteRunDetail } = await import("@/components/couranr/routes/RouteRunDetail");

const BIZ = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "33333333-3333-4333-8333-333333333333";
const ROUTE = "44444444-4444-4444-8444-444444444444";
const Q1 = "55555555-5555-4555-8555-555555555555";
const Q2 = "66666666-6666-4666-8666-666666666666";
const Q2B = "77777777-7777-4777-8777-777777777777";

function route(version: number, secondQuoteId: string, total: number) {
  return {
    routeRunId: ROUTE,
    businessAccountId: BIZ,
    state: "draft",
    version,
    currentVersion: version,
    title: "Friday local orders",
    stopCount: 2,
    referenceQuoteTotalCents: total,
    stops: [
      { sequence: 1, requestId: R1, quoteVersionId: Q1, stale: false, claimed: false },
      { sequence: 2, requestId: R2, quoteVersionId: secondQuoteId, stale: false, claimed: false },
    ],
  };
}

function child(id: string, quoteId: string, subtotal: number) {
  return { ok: true, value: { request: {
    id,
    currentQuoteVersionId: quoteId,
    recipientName: id === R1 ? "First recipient" : "Second recipient",
    recipientEmail: "recipient@example.test",
    dropoffAddress: { formattedAddress: "Stafford, VA" },
    quote: { deliverySubtotalCents: subtotal },
  } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyBusinessAccounts.mockResolvedValue({ ok: true, value: { businessAccounts: [{ businessAccountId: BIZ, role: "owner", name: "Route Shop" }] } });
  fetchRouteRun.mockResolvedValue({ ok: true, value: { routeRun: route(1, Q2, 4000) } });
  fetchDeliveryRequest.mockImplementation(({ id }: { id: string }) => Promise.resolve(id === R1 ? child(R1, Q1, 1800) : child(R2, Q2, 2200)));
});

describe("RR-002 RouteRunDetail", () => {
  it("reloads child prices after refresh and never displays an old per-stop amount with a new route total", async () => {
    const user = userEvent.setup();
    render(<RouteRunDetail routeRunId={ROUTE} />);
    await screen.findByText("Estimate: $22.00");
    expect(screen.getByText(/\$40\.00/)).toBeTruthy();

    saveRouteRunDraft.mockResolvedValue({ ok: true, value: { routeRun: route(2, Q2B, 5000) } });
    fetchDeliveryRequest.mockImplementation(({ id }: { id: string }) => Promise.resolve(id === R1 ? child(R1, Q1, 1800) : child(R2, Q2B, 3200)));
    await user.click(screen.getByRole("button", { name: "Refresh stop set" }));

    await screen.findByText("Estimate: $32.00");
    expect(screen.getByText(/\$50\.00/)).toBeTruthy();
    expect(screen.queryByText("Estimate: $22.00")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve estimates and accept stops" })).toHaveProperty("disabled", false);
  });

  it("blocks acceptance if a refreshed child quote cannot be loaded", async () => {
    const user = userEvent.setup();
    render(<RouteRunDetail routeRunId={ROUTE} />);
    await screen.findByText("Estimate: $22.00");
    saveRouteRunDraft.mockResolvedValue({ ok: true, value: { routeRun: route(2, Q2B, 5000) } });
    fetchDeliveryRequest.mockImplementation(({ id }: { id: string }) => Promise.resolve(
      id === R1 ? child(R1, Q1, 1800) : { ok: false, error: "Child detail unavailable" },
    ));
    await user.click(screen.getByRole("button", { name: "Refresh stop set" }));
    await screen.findByText("Child detail unavailable");
    expect(screen.queryByText("Estimate: $22.00")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve estimates and accept stops" })).toHaveProperty("disabled", true);
    expect(acceptRouteRun).not.toHaveBeenCalled();
  });

  it("does not pass a newer currentVersion to acceptance for an older displayed version", async () => {
    fetchRouteRun.mockResolvedValue({ ok: true, value: { routeRun: { ...route(1, Q2, 4000), currentVersion: 2 } } });
    render(<RouteRunDetail routeRunId={ROUTE} />);
    await screen.findByText("Review the current estimates");
    expect(screen.getByRole("button", { name: "Approve estimates and accept stops" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(acceptRouteRun).not.toHaveBeenCalled());
  });
});
