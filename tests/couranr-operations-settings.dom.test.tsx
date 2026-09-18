import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * OPS-015, OPS-016 and OPS-020, DRIVEN.
 *
 * Browser verification is deferred to MVP completion by owner decision
 * (2026-09-03); a jsdom test that drives the real component against a recorded
 * response is the accepted stand-in. These five things are what a source read
 * cannot establish:
 *
 *   1. `?tab=` actually selects the right panel, and the other four are not
 *      rendered — the registry's route shape, exercised rather than asserted.
 *   2. The governed hours and cutoff REACH THE SCREEN. A constant imported and
 *      never rendered passes every static check.
 *   3. The unprovisioned state renders as a named warning, not an empty form.
 *   4. A version conflict renders as a refusal, and the command that produced
 *      it carried the version the screen believed was current.
 *   5. The audit table renders NO edit or delete affordance, measured over the
 *      real DOM rather than over the source text.
 */

const {
  fetchAvailability,
  fetchAuditLog,
  setMarketAvailability,
  setOperationalFlag,
  setMarketActive,
  openOperatingClosure,
  liftOperatingClosure,
} = vi.hoisted(() => ({
  fetchAvailability: vi.fn(),
  fetchAuditLog: vi.fn(),
  setMarketAvailability: vi.fn(),
  setOperationalFlag: vi.fn(),
  setMarketActive: vi.fn(),
  openOperatingClosure: vi.fn(),
  liftOperatingClosure: vi.fn(),
}));

vi.mock("@/components/couranr/operations/settings/client", () => ({
  fetchAvailability,
  fetchAuditLog,
  setMarketAvailability,
  setOperationalFlag,
  setMarketActive,
  openOperatingClosure,
  liftOperatingClosure,
}));

import Page from "@/app/(couranr)/operations/settings/page";
import { AuditLog } from "@/components/couranr/operations/settings/AuditLog";
import { AvailabilityControls } from "@/components/couranr/operations/settings/AvailabilityControls";
import { SettingsTabs } from "@/components/couranr/operations/settings/SettingsTabs";
import { SETTINGS_TABS } from "@/components/couranr/operations/settings/tabs";
import {
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
} from "@/lib/couranr/public/governed";
import { COURANR_TIMEZONE } from "@/lib/couranr/hours/operatingHours";

const MARKET = "dc_va_launch_corridor";

function availability(over: Record<string, any> = {}) {
  return {
    provisioned: true,
    markets: [
      {
        marketKey: MARKET,
        active: true,
        maxConcurrentDeliveries: 1,
        availabilityState: "standard",
        version: 4,
        updatedAt: "2026-09-17T10:00:00.000Z",
        closures: [],
      },
    ],
    flags: [
      { key: "overnight_enabled", enabled: false, version: 2, updatedAt: null },
      { key: "ai_auto_reply_enabled", enabled: false, version: 1, updatedAt: null },
      { key: "request_intake_paused", enabled: false, version: 1, updatedAt: null },
      { key: "ai_global_kill_switch", enabled: false, version: 1, updatedAt: null },
    ],
    unavailable: [],
    ...over,
  };
}

function auditLog(over: Record<string, any> = {}) {
  return {
    entries: [
      {
        id: "delivery_events:1",
        source: "delivery_events",
        createdAt: "2026-09-17T12:00:00.000Z",
        actorKind: "operations",
        actorFingerprint: "22222222…",
        command: "create_delivery_from_capture",
        fromState: "draft",
        toState: "submitted",
        subject: "Delivery 55555555…",
        entityHref: "/operations/deliveries/55555555-5555-4555-8555-555555555555",
        severity: "normal",
        metadata: { packageCount: 2 },
      },
      {
        id: "payment_events:2",
        source: "payment_events",
        createdAt: "2026-09-17T11:00:00.000Z",
        actorKind: "system",
        actorFingerprint: null,
        command: "payment_intent.payment_failed",
        fromState: "authorized",
        toState: "failed",
        subject: "Request 33333333…",
        entityHref: null,
        severity: "security_alert",
        metadata: { outcome: "[redacted]" },
      },
    ],
    unavailable: [],
    notProvisioned: [],
    limit: 50,
    truncated: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchAvailability.mockResolvedValue({ ok: true, value: { availability: availability() } });
  fetchAuditLog.mockResolvedValue({ ok: true, value: { audit: auditLog() } });
});

