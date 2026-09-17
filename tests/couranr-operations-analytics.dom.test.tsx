import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * OPS-013 and OPS-014, driven.
 *
 * Browser verification is deferred to MVP completion by owner decision
 * (2026-09-03); a jsdom test that drives the real component against a recorded
 * response is the accepted stand-in. It is here for three specific defect
 * classes this repo has already shipped or come close to shipping:
 *
 *  1. **The nested key.** Every canonical route nests its payload under a named
 *     key and the routes return untyped JSON, so reading it flat yields
 *     `undefined` with a green typecheck. Proof upload was dead its whole life
 *     that way. These tests record `{ analytics: … }` and `{ unmetDemand: … }`
 *     exactly as the routes return them, so a flat read renders the error state
 *     and fails loudly.
 *  2. **The wrong URL.** OPS-014's canonical route is
 *     `/operations/analytics?tab=unmet-demand`. The tab must be read FROM and
 *     written TO the query string, and it must fetch the unmet-demand endpoint
 *     rather than the overview one.
 *  3. **Zeros dressed as measurements.** An empty period must render as empty,
 *     and a measure with no source must say it cannot be measured — neither may
 *     render as a table of zeros.
 */

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const { searchParams } = vi.hoisted(() => ({ searchParams: { current: "" } }));

