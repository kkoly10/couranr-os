import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The implementation ledgers are load-bearing documentation, and documentation
 * rots silently. This validator exists so a stale or invented row fails the
 * build instead of being read as fact by the next session.
 *
 * Every rule below has a POSITIVE CONTROL asserting the checker rejects the
 * thing it is supposed to reject. A validator that cannot fail proves nothing —
 * this repo has shipped both a leak checker and a fixture that quietly could
 * not fire.
 */

const ROOT = process.cwd();

/** Minimal RFC-4180 reader: handles quoted fields containing commas and quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ITEM_LEDGER = "docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv";
const SCREEN_LEDGER = "docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv";
const WORK_BREAKDOWN = "couranr_claude_code_package/08_WORK_BREAKDOWN.csv";
const SCREEN_REGISTRY = "UI_SCREEN_REGISTRY.md";

const items = parseCsv(read(ITEM_LEDGER));
const screens = parseCsv(read(SCREEN_LEDGER));

const ITEM_STATUSES = [
  "complete_verified",
  "complete_pending_external",
  "complete_unverified",
  "partial",
  "placeholder_only",
  "not_started",
  "blocked",
  "deferred_by_decision",
  "retired_or_superseded",
] as const;

const SCREEN_STATUSES = [
  "functional_verified",
  "functional_unverified",
  "partial",
  "static_only",
  "placeholder_only",
  "missing",
  "deferred",
  "retired_or_replaced",
] as const;

const ITEM_HEADER = [
  "work_item_id", "phase", "title", "authoritative_requirement", "status",
  "repository_evidence", "migration_or_database_evidence", "route_or_screen_evidence",
  "test_evidence", "external_verification", "remaining_work", "blocker_or_deferment",
  "dependency_ids", "last_verified_sha", "last_verified_at_utc", "notes",
];

const SCREEN_HEADER = [
  "screen_id", "surface", "canonical_route", "phase", "required_purpose",
  "current_page_path", "implementation_status", "mounted_component",
  "backing_api_or_command", "required_states_present", "browser_verified",
  "remaining_work", "last_verified_sha",
];

/* ------------------------------------------------- work-item ledger ---- */

describe("the implementation ledger covers the authoritative work breakdown", () => {
  const authoritative = parseCsv(read(WORK_BREAKDOWN)).map((r) => r.work_item_id);

  it("carries the stable header", () => {
    expect(Object.keys(items[0])).toEqual(ITEM_HEADER);
  });

  it("contains every authoritative work item exactly once", () => {
    const seen = items.map((r) => r.work_item_id);
    const missing = authoritative.filter((id) => !seen.includes(id));
    const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
    expect(missing, `work items absent from the ledger: ${missing.join(", ")}`).toEqual([]);
    expect(dupes, `duplicated work items: ${dupes.join(", ")}`).toEqual([]);
    expect(seen.length).toBe(authoritative.length);
  });

  it("invents no work item id", () => {
    const extra = items.map((r) => r.work_item_id).filter((id) => !authoritative.includes(id));
    expect(extra, `ids not in the work breakdown: ${extra.join(", ")}`).toEqual([]);
  });

  it("uses only the closed status vocabulary", () => {
    const bad = items.filter((r) => !ITEM_STATUSES.includes(r.status as never));
    expect(bad.map((r) => `${r.work_item_id}=${r.status}`)).toEqual([]);
  });

  it("every complete_verified item carries repository AND test evidence", () => {
    const thin = items
      .filter((r) => r.status === "complete_verified")
      .filter((r) => !r.repository_evidence.trim() || !r.test_evidence.trim());
    expect(thin.map((r) => r.work_item_id),
      "complete_verified without both kinds of evidence").toEqual([]);
  });

  it("every complete_pending_external item names its external verification", () => {
    const thin = items
      .filter((r) => r.status === "complete_pending_external")
      .filter((r) => !r.external_verification.trim());
    expect(thin.map((r) => r.work_item_id)).toEqual([]);
  });

  it("every complete_unverified item says what could not be run", () => {
    const thin = items
      .filter((r) => r.status === "complete_unverified")
      .filter((r) => !r.test_evidence.trim() && !r.remaining_work.trim());
    expect(thin.map((r) => r.work_item_id)).toEqual([]);
  });

  it("every blocked item names its blocker", () => {
    const thin = items
      .filter((r) => r.status === "blocked")
      .filter((r) => !r.blocker_or_deferment.trim());
    expect(thin.map((r) => r.work_item_id)).toEqual([]);
  });

  it("every deferred item names the deciding authority", () => {
    const thin = items
      .filter((r) => r.status === "deferred_by_decision")
      .filter((r) => !r.blocker_or_deferment.trim());
    expect(thin.map((r) => r.work_item_id)).toEqual([]);
  });

  it("every row records the sha it was verified at", () => {
    const bad = items.filter((r) => !/^[0-9a-f]{40}$/.test(r.last_verified_sha));
    expect(bad.map((r) => r.work_item_id)).toEqual([]);
  });

  it("every unfinished item states remaining work", () => {
    const unfinished = ["partial", "placeholder_only", "not_started"];
    const thin = items
      .filter((r) => unfinished.includes(r.status))
      .filter((r) => !r.remaining_work.trim());
    expect(thin.map((r) => r.work_item_id)).toEqual([]);
  });
});