/* ════════════════════════════════ OPS-015 — the shell routes by ?tab= ══ */

describe("OPS-015 — the shell selects a panel from ?tab=", () => {
  it("a bare /operations/settings opens the availability panel", async () => {
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(await screen.findByRole("heading", { name: "Availability controls", level: 1 })).toBeTruthy();
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalled());
    expect(fetchAuditLog).not.toHaveBeenCalled();
  });

  it("?tab=audit opens the audit panel and NOT the availability panel", async () => {
    render(await Page({ searchParams: Promise.resolve({ tab: "audit" }) }));
    expect(await screen.findByRole("heading", { name: "Activity and audit log", level: 1 })).toBeTruthy();
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalled());
    expect(fetchAvailability).not.toHaveBeenCalled();
  });

  it("an unknown ?tab= opens the default panel instead of rendering nothing", async () => {
    render(await Page({ searchParams: Promise.resolve({ tab: "nonsense" }) }));
    expect(await screen.findByRole("heading", { name: "Availability controls", level: 1 })).toBeTruthy();
  });

  for (const t of SETTINGS_TABS.filter((x) => !x.built)) {
    it(`?tab=${t.id} renders a labelled, explicitly-empty ${t.screenId} panel`, async () => {
      render(await Page({ searchParams: Promise.resolve({ tab: t.id }) }));
      // Routed and labelled…
      expect(screen.getByRole("heading", { name: t.title, level: 1 })).toBeTruthy();
      // …and explicitly empty INSIDE THE PANEL, rather than silently showing
      // another panel. Scoped to the tabpanel because the tab STRIP also says
      // "not built yet" in the accessible name of each unbuilt tab.
      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText(t.screenId)).toBeTruthy();
      expect(within(panel).getByText(/not built yet/i)).toBeTruthy();
      expect(fetchAvailability).not.toHaveBeenCalled();
      expect(fetchAuditLog).not.toHaveBeenCalled();
    });
  }
});

describe("OPS-015 — the tab strip is a real, keyboard-navigable tablist", () => {
  it("every tab links to its registry route and only the active one is selected", () => {
    render(<SettingsTabs activeTab="audit" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);

    for (const t of SETTINGS_TABS) {
      const el = screen.getByRole("tab", { name: new RegExp(`^${t.label}`) });
      expect(el.getAttribute("href")).toBe(`/operations/settings?tab=${t.id}`);
      expect(el.getAttribute("aria-selected")).toBe(String(t.id === "audit"));
      // Roving tab sequence: only the selected tab is in the Tab order.
      expect(el.getAttribute("tabindex")).toBe(t.id === "audit" ? "0" : "-1");
    }
  });

  it("an unbuilt tab says so in its accessible name", () => {
    render(<SettingsTabs activeTab="availability" />);
    const policies = screen.getByRole("tab", { name: /Policies and pricing/ });
    expect(policies.textContent).toContain("not built yet");
    const audit = screen.getByRole("tab", { name: /Activity and audit/ });
    expect(audit.textContent).not.toContain("not built yet");
  });

  it("arrow keys move focus along the strip without navigating", async () => {
    const user = userEvent.setup();
    render(<SettingsTabs activeTab="availability" />);
    const first = screen.getByRole("tab", { name: /Availability/ });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("data-tab-id")).toBe("policies");
    await user.keyboard("{End}");
    expect(document.activeElement?.getAttribute("data-tab-id")).toBe("audit");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("data-tab-id")).toBe("availability");
  });
});

