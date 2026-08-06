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

  /**
   * HOURS. Added when the owner resolved HRS-002 (timezone = America/New_York).
   *
   * The package registry carries the hours VALUES but has never carried a
   * timezone — `grep -c timezone` over it returns 0. So the package file is
   * left exactly as delivered: it is provenance, and editing it would destroy
   * the thing it exists to preserve. Consistency is enforced the other way
   * round, by pinning that root still agrees with every hours value the
   * package does carry.
   *
   * This check did not exist before. The suite verified pricing and state
   * vocabularies only, so the two files could have disagreed about the
   * operating window, the cutoff or the overnight surcharge and nothing would
   * have failed.
   */
  it("every hours value in the package registry agrees with the root registry", () => {
    const h = pkg.hours;
    const hrs001 = root.decisions.find((d: any) => d.id === "HRS-001");
    const ovn001 = root.decisions.find((d: any) => d.id === "OVN-001");
    const trm001 = root.decisions.find((d: any) => d.id === "TRM-001");
    expect(hrs001, "HRS-001").toBeTruthy();
    expect(ovn001, "OVN-001").toBeTruthy();
    expect(trm001, "TRM-001").toBeTruthy();

    expect(hrs001.value.days.map((x: string) => x.toLowerCase())).toEqual(h.days);
    expect(hrs001.value.standard_window.start).toBe(h.standard_start);
    expect(hrs001.value.standard_window.end).toBe(h.standard_end);
    expect(hrs001.value.same_day_request_cutoff).toBe(h.same_day_cutoff);

    expect(`${ovn001.value.window.start}-${ovn001.value.window.end}`).toBe(h.overnight_window);
    expect(ovn001.value.surcharge_cents).toBe(h.overnight_surcharge_cents);
    expect(ovn001.value.stacks_with_rush).toBe(h.rush_and_overnight_stack);

    expect(trm001.value.support_response_target_minutes).toBe(h.support_response_target_minutes);
  });

  /**
   * The two decisions the owner resolved on 2026-08-06. Pinned so a later edit
   * cannot quietly revert them to "unresolved" and re-open work that has now
   * shipped against them.
   */
  it("HRS-002 records a named IANA timezone as a decided owner decision", () => {
    const h = root.decisions.find((d: any) => d.id === "HRS-002");
    expect(h.status).toBe("decided");
    expect(h.value.timezone).toBe("America/New_York");
    expect(h.value.timezone_kind).toBe("IANA");
    expect(h.decided_by).toBe("owner");
    // A decided record must not still carry the unresolved-only keys.
    expect(h.missing).toBeUndefined();
    expect(h.blocked_screen_ids).toBeUndefined();
    // The window it governs must match HRS-001 rather than restate it differently.
    const hrs001 = root.decisions.find((d: any) => d.id === "HRS-001");
    expect(h.value.operating_window_local.start).toBe(hrs001.value.standard_window.start);
    expect(h.value.operating_window_local.end).toBe(hrs001.value.standard_window.end);
  });

  it("TRM-002 records an explicit permission set for all five roles", () => {
    const t = root.decisions.find((d: any) => d.id === "TRM-002");
    expect(t.status).toBe("decided");
    expect(t.decided_by).toBe("owner");
    const perms = t.value.permissions_per_role;
    expect(Object.keys(perms).sort()).toEqual(
      ["billing", "dispatcher", "manager", "owner", "viewer"]
    );
    // Every declared role must have a set — a missing role is the gap TRM-002 existed to close.
    for (const role of t.value.declared_roles) {
      expect(perms[role], `role ${role} has no permission set`).toBeTruthy();
      expect(typeof perms[role].conversation_read).toBe("boolean");
      expect(typeof perms[role].conversation_send).toBe("boolean");
    }
    // viewer and billing are refused BOTH, not merely send.
    for (const role of ["viewer", "billing"]) {
      expect(perms[role].conversation_read, `${role} must not read`).toBe(false);
      expect(perms[role].conversation_send, `${role} must not send`).toBe(false);
    }
    for (const role of ["owner", "manager", "dispatcher"]) {
      expect(perms[role].conversation_read, `${role} must read`).toBe(true);
      expect(perms[role].conversation_send, `${role} must send`).toBe(true);
    }
  });

  /**
   * OVN-002 is the trap next to HRS-002. Naming a timezone does NOT decide how
   * a merchant requests overnight or how Couranr enables it. If a later change
   * flips OVN-002 to decided without an owner saying so, overnight enablement
   * would be invented in code.
   */
  /**
   * THE SELF-CONTRADICTION THIS ALMOST SHIPPED.
   *
   * HRS-002 was flipped to `decided` with the zone recorded, while
   * HRS-001.value.standard_window.timezone_status still read the literal
   * string "unresolved". The rank-1 authority disagreed with itself about
   * whether the timezone was known, and nothing checked the two against each
   * other. Caught by an independent review pass, not by this suite.
   */
  it("HRS-001's window agrees with HRS-002 that the timezone is resolved", () => {
    const hrs001 = root.decisions.find((d: any) => d.id === "HRS-001");
    const hrs002 = root.decisions.find((d: any) => d.id === "HRS-002");
    const w = hrs001.value.standard_window;
    expect(w.timezone_status).toBe("resolved");
    expect(w.timezone).toBe(hrs002.value.timezone);
    expect(w.timezone_decided_by).toBe("HRS-002");
  });

  /**
   * OVN-001's window is the EXACT COMPLEMENT of HRS-001's. That is what forces
   * the end-exclusive boundary: 18:00 belongs to overnight, so if the standard
   * window also claimed it, a single instant would sit in both and a 3000-cent
   * surcharge would attach or not depending on evaluation order.
   */
  it("the standard and overnight windows tile the day with no overlap and no gap", () => {
    const hrs001 = root.decisions.find((d: any) => d.id === "HRS-001");
    const ovn001 = root.decisions.find((d: any) => d.id === "OVN-001");
    expect(ovn001.value.window.start).toBe(hrs001.value.standard_window.end);
    expect(ovn001.value.window.end).toBe(hrs001.value.standard_window.start);
    // ...and the boundary rule is stated on both sides, not left to the reader.
    expect(hrs001.value.standard_window.boundary_semantics).toMatch(/end exclusive/i);
    const hrs002 = root.decisions.find((d: any) => d.id === "HRS-002");
    expect(hrs002.value.boundary_semantics).toMatch(/end exclusive/i);
  });

  it("OVN-002 remains unresolved — a timezone does not decide the overnight enablement mechanism", () => {
    const o = root.decisions.find((d: any) => d.id === "OVN-002");
    expect(o.status).toBe("unresolved");
  });

  it("the package copy is marked non-authoritative", () => {
    const note = readFileSync(path.join(ROOT, "couranr_claude_code_package/00_PROVENANCE.md"), "utf8");
    expect(note).toMatch(/NOT the authority/i);
    expect(note).toMatch(/Cite the root/i);
  });
});