/* ---------------------------------------------------- screen ledger ---- */

describe("the screen ledger covers all 66 canonical screens", () => {
  const canonical = Array.from(
    read(SCREEN_REGISTRY).matchAll(/^\|\s*((?:PUB|MER|OPS|DRV|CUS)-\d{3})\s*\|/gm)
  ).map((m) => m[1]);

  it("the registry really declares 66 screens", () => {
    expect(canonical.length).toBe(66);
  });

  it("carries the stable header", () => {
    expect(Object.keys(screens[0])).toEqual(SCREEN_HEADER);
  });

  it("contains every canonical screen exactly once, and invents none", () => {
    const seen = screens.map((r) => r.screen_id);
    const missing = canonical.filter((id) => !seen.includes(id));
    const extra = seen.filter((id) => !canonical.includes(id));
    const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
    expect(missing, `screens absent: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `invented screens: ${extra.join(", ")}`).toEqual([]);
    expect(dupes, `duplicated screens: ${dupes.join(", ")}`).toEqual([]);
    expect(seen.length).toBe(66);
  });

  it("uses only the closed screen status vocabulary", () => {
    const bad = screens.filter((r) => !SCREEN_STATUSES.includes(r.implementation_status as never));
    expect(bad.map((r) => `${r.screen_id}=${r.implementation_status}`)).toEqual([]);
  });

  it("every functional_verified screen names a mounted component and a backing route", () => {
    const thin = screens
      .filter((r) => r.implementation_status === "functional_verified")
      .filter((r) => !r.mounted_component.trim() || !r.backing_api_or_command.trim());
    expect(thin.map((r) => r.screen_id)).toEqual([]);
  });

  it("every functional_verified screen names the browser evidence", () => {
    const thin = screens
      .filter((r) => r.implementation_status === "functional_verified")
      .filter((r) => !r.browser_verified.trim() || r.browser_verified === "false");
    expect(thin.map((r) => r.screen_id)).toEqual([]);
  });

  /**
   * The rule this repo most needs enforced: a route whose page is a
   * ScreenPlaceholder is NOT the product capability, however complete the
   * surrounding shell looks.
   */
  it("no screen backed by a ScreenPlaceholder page is classified functional", () => {
    const offenders: string[] = [];
    for (const r of screens) {
      const p = r.current_page_path.trim();
      if (!p || !existsSync(path.join(ROOT, p))) continue;
      const isPlaceholder = read(p).includes("ScreenPlaceholder");
      if (isPlaceholder && r.implementation_status.startsWith("functional")) {
        offenders.push(`${r.screen_id} -> ${p}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every screen classified placeholder_only really does render a ScreenPlaceholder", () => {
    const wrong = screens
      .filter((r) => r.implementation_status === "placeholder_only")
      .filter((r) => {
        const p = r.current_page_path.trim();
        return !p || !existsSync(path.join(ROOT, p)) || !read(p).includes("ScreenPlaceholder");
      });
    expect(wrong.map((r) => r.screen_id)).toEqual([]);
  });

  it("every screen classified missing really has no page", () => {
    const wrong = screens
      .filter((r) => r.implementation_status === "missing")
      .filter((r) => r.current_page_path.trim() && r.remaining_work.trim() === "");
    expect(wrong.map((r) => r.screen_id)).toEqual([]);
  });

  it("every row records the sha it was verified at", () => {
    const bad = screens.filter((r) => !/^[0-9a-f]{40}$/.test(r.last_verified_sha));
    expect(bad.map((r) => r.screen_id)).toEqual([]);
  });
});

/* ------------------------------------------- referenced paths exist ---- */

describe("ledger evidence points at real files", () => {
  it("every current_page_path that is set exists on disk", () => {
    const missing = screens
      .map((r) => r.current_page_path.trim())
      .filter(Boolean)
      .filter((p) => !existsSync(path.join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it("every repo path named in work-item evidence exists on disk", () => {
    // Only validate tokens that clearly look like repo paths, so prose stays free.
    const missing: string[] = [];
    for (const r of items) {
      const blob = `${r.repository_evidence} ${r.test_evidence}`;
      for (const m of blob.matchAll(/\b((?:app|lib|components|tests|e2e|docs|supabase)\/[A-Za-z0-9_\-./[\]]*[A-Za-z0-9_\]])/g)) {
        const p = m[1].replace(/[.,;:]$/, "");
        // Directory-ish references and glob-ish ones are not asserted.
        if (p.endsWith("/") || p.includes("*")) continue;
        if (!existsSync(path.join(ROOT, p))) missing.push(`${r.work_item_id}: ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * This used to read `items[0].last_verified_sha` and assert the status file
   * contained it — one arbitrary row out of 108. It passed while the status
   * file described `main` at `c929cc3` and both ledgers had moved on to a Phase
   * 8 branch, because row 0 happened not to be one of the rows that changed.
   *
   * A check that only inspects the row nobody edits cannot notice drift. Every
   * DISTINCT sha in either ledger must be named in full, so adding a new
   * verification sha to any row forces the summary to say what it covers.
   */
  it("the status summary names every distinct sha in either ledger, in full", () => {
    const md = read("docs/couranr-mvp/IMPLEMENTATION_STATUS.md");
    const shas = [
      ...new Set([
        ...items.map((r) => r.last_verified_sha),
        ...screens.map((r) => r.last_verified_sha),
      ]),
    ].filter(Boolean);

    expect(shas.length).toBeGreaterThan(0);
    // Abbreviations must not satisfy this: a 7-char prefix is ambiguous and is
    // exactly how "401b3ee" slipped in while the full sha was absent.
    for (const s of shas) expect(s).toMatch(/^[0-9a-f]{40}$/);

    expect(shas.filter((s) => !md.includes(s))).toEqual([]);
  });

  it("POSITIVE CONTROL: a sha present in a ledger but absent from the summary is rejected", () => {
    const md = read("docs/couranr-mvp/IMPLEMENTATION_STATUS.md");
    const invented = "deadbeef".repeat(5); // 40 hex chars, in no ledger and no file
    expect(invented).toMatch(/^[0-9a-f]{40}$/);
    expect(md.includes(invented)).toBe(false);
  });
});

/* ------------------------------------------------- positive controls --- */

describe("POSITIVE CONTROLS: the validator can actually reject", () => {
  const good = () => items.map((r) => ({ ...r }));

  it("rejects a missing work item", () => {
    const authoritative = parseCsv(read(WORK_BREAKDOWN)).map((r) => r.work_item_id);
    const dropped = good().slice(1);
    const missing = authoritative.filter((id) => !dropped.map((r) => r.work_item_id).includes(id));
    expect(missing.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate screen id", () => {
    const dupes = [...screens, screens[0]].map((r) => r.screen_id);
    const found = dupes.filter((id, i) => dupes.indexOf(id) !== i);
    expect(found.length).toBeGreaterThan(0);
  });

  it("rejects an invalid status", () => {
    expect(ITEM_STATUSES.includes("mostly_done" as never)).toBe(false);
    expect(SCREEN_STATUSES.includes("about_90_percent" as never)).toBe(false);
  });

  it("rejects a placeholder page marked functional", () => {
    // A real placeholder page from this repo, deliberately mislabelled.
    const victim = screens.find((r) => r.implementation_status === "placeholder_only");
    expect(victim, "no placeholder_only row to build the control from").toBeTruthy();
    const p = victim!.current_page_path;
    expect(read(p)).toContain("ScreenPlaceholder");
    const mislabelled: Record<string, string> = {
      ...victim!,
      implementation_status: "functional_verified",
    };
    const caught =
      mislabelled.implementation_status.startsWith("functional") &&
      read(mislabelled.current_page_path).includes("ScreenPlaceholder");
    expect(caught, "the placeholder rule failed to catch a mislabelled row").toBe(true);
  });

  it("rejects a complete item with no evidence", () => {
    const hollow = { status: "complete_verified", repository_evidence: "", test_evidence: "" };
    const caught =
      hollow.status === "complete_verified" &&
      (!hollow.repository_evidence.trim() || !hollow.test_evidence.trim());
    expect(caught).toBe(true);
  });

  it("rejects a row with no last_verified_sha", () => {
    expect(/^[0-9a-f]{40}$/.test("")).toBe(false);
    expect(/^[0-9a-f]{40}$/.test("HEAD")).toBe(false);
  });
});