/* ═══════════════════════════════════════ OPS-016 — availability controls ══ */

describe("OPS-016 — the governed values reach the screen", () => {
  it("renders the registry's days, window, cutoff and timezone, each with its decision id", async () => {
    render(<AvailabilityControls />);
    await screen.findByText("Operating hours and cutoff");

    // The VALUES, from the modules that own them — not literals.
    expect(screen.getByText(OPERATING_DAYS_COPY)).toBeTruthy();
    expect(screen.getByText(OPERATING_WINDOW_COPY)).toBeTruthy();
    expect(screen.getByText(SAME_DAY_CUTOFF_COPY)).toBeTruthy();
    expect(screen.getByText(COURANR_TIMEZONE)).toBeTruthy();

    // …attributed, so an operator can find the record that decides them.
    expect(screen.getAllByText(/HRS-001/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/HRS-002/).length).toBeGreaterThanOrEqual(1);
    // OVN-001 appears twice: on the governed card and beside the overnight
    // switch, which cites both FLG-001 and OVN-001.
    expect(screen.getAllByText(/OVN-001/).length).toBeGreaterThanOrEqual(1);
  });

  it("says the governed values are not editable here", async () => {
    render(<AvailabilityControls />);
    expect(await screen.findByText(/not editable on this screen/i)).toBeTruthy();
  });

  it("offers no control that would change an hour or the cutoff", async () => {
    render(<AvailabilityControls />);
    await screen.findByText("Operating hours and cutoff");
    const combos = screen.getAllByRole("combobox");
    // Exactly one select on this screen: the market's availability mode.
    expect(combos).toHaveLength(1);
    const options = within(combos[0]).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Standard",
      "Scheduled only",
      "Temporarily closed",
      "Weather limited",
    ]);
  });
});

