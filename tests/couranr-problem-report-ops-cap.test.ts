import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * CUS-004 Codex P2 — listOperationsProblemReports must keep unresolved reports
 * ahead of the 200-row cap.
 *
 * The prior query listed all non-draft reports ordered by creation time and
 * capped at 200, so once enough resolved reports accumulated an older
 * unresolved (reported/under_review/awaiting_evidence) case fell outside the
 * window and became inaccessible in the Operations UI. The fix fetches all
 * unresolved reports first, then a bounded window of resolved history.
 */

const h = vi.hoisted(() => ({
  unresolved: [] as any[],
  resolved: [] as any[],
  calls: [] as any[],
}));

vi.mock("@/lib/supabaseAdmin", () => {
  function builder(table: string) {
    const st: any = { table, inStates: null, eqReportState: null, limit: Infinity };
    const b: any = {
      select: () => b,
      in: (col: string, vals: any) => { if (col === "report_state") st.inStates = vals; return b; },
      eq: (col: string, val: any) => { if (col === "report_state") st.eqReportState = val; return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return b; },
      then: (f: any, r: any) => Promise.resolve(resolve(st)).then(f, r),
    };
    return b;
  }
  function resolve(st: any) {
    h.calls.push({ ...st });
    const slice = (rows: any[]) => rows.slice(0, st.limit === Infinity ? rows.length : st.limit);
    if (st.table === "couranr_customer_problem_reports") {
      if (st.inStates) return { data: slice(h.unresolved), error: null };
      if (st.eqReportState === "resolved") return { data: slice(h.resolved), error: null };
    }
    return { data: [], error: null }; // evidence + anything else
  }
  return { supabaseAdmin: { from: (t: string) => builder(t) } };
});

import { listOperationsProblemReports } from "@/lib/couranr/conversations/problemReports";

const OPS: any = { kind: "operations", userId: "00000000-0000-4000-8000-0000000000a1" };
const report = (id: string, state: string, created: string) => ({
  id, request_id: "r-" + id, delivery_id: "d-" + id, problem_type: "damaged", details: "x",
  report_state: state, submitted_at: created, resolved_at: state === "resolved" ? created : null,
  version: 1, created_at: created,
});

beforeEach(() => { h.unresolved = []; h.resolved = []; h.calls = []; });

describe("listOperationsProblemReports — unresolved never displaced by the cap", () => {
  it("an OLD unresolved report survives a 250-strong newer resolved history", async () => {
    h.resolved = Array.from({ length: 250 }, (_, i) =>
      report(`res-${i}`, "resolved", `2026-09-08T12:${String(i % 60).padStart(2, "0")}:00Z`));
    h.unresolved = [report("old-open", "reported", "2020-01-01T00:00:00Z")];

    const r = await listOperationsProblemReports(OPS);
    expect(r.ok).toBe(true);
    const ids = (r as any).value.map((x: any) => x.id);

    // The load-bearing assertion: the old unresolved case is reachable. Under
    // the old .neq('draft').order(created desc).limit(200) it would be pushed
    // out by the 250 newer resolved reports.
    expect(ids).toContain("old-open");
    // Unresolved come first.
    expect(ids[0]).toBe("old-open");
    // Resolved history is bounded to 200; unresolved (1) is not truncated.
    expect(ids.filter((id: string) => id.startsWith("res-")).length).toBe(200);

    // Query SHAPE guard: a separate unresolved (.in report_state) query and a
    // separate resolved (.eq report_state=resolved) query were issued — a revert
    // to a single mixed .neq('draft') query would fail this.
    const reportQueries = h.calls.filter((c) => c.table === "couranr_customer_problem_reports");
    expect(reportQueries.some((c) => Array.isArray(c.inStates)
      && ["reported", "under_review", "awaiting_evidence"].every((s) => c.inStates.includes(s)))).toBe(true);
    expect(reportQueries.some((c) => c.eqReportState === "resolved" && c.limit === 200)).toBe(true);
  });

  it("dedupes a report caught mid-transition in BOTH result sets, keeping the actionable copy", async () => {
    // A report that flips under_review -> resolved between the two awaited
    // queries appears in the unresolved set AND the resolved set. It must render
    // exactly once, as the unresolved (actionable) copy, not twice with two
    // contradictory states colliding React keys.
    h.unresolved = [report("racing", "under_review", "2026-09-08T10:00:00Z")];
    h.resolved = [report("racing", "resolved", "2026-09-08T10:00:00Z")];

    const r = await listOperationsProblemReports(OPS);
    expect(r.ok).toBe(true);
    const rows = (r as any).value;
    const ids = rows.map((x: any) => x.id);
    expect(ids.filter((id: string) => id === "racing").length).toBe(1);
    // First (unresolved) occurrence wins: the surviving copy is the actionable state.
    expect(rows.find((x: any) => x.id === "racing").state).toBe("under_review");
  });

  it("refuses a non-operations actor", async () => {
    const r = await listOperationsProblemReports({ kind: "member", userId: "u", membership: null } as any);
    expect(r.ok).toBe(false);
  });
});
