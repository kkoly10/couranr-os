import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_STATES,
  PAYMENT_STATES,
  REACHABLE_PAYMENT_STATES,
  UNREACHABLE_PAYMENT_STATES,
} from "@/lib/couranr/payments/states";

/**
 * Vocabulary preservation, guarded.
 *
 * `payment_method_saved` and `partially_refunded` are in the CHECK so that
 * shipping them later is a transition rather than a constraint rewrite on a
 * table holding money. The danger is that "declared" quietly becomes
 * "reachable" — a stray `payment_state = 'partially_refunded'` in some future
 * command would do it silently. So both halves are asserted: the constraint
 * ACCEPTS them, and nothing WRITES them.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const FORWARD = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort();
const SQL = FORWARD.map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .replace(/^\s*--.*$/gm, "");

/** The EFFECTIVE payment-state CHECK: the last definition wins. */
function effectivePaymentStates(): string[] {
  const at = SQL.lastIndexOf("couranr_po_payment_state_chk");
  expect(at).toBeGreaterThan(-1);
  const open = SQL.indexOf("(", SQL.indexOf("check", at));
  let depth = 0;
  let close = -1;
  for (let i = open; i < SQL.length; i++) {
    if (SQL[i] === "(") depth++;
    else if (SQL[i] === ")") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  return (SQL.slice(open, close + 1).match(/'([a-z_]+)'/g) || []).map((s) => s.slice(1, -1));
}

describe("canonical payment vocabulary", () => {
  it("the CHECK accepts both preserved values", () => {
    const inSql = effectivePaymentStates();
    expect(inSql).toContain("payment_method_saved");
    expect(inSql).toContain("partially_refunded");
    // And still every value that was already there.
    for (const s of ["not_started","requires_action","authorized","capture_pending",
                     "captured","failed","cancelled","refunded"]) {
      expect(inSql, `${s} was dropped from the vocabulary`).toContain(s);
    }
    expect(inSql).toHaveLength(10);
  });

  it("TypeScript and the database agree on the whole vocabulary", () => {
    expect(effectivePaymentStates().sort()).toEqual([...PAYMENT_STATES].sort());
  });

  /** The half that matters: declared is not the same as reachable. */
  it("no command writes a preserved-only state", () => {
    for (const s of ["payment_method_saved", "partially_refunded", "refunded"]) {
      expect(SQL, `${s} is assigned somewhere`).not.toMatch(
        new RegExp(`set\\s+payment_state\\s*=\\s*'${s}'`)
      );
      expect(SQL, `${s} is a transition target`).not.toMatch(
        new RegExp(`v_target\\s*:=\\s*'${s}'`)
      );
      expect(SQL, `${s} appears in an update`).not.toMatch(
        new RegExp(`payment_state\\s*=\\s*'${s}'\\s*,`)
      );
    }
  });

  it("every reachable state has a writer, so this test cannot pass vacuously", () => {
    // Positive control: capture_pending and captured DO have writers, which
    // proves the regex above is capable of finding one.
    for (const s of CAPTURE_STATES) {
      expect(SQL, `${s} has no writer`).toMatch(
        new RegExp(`set\\s+payment_state\\s*=\\s*'${s}'|payment_state\\s*=\\s*'${s}',`)
      );
    }
  });

  it("the reachable and unreachable sets partition the vocabulary", () => {
    expect([...REACHABLE_PAYMENT_STATES, ...UNREACHABLE_PAYMENT_STATES].sort()).toEqual(
      [...PAYMENT_STATES].sort()
    );
    expect([...UNREACHABLE_PAYMENT_STATES].sort()).toEqual([
      "partially_refunded",
      "payment_method_saved",
      "refunded",
    ]);
  });

  it("nothing in the app implements saved methods or partial refunds", () => {
    const ts = ["commands.ts", "stripe.ts", "states.ts"]
      .map((f) => readFileSync(path.join(ROOT, "lib/couranr/payments", f), "utf8"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(ts).not.toMatch(/setupIntents|setup_intent/);
    expect(ts).not.toMatch(/refunds\.create|amount_to_refund/);
    expect(ts).not.toMatch(/savePaymentMethod|setup_future_usage/);
  });
});