describe("OPS-016 — the four FLG-001 switches", () => {
  it("renders all four, all off, each citing FLG-001", async () => {
    render(<AvailabilityControls />);
    await screen.findByText("Operational switches");
    for (const label of [
      "Overnight requests",
      "AI auto-replies",
      "Pause request intake",
      "AI global kill switch",
    ]) {
      expect(screen.getByText(label), `${label} missing`).toBeTruthy();
    }
    // Four switch attributions plus the card description that names FLG-001.
    expect(screen.getAllByText(/FLG-001/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("Off")).toHaveLength(4);
  });

  it("toggling a switch sends the version the screen believes is current", async () => {
    const user = userEvent.setup();
    setOperationalFlag.mockResolvedValue({
      ok: true,
      value: { availability: availability(), auditRecorded: true },
    });
    render(<AvailabilityControls />);
    await screen.findByText("Operational switches");

    await user.click(screen.getByRole("button", { name: /Turn overnight requests on/i }));

    await waitFor(() => expect(setOperationalFlag).toHaveBeenCalledTimes(1));
    expect(setOperationalFlag).toHaveBeenCalledWith({
      flagKey: "overnight_enabled",
      enabled: true,
      // The fixture's version for this flag is 2, not 1 — a hardcoded 1 would
      // pass a looser assertion and lose every real concurrent edit.
      expectedVersion: 2,
    });
  });
});

describe("OPS-016 — the states the registry declares", () => {
  it("an unprovisioned environment says which migration is pending, not 'nothing configured'", async () => {
    fetchAvailability.mockResolvedValue({
      ok: true,
      value: {
        availability: availability({
          provisioned: false,
          flags: availability().flags.map((f: any) => ({ ...f, version: 0 })),
        }),
      },
    });
    render(<AvailabilityControls />);
    expect(await screen.findByText(/not provisioned yet/i)).toBeTruthy();
    expect(screen.getByText(/20260917210000_couranr_operations_settings/)).toBeTruthy();
    // And nothing is editable, so a change cannot be attempted against a
    // table that does not exist.
    for (const b of screen.getAllByRole("button")) {
      if (/^Turn /i.test(b.textContent ?? "")) expect(b).toHaveProperty("disabled", true);
    }
  });

  it("a policy version conflict renders as a refusal, not a silent overwrite", async () => {
    const user = userEvent.setup();
    setOperationalFlag.mockResolvedValue({
      ok: false,
      status: 409,
      code: "version_conflict",
      error: "Someone else changed this switch first.",
    });
    render(<AvailabilityControls />);
    await screen.findByText("Operational switches");
    await user.click(screen.getByRole("button", { name: /Turn AI global kill switch on/i }));
    expect(await screen.findByText(/This changed while you were working/i)).toBeTruthy();
  });

  it("permission denied renders the shared denial state and no controls", async () => {
    fetchAvailability.mockResolvedValue({ ok: false, status: 403, error: "Not permitted." });
    render(<AvailabilityControls />);
    expect(await screen.findByText(/You do not have access to this/i)).toBeTruthy();
    expect(screen.queryByText("Operational switches")).toBeNull();
  });

  it("a change that lands without its audit row says exactly that", async () => {
    const user = userEvent.setup();
    setOperationalFlag.mockResolvedValue({
      ok: true,
      value: { availability: availability(), auditRecorded: false },
    });
    render(<AvailabilityControls />);
    await screen.findByText("Operational switches");
    await user.click(screen.getByRole("button", { name: /Turn overnight requests on/i }));
    expect(await screen.findByText(/applied but not recorded/i)).toBeTruthy();
  });

  it("a section that failed to read is named rather than shown empty", async () => {
    fetchAvailability.mockResolvedValue({
      ok: true,
      value: { availability: availability({ unavailable: ["closures"] }) },
    });
    render(<AvailabilityControls />);
    expect(await screen.findByText(/could not read part of this page/i)).toBeTruthy();
  });

  it("closing a day sends a local calendar date and the reason, and lifting sends the row id", async () => {
    const user = userEvent.setup();
    const CLOSURE_ID = "44444444-4444-4444-8444-444444444444";
    fetchAvailability.mockResolvedValue({
      ok: true,
      value: {
        availability: availability({
          markets: [
            {
              ...availability().markets[0],
              closures: [
                { id: CLOSURE_ID, localDate: "2026-12-25", reason: "Observed holiday", active: true },
              ],
            },
          ],
        }),
      },
    });
    openOperatingClosure.mockResolvedValue({
      ok: true,
      value: { availability: availability(), auditRecorded: true },
    });
    liftOperatingClosure.mockResolvedValue({
      ok: true,
      value: { availability: availability(), auditRecorded: true },
    });

    render(<AvailabilityControls />);
    await screen.findByText("Markets");

    // The existing closure is shown with a lift control…
    expect(screen.getByText("2026-12-25")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Lift closure/i }));
    await waitFor(() => expect(liftOperatingClosure).toHaveBeenCalledWith({ closureId: CLOSURE_ID }));

    // …and a new one can be opened. The button stays disabled until BOTH a
    // date and a reason are present, so a closure can never be recorded
    // without saying why.
    const close = screen.getByRole("button", { name: /Close this day/i });
    expect(close).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText(/Closure date/), "2026-11-26");
    expect(screen.getByRole("button", { name: /Close this day/i })).toHaveProperty(
      "disabled",
      true
    );
    await user.type(screen.getByLabelText(/^Reason/), "  Thanksgiving  ");
    await user.click(screen.getByRole("button", { name: /Close this day/i }));

    await waitFor(() => expect(openOperatingClosure).toHaveBeenCalledTimes(1));
    expect(openOperatingClosure).toHaveBeenCalledWith({
      marketKey: MARKET,
      localDate: "2026-11-26",
      // Trimmed before it leaves the browser; the server trims again.
      reason: "Thanksgiving",
    });
  });

  it("the market's mode is shown as its declared state, and changing it names the state", async () => {
    const user = userEvent.setup();
    setMarketAvailability.mockResolvedValue({
      ok: true,
      value: {
        availability: availability({
          markets: [{ ...availability().markets[0], availabilityState: "weather_limited", version: 5 }],
        }),
        auditRecorded: true,
      },
    });
    render(<AvailabilityControls />);
    await screen.findByText("Markets");
    // The BADGE, not the <option> of the same name.
    expect(screen.getByText("Standard", { selector: ".cr-badge" })).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox"), "weather_limited");
    await waitFor(() => expect(setMarketAvailability).toHaveBeenCalledTimes(1));
    expect(setMarketAvailability).toHaveBeenCalledWith({
      marketKey: MARKET,
      availabilityState: "weather_limited",
      expectedVersion: 4,
    });
    expect(await screen.findByText(/is now weather limited/i)).toBeTruthy();
  });
});

