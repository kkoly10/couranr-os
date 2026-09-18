import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * /how-it-works advertises what Couranr collects at pickup. This ties that list
 * to the command the application actually calls, because the page had drifted
 * two items ahead of it for months and every gate stayed green.
 *
 * IT ADVERTISED A CONDITION PHOTO AND A PACKAGE COUNT. Neither is collected:
 * `condition_photo_required` is raised only inside the v1
 * `couranr_complete_pickup`, which no application code calls, and the v2
 * command inserts `observed_package_count` as a literal null. PRF-002 had
 * already amended PRF-001 to drop both — the page was rendering the superseded
 * decision record.
 *
 * THE TRAP THIS AVOIDS. Reading "the migration that defines the function" is not
 * the same as reading the function the app calls: `couranr_complete_pickup_v2`
 * has been defined three times, and only the LAST definition is live. This test
 * resolves it the way the database does — by name, last definition wins.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
/* Comments explain WHY an item was removed and quote its old name to do so, so
   asserting over raw source matches the explanation rather than the list. This
   repo has been bitten by that three times; strip first, assert second. */
const code = (p: string) =>
  read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
const PAGE = "app/(couranr)/(public)/(business-public)/how-it-works/page.tsx";

/** The LAST definition of a function across migrations, in filename order. */
function currentDefinition(fnName: string): { file: string; body: string } {
  const dir = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), "utf8");
    const at = sql.indexOf(`function public.${fnName}(`);
    if (at === -1) continue;
    const end = sql.indexOf("$fn$;", at);
    found = { file: f, body: sql.slice(at, end === -1 ? undefined : end) };
  }
  if (!found) throw new Error(`no definition of ${fnName}`);
  return found;
}

describe("the pickup proof list matches the command the app calls", () => {
  const called = (() => {
    const src = read("lib/couranr/driver/commands.ts");
    const m = /callRpc\("completePickup",\s*"([a-z0-9_]+)"/.exec(src);
    return m?.[1] ?? "";
  })();

  it("the app calls couranr_complete_pickup_v2, not the v1 command", () => {
    expect(called).toBe("couranr_complete_pickup_v2");
    // Non-vacuous: prove v1 exists and is genuinely uncalled.
    const callers = read("lib/couranr/driver/commands.ts");
    expect(callers).not.toMatch(/"couranr_complete_pickup"/);
  });

  it("collects NO condition photo, so the page may not advertise one", () => {
    const { body } = currentDefinition(called);
    expect(body, "the live command now mentions a condition photo").not.toContain(
      "condition_photo"
    );
    expect(code(PAGE), "/how-it-works still advertises a condition photo").not.toMatch(
      /"Condition photo"/
    );
  });

  it("records a NULL package count, so the page may not advertise one", () => {
    const { body } = currentDefinition(called);
    expect(body, "the live command no longer writes observed_package_count").toContain(
      "observed_package_count"
    );
    /* It is in the INSERT column list and its value is null — the count is a
       column the command fills in with nothing, not a fact it collects. */
    expect(body).toMatch(/observed_package_count[\s\S]{0,200}values[\s\S]{0,120}\bnull\b/);
    expect(code(PAGE), "/how-it-works still advertises a package count").not.toMatch(
      /"Package count"/
    );
  });

  it("still advertises what the command DOES require", () => {
    // POSITIVE CONTROL. Without it, an empty list would pass everything above.
    const { body } = currentDefinition(called);
    const page = code(PAGE);
    expect(page).toMatch(/"Merchant pickup PIN"/);
    expect(body).toContain("pickup_code_not_accepted");
    expect(page).toMatch(/"Shipment photo"/);
    expect(body).toContain("shipment_photo_required");
    expect(page).toMatch(/"Timestamp and location"/);
    expect(body).toContain("location_required");
  });

  it("PRF-002 is the current authority and it amends PRF-001", () => {
    const reg = JSON.parse(read("02_DECISION_REGISTRY.json"));
    const prf2 = reg.decisions.find((r: { id: string }) => r.id === "PRF-002");
    expect(prf2, "PRF-002 is missing").toBeTruthy();
    expect(prf2.amends).toBe("PRF-001");
    expect(JSON.stringify(prf2)).toMatch(/package count/i);
  });
});
