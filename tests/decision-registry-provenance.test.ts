import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the two-registry hazard created by unpacking
 * `Couranr_Claude_Code_Implementation_Package.zip`.
 *
 * There are now two files named `02_DECISION_REGISTRY.json`:
 *
 *   couranr_claude_code_package/  the original v1.0 topic-keyed source
 *   repo root                     the rank-1 authority, 40 decision records
 *
 * CLAUDE.md names `02_DECISION_REGISTRY.json` as rank-1 authority for pricing,
 * hours, payer behaviour, states and launch gates. Two files with that exact
 * name, different shapes, and different contents is a live trap: a grep finds
 * the wrong one and the wrong number ships.
 *
 * These assertions pin the relationship the provenance note claims — the root
 * is a SUPERSET — so the two cannot silently diverge.
 */

const ROOT = path.resolve(__dirname, "..");
const ROOT_REGISTRY = path.join(ROOT, "02_DECISION_REGISTRY.json");
const PKG_REGISTRY = path.join(ROOT, "couranr_claude_code_package/02_DECISION_REGISTRY.json");

const rootRaw = readFileSync(ROOT_REGISTRY, "utf8");
const root = JSON.parse(rootRaw);
const pkg = JSON.parse(readFileSync(PKG_REGISTRY, "utf8"));

describe("the two decision registries stay in their documented relationship", () => {
  it("both files exist and are the shapes the provenance note describes", () => {
    expect(existsSync(ROOT_REGISTRY)).toBe(true);
    expect(existsSync(PKG_REGISTRY)).toBe(true);
    // Root: decision records. Package: topic-keyed.
    expect(Array.isArray(root.decisions)).toBe(true);
    expect(root.decisions.length).toBeGreaterThanOrEqual(40);
    expect(pkg.decisions).toBeUndefined();
    expect(Object.keys(pkg)).toEqual(expect.arrayContaining(["pricing", "states", "hours", "payers"]));
  });

  /**
   * The superset claim, checked against the values that actually matter. These
   * are the numbers CLAUDE.md flags as conflicting with shipped code, so a
   * regression here would let the wrong price reach a merchant.
   */
  it("every pricing value in the package registry is present in the root registry", () => {
    const p = pkg.pricing;
    const expected: Array<[string, number]> = [
      ["base first 3 loaded miles", p.base_first_3_loaded_miles_cents],
      ["priority", p.priority_cents],
      ["rush", p.rush_cents],
      ["overnight", p.overnight_cents],
      ["additional stop", p.additional_stop_cents],
      ["signature", p.signature_cents],
      ["rounding increment", p.rounding_increment_cents],
      ["return minimum", p.return_minimum_cents],
      ["route saver per stop", p.route_saver.start_cents_per_stop],
      ...p.distance_tiers.map(
        (t: any): [string, number] => [`per-mile ${t.start_mile}-${t.end_mile}`, t.cents_per_mile]
      ),
    ];

    const missing = expected.filter(([, v]) => !rootRaw.includes(String(v)));
    expect(
      missing.map(([k, v]) => `${k}=${v}`),
      "package pricing values absent from the root registry"
    ).toEqual([]);
  });

  it("the canonical state vocabularies agree exactly", () => {
    // The root records these as decision STA-001; the package as `states`.
    const sta = root.decisions.find((d: any) => d.id === "STA-001");
    expect(sta, "STA-001 must exist in the root registry").toBeTruthy();
    for (const group of ["request", "payment", "readiness", "review", "incident"]) {
      expect(sta.value[group], `state group ${group}`).toEqual(pkg.states[group]);
    }
  });

  /**
   * Positive control: the superset check must be capable of failing. A value
   * that is not in the root registry has to be reported as missing.
   */
  it("the superset check DOES detect an absent value", () => {
    const absurd = 987654321;
    expect(rootRaw.includes(String(absurd))).toBe(false);
  });

  it("the package copy is marked non-authoritative", () => {
    const note = readFileSync(path.join(ROOT, "couranr_claude_code_package/00_PROVENANCE.md"), "utf8");
    expect(note).toMatch(/NOT the authority/i);
    expect(note).toMatch(/Cite the root/i);
  });
});