/* ═════════════════════════════════════════════ OPS-020 — the audit log ══ */

describe("OPS-020 — the audit log is read-only and append-only", () => {
  it("renders the entries it was given", async () => {
    render(<AuditLog />);
    await screen.findByRole("table");
    expect(screen.getByText("create_delivery_from_capture")).toBeTruthy();
    expect(screen.getByText("draft → submitted")).toBeTruthy();
    expect(screen.getByText("Request 33333333…")).toBeTruthy();
  });

  it("states that the record cannot be edited or deleted", async () => {
    render(<AuditLog />);
    expect(await screen.findByText(/This record is append-only/i)).toBeTruthy();
    expect(screen.getByText(/Couranr cannot edit or delete an audit entry/i)).toBeTruthy();
  });

  it("OFFERS NO EDIT OR DELETE AFFORDANCE ANYWHERE IN THE RENDERED DOM", async () => {
    const { container } = render(<AuditLog />);
    await screen.findByRole("table");

    /*
     * Measured over the real DOM, not the source. The rule is not "no controls"
     * — OPS-020 declares four actions and they are all reads — it is that EVERY
     * control is a read. So the sweep enumerates them and names each one.
     */
    const controls = [
      ...screen.queryAllByRole("button"),
      ...screen.queryAllByRole("link"),
      ...screen.queryAllByRole("combobox"),
    ].map((el) => (el.textContent ?? "").trim());

    // Two filters, one export, and one entity link per delivery-scoped row.
    expect(controls.filter((t) => /export/i.test(t))).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    // Nothing that writes: no checkbox, no editable field, no menu.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(container.querySelectorAll("[contenteditable]")).toHaveLength(0);

    // No control, anywhere, offers a mutation.
    for (const t of controls) {
      expect(
        /delete|remove|\bedit\b|archive|resolve|dismiss/i.test(t),
        `the audit surface offers a control named "${t}"`
      ).toBe(false);
    }

    /*
     * And the word sweep over the TABLE, not the whole surface: the standing
     * banner's own sentence is "Couranr cannot edit or delete an audit entry",
     * and a sweep over the whole container flags that sentence — which is the
     * opposite of what it is looking for.
     */
    const table = screen.getByRole("table").textContent ?? "";
    for (const word of [/delete/i, /remove/i, /\bedit\b/i, /archive/i]) {
      expect(word.test(table), `the audit table offers "${word}"`).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: the affordance sweep can actually fail", () => {
    // An absence assertion over the DOM passes on an empty DOM too. This proves
    // the sweep sees a mutating control when one is present.
    render(
      <div>
        <button type="button">Delete entry</button>
      </div>
    );
    const controls = screen.queryAllByRole("button").map((el) => el.textContent ?? "");
    expect(controls).toHaveLength(1);
    expect(/delete|remove|\bedit\b|archive/i.test(controls[0])).toBe(true);
  });

  it("links an entry to its delivery, and renders no link where no screen exists", async () => {
    render(<AuditLog />);
    await screen.findByRole("table");
    // The delivery-scoped entry links into the canonical Operations screen…
    const link = screen.getByRole("link", { name: /Delivery 55555555/ });
    expect(link.getAttribute("href")).toBe(
      "/operations/deliveries/55555555-5555-4555-8555-555555555555"
    );
    // …and the payment entry, which has no canonical screen of its own, is
    // plain text rather than a link that would 404.
    expect(screen.queryByRole("link", { name: /Request 33333333/ })).toBeNull();
    expect(screen.getAllByText("Request 33333333…").length).toBeGreaterThanOrEqual(1);
  });

  it("exports exactly what is on screen, quoted so a comma cannot shift a column", async () => {
    const user = userEvent.setup();
    /*
     * jsdom implements neither `URL.createObjectURL` nor a real anchor
     * download, so both are stubbed and the BLOB ITSELF is captured — the
     * actual bytes a person would receive, not a claim about them.
     */
    const blobs: Blob[] = [];
    const downloads: string[] = [];
    const realCreate = (URL as any).createObjectURL;
    const realRevoke = (URL as any).revokeObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    (URL as any).createObjectURL = (b: Blob) => {
      blobs.push(b);
      return "blob:stub";
    };
    (URL as any).revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.getAttribute("download") ?? "");
    };

    try {
      render(<AuditLog />);
      await screen.findByRole("table");
      await user.click(screen.getByRole("button", { name: /Export this view/i }));

      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toContain("text/csv");
      expect(downloads[0]).toMatch(/^couranr-audit-\d{4}-\d{2}-\d{2}\.csv$/);

      const csv = await blobs[0].text();
      const lines = csv.split("\r\n");
      // Header plus one line per entry on screen, and nothing else.
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(
        '"when","source","actor_kind","actor","event","from_state","to_state","subject","severity","detail"'
      );
      // Every field quoted, so a comma inside one cannot shift a column.
      for (const l of lines) expect(l.startsWith('"') && l.endsWith('"')).toBe(true);
      expect(csv).toContain("create_delivery_from_capture");
      // And it carries only what the screen carries: the delivery id lives in
      // the LINK, not in any exported column.
      expect(csv).not.toContain("55555555-5555-4555-8555-555555555555");
    } finally {
      (URL as any).createObjectURL = realCreate;
      (URL as any).revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it("flags a security alert rather than burying it in the table", async () => {
    render(<AuditLog />);
    // The banner counts them; the row badge marks the one.
    expect((await screen.findAllByText(/needs? attention/i)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });

  it("names a source it could not read, instead of implying it was empty", async () => {
    fetchAuditLog.mockResolvedValue({
      ok: true,
      value: { audit: auditLog({ unavailable: ["payment_events"] }) },
    });
    render(<AuditLog />);
    const alert = await screen.findByText(/Part of the record could not be read/i);
    // Named inside the alert, not merely present as a filter option.
    expect(alert.closest(".cr-alert")?.textContent).toContain("Payment events");
  });

  it("names a source whose table does not exist yet", async () => {
    fetchAuditLog.mockResolvedValue({
      ok: true,
      value: { audit: auditLog({ notProvisioned: ["operations_setting_events"] }) },
    });
    render(<AuditLog />);
    expect(await screen.findByText(/not provisioned yet/i)).toBeTruthy();
  });

  it("changing the source filter re-reads through the named route key", async () => {
    const user = userEvent.setup();
    render(<AuditLog />);
    await screen.findByRole("table");
    await user.selectOptions(screen.getAllByRole("combobox")[0], "payment_events");
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({ source: "payment_events", limit: 50 })
    );
  });

  it("an empty result says so, and does not look like a failure", async () => {
    fetchAuditLog.mockResolvedValue({ ok: true, value: { audit: auditLog({ entries: [] }) } });
    render(<AuditLog />);
    expect(await screen.findByText(/No entries in this view/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("permission denied renders the shared denial state", async () => {
    fetchAuditLog.mockResolvedValue({ ok: false, status: 403, error: "Not permitted." });
    render(<AuditLog />);
    expect(await screen.findByText(/You do not have access to this/i)).toBeTruthy();
  });
});