vi.mock("@/components/couranr/requests/client", () => ({
  call,
  isApiFailure: (r: any) => r?.ok === false,
  withReference: (f: any) =>
    f?.correlationId ? `${f.error} Reference ${f.correlationId}.` : f?.error,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/operations/analytics",
  useSearchParams: () => new URLSearchParams(searchParams.current),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const { OperationsAnalyticsDashboard } = await import(
  "@/components/couranr/operations/analytics/OperationsAnalyticsDashboard"
);

const REQUEST_ID = "aaaaaaaa-1111-4111-8111-111111111111";

function analytics(over: Record<string, any> = {}) {
  return {
    generatedAt: "2026-09-17T12:00:00.000Z",
    windowDays: 30,
    state: "live",
    requestsInWindow: 12,
    paidDeliveries: {
      count: 4,
      byFulfillmentState: {
        state: "live",
        rows: [{ key: "delivered", label: "Delivered", count: 4 }],
      },
    },
    markets: {
      state: "live",
      rows: [
        { key: "US|VA|stafford", label: "Stafford, VA", count: 9, capturedCents: 4796 },
        { key: "outside_launch_markets", label: "Outside the launch markets", count: 3, capturedCents: 0 },
      ],
    },
    categories: {
      state: "live",
      rows: [
        {
          key: "florists_gifts_specialty_retail",
          label: "Florists, gifts and specialty retail",
          count: 12,
          capturedCents: 4796,
        },
      ],
    },
    payerMix: {
      state: "live",
      rows: [{ key: "merchant", label: "Merchant pays", count: 4, capturedCents: 4796 }],
    },
    requesterMix: {
      state: "live",
      rows: [{ key: "business", label: "Business request", count: 12, capturedCents: 4796 }],
    },
    economics: {
      capturedCents: 4796,
      refundedCents: 799,
      netCapturedCents: 3997,
      promotionalCreditCents: 0,
      standardQuoteCents: 5196,
      paidDeliveryCount: 4,
      averageCapturedCents: 1199,
    },
    support: {
      conversations: {
        state: "live",
        rows: [{ key: "merchant_support", label: "Merchant support", count: 2 }],
      },
      conversationsByDueState: {
        state: "live",
        rows: [
          { key: "on_time", label: "On time", count: 1 },
          { key: "overdue", label: "Overdue", count: 1 },
        ],
      },
      problemReports: { state: "empty", rows: [] },
      incidents: { state: "empty", rows: [] },
      overdueConversations: 1,
    },
    proof: {
      byStage: { state: "live", rows: [{ key: "dropoff", label: "Dropoff", count: 4 }] },
      byType: { state: "live", rows: [{ key: "delivery_photo", label: "Delivery photo", count: 4 }] },
      deliveredWithDropoffProof: 4,
      deliveredWithoutDropoffProof: 0,
    },
    driverUtilization: {
      activeDrivers: 2,
      driversWithAssignments: 1,
      assignmentsByState: {
        state: "live",
        rows: [{ key: "completed", label: "Completed", count: 4 }],
      },
      perDriver: {
        state: "live",
        rows: [{ key: "bbbbbbbb-1111-4111-8111-111111111111", label: "Driver bbbbbbbb", count: 4 }],
      },
      utilizationRate: {
        state: "not_measurable",
        rows: [],
        reason:
          "Utilization as a percentage needs time on delivery against time available. " +
          "Couranr records a driver's availability as a current flag with no history, " +
          "and records no scheduled hours at all, so there is no denominator to divide by.",
      },
    },
    truncatedSources: [],
    ...over,
  };
}

function unmetDemand(over: Record<string, any> = {}) {
  return {
    generatedAt: "2026-09-17T12:00:00.000Z",
    windowDays: 30,
    state: "partial",
    universe: { confirmed: 4, neverSubmitted: 3, stillOpen: 2, couldNotConfirm: 5 },
    causes: {
      state: "partial",
      unattributed: 1,
      rows: [
        { key: "outside_service_area", label: "Outside service area", count: 2 },
        { key: "cancelled_by_customer", label: "Cancelled by the customer", count: 1 },
        { key: "no_driver_available", label: "No driver available", count: 1 },
        { key: "unattributed", label: "Not attributed", count: 1 },
      ],
    },
    unattributed: 1,
    serviceArea: {
      state: "live",
      rows: [{ key: "out_of_area_review", label: "Outside — sent to review", count: 2 }],
    },
    quoteDisposition: {
      state: "live",
      rows: [{ key: "manual_review_required", label: "Manual quote required", count: 3 }],
    },
    reviewTriggers: {
      state: "live",
      multiValued: true,
      rows: [{ key: "route_needs_review", label: "Route needs review", count: 4 }],
    },
    timingTriggers: { state: "empty", rows: [] },
    categories: { state: "empty", rows: [] },
    markets: {
      state: "live",
      rows: [{ key: "outside_launch_markets", label: "Outside the launch markets", count: 2 }],
    },
    distanceBands: {
      state: "live",
      rows: [{ key: "over_25", label: "Over 25 miles (review)", count: 2 }],
    },
    weightBands: { state: "live", rows: [{ key: "over_50_lb", label: "Over 50 lb", count: 1 }] },
    restrictedClasses: { state: "live", rows: [{ key: "none", label: "None", count: 5 }] },
    byDay: { state: "live", rows: [{ key: "2026-09-12", label: "2026-09-12", count: 2 }] },
    recent: [
      {
        requestId: REQUEST_ID,
        requestState: "declined",
        cause: "outside_service_area",
        createdAt: "2026-09-12T10:00:00.000Z",
      },
    ],
    truncatedSources: [],
    ...over,
  };
}

beforeEach(() => {
  call.mockReset();
  replace.mockReset();
  searchParams.current = "";
});

describe("OPS-013 delivery analytics", () => {
  it("reads the payload from its nested key and renders the measures", async () => {
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);

    await screen.findByText("Paid deliveries and economics");

    /* The figures the registry names, from the recorded response. A flat read
       of the payload would have rendered the error state instead. */
    const metrics = screen.getByLabelText("Paid delivery and economic summary");
    expect(within(metrics).getByText("$47.96")).toBeTruthy();
    expect(within(metrics).getByText("$7.99")).toBeTruthy();
    expect(within(metrics).getByText("$39.97")).toBeTruthy();
    expect(within(metrics).getByText("$11.99")).toBeTruthy();

    /* Scoped to the table: the same labels are also the filter's option text,
       so an unscoped query would pass on the dropdown alone. */
    const markets = screen.getByRole("region", { name: "Markets" });
    expect(within(markets).getByText("Stafford, VA")).toBeTruthy();
    expect(within(markets).getByText("$47.96")).toBeTruthy();
    const categories = screen.getByRole("region", { name: "Business categories" });
    expect(within(categories).getByText("Florists, gifts and specialty retail")).toBeTruthy();
    const payers = screen.getByRole("region", { name: "Payer mix" });
    expect(within(payers).getByText("Merchant pays")).toBeTruthy();
  });

  it("calls the OPS-013 endpoint, not the unmet-demand one", async () => {
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("Paid deliveries and economics");

    expect(call).toHaveBeenCalledTimes(1);
    const url = String(call.mock.calls[0][0]);
    expect(url.startsWith("/api/couranr/operations/analytics?")).toBe(true);
    expect(url).not.toContain("unmet-demand");
  });

  it("renders a measure it cannot derive as not measurable, never as a zero", async () => {
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);

    expect(await screen.findByText("Not measurable yet")).toBeTruthy();
    expect(screen.getByText(/no denominator to divide by/i)).toBeTruthy();
    /* The utilization panel must not have produced a table at all. */
    expect(screen.queryByRole("region", { name: "Utilization rate" })).toBeNull();
  });

  it("renders an empty period as empty rather than a page of zeros", async () => {
    call.mockResolvedValue({
      ok: true,
      value: { analytics: analytics({ state: "empty" }) },
    });
    render(<OperationsAnalyticsDashboard />);

    expect(await screen.findByText("Nothing has been measured yet")).toBeTruthy();
    expect(screen.queryByText("Paid deliveries and economics")).toBeNull();
  });

  it("warns that a truncated source makes every count a floor", async () => {
    call.mockResolvedValue({
      ok: true,
      value: { analytics: analytics({ truncatedSources: ["requests"] }) },
    });
    render(<OperationsAnalyticsDashboard />);
    expect(await screen.findByText("These counts are a floor, not a total")).toBeTruthy();
  });

  it("shows the permission-denied state for a caller Operations refuses", async () => {
    call.mockResolvedValue({ ok: false, status: 403, error: "Couranr Operations access required." });
    render(<OperationsAnalyticsDashboard />);
    await waitFor(() => {
      expect(screen.queryByText("Paid deliveries and economics")).toBeNull();
    });
    expect(call).toHaveBeenCalled();
  });

  it("fails visibly, with the support reference, when the read fails closed", async () => {
    call.mockResolvedValue({
      ok: false,
      status: 500,
      error: "Could not load Operations analytics.",
      correlationId: "cr-abc123",
    });
    render(<OperationsAnalyticsDashboard />);

    expect(await screen.findByText("Analytics could not be loaded")).toBeTruthy();
    expect(screen.getByText(/Reference cr-abc123/)).toBeTruthy();
    /* A failed read must never be rendered as a measurement of zero. */
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});

describe("OPS-014 unmet demand, selected by ?tab=unmet-demand", () => {
  it("opens on the unmet-demand tab when the query string says so", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    await screen.findByText("What happened to every request in this period");

    const url = String(call.mock.calls[0][0]);
    expect(url.startsWith("/api/couranr/operations/analytics/unmet-demand?")).toBe(true);
  });

  it("writes the canonical ?tab=unmet-demand into the URL when the tab is chosen", async () => {
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("Paid deliveries and economics");

    await userEvent.click(screen.getByRole("tab", { name: "Unmet demand" }));

    expect(replace).toHaveBeenCalled();
    const target = String(replace.mock.calls[0][0]);
    expect(target).toContain("/operations/analytics?");
    expect(target).toContain("tab=unmet-demand");
  });

  it("states that these are requests and not lost customers", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    expect(await screen.findByText("These are requests, not lost customers")).toBeTruthy();
  });

  it("keeps never-submitted, still-open and could-not-confirm as separate figures", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    const summary = await screen.findByLabelText("Request outcome summary");
    for (const label of ["Confirmed", "Never submitted", "Still open", "Could not confirm"]) {
      expect(within(summary).getByText(label), `${label} is missing`).toBeTruthy();
    }
    /* 3 never-submitted + 2 still-open + 5 could-not-confirm must never appear
       as a single 10. Each figure is its own tile. */
    expect(within(summary).getByText("3")).toBeTruthy();
    expect(within(summary).getByText("2")).toBeTruthy();
    expect(within(summary).getByText("5")).toBeTruthy();
    expect(within(summary).queryByText("10")).toBeNull();
  });

  it("shows each recorded cause separately and surfaces the unattributed count", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    const table = await screen.findByRole("region", { name: "Recorded cause" });
    expect(within(table).getByText("Outside service area")).toBeTruthy();
    expect(within(table).getByText("Cancelled by the customer")).toBeTruthy();
    expect(within(table).getByText("No driver available")).toBeTruthy();
    expect(within(table).getByText("Not attributed")).toBeTruthy();

    expect(screen.getByText("1 not attributed")).toBeTruthy();
    expect(screen.getByText(/are shown as unattributed and are not assigned to any cause/i)).toBeTruthy();
  });

  it("says a multi-valued panel does not add up to the number of requests", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    await screen.findByRole("region", { name: "Review triggers" });
    expect(screen.getByText(/do not add up to the number of requests/i)).toBeTruthy();
  });

  it("opens an underlying request by id, and reproduces no request content", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);

    await screen.findByText("Open the underlying requests");
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes(REQUEST_ID));
    expect(link, "no drill-down link to the underlying request").toBeTruthy();
    expect(link!.getAttribute("href")).toBe(
      `/operations/deliveries/${REQUEST_ID}#ops-current-action`
    );
    /* The link carries an id and a state, and nothing that identifies a person. */
    expect(link!.textContent).toContain("aaaaaaaa");
    expect(link!.textContent).not.toMatch(/@|\+1|\bRoad\b|\bApartment\b/);
  });

  it("does not call the unmet-demand endpoint a second time for an unchanged filter", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({ ok: true, value: { unmetDemand: unmetDemand() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("What happened to every request in this period");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("says so when Couranr failed to confirm nothing at all", async () => {
    searchParams.current = "tab=unmet-demand";
    call.mockResolvedValue({
      ok: true,
      value: {
        unmetDemand: unmetDemand({
          state: "live",
          universe: { confirmed: 6, neverSubmitted: 1, stillOpen: 0, couldNotConfirm: 0 },
          unattributed: 0,
          causes: { state: "empty", rows: [] },
        }),
      },
    });
    render(<OperationsAnalyticsDashboard />);

    expect(
      await screen.findByText("Couranr did not fail to confirm anything in this period")
    ).toBeTruthy();
    expect(screen.queryByText("Why Couranr could not confirm")).toBeNull();
  });
});

describe("filters are part of the URL", () => {
  it("puts a chosen period into the query string and into the request", async () => {
    searchParams.current = "days=90";
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("Paid deliveries and economics");

    expect(String(call.mock.calls[0][0])).toContain("days=90");
  });

  it("carries a market filter through to the endpoint", async () => {
    searchParams.current = "market=US%7CVA%7Cstafford&payer=merchant";
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("Paid deliveries and economics");

    const url = String(call.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("market=US|VA|stafford");
    expect(url).toContain("payer=merchant");
  });

  it("rewrites the URL when a filter changes", async () => {
    call.mockResolvedValue({ ok: true, value: { analytics: analytics() } });
    render(<OperationsAnalyticsDashboard />);
    await screen.findByText("Paid deliveries and economics");

    await userEvent.selectOptions(screen.getByLabelText(/^Period/), "7");
    expect(String(replace.mock.calls[0][0])).toContain("days=7");
  });
});
