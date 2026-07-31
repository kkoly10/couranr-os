import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RPC, quoteArgs, shipmentArgs } from "@/lib/couranr/requests/commands";
import { isNormalizeFailure, normalizeDeliveryRequestInput } from "@/lib/couranr/requests/input";
import { quoteDelivery } from "@/lib/couranr/pricing";

const ROOT = path.resolve(__dirname, "..");
const COMMANDS_RAW = readFileSync(path.join(ROOT, "lib/couranr/requests/commands.ts"), "utf8");

/**
 * Comments legitimately name the patterns the code must NOT contain — the file
 * header says "there is no resilientUpdateById-style retry here". Matching the
 * raw text makes a test that fails on its own documentation, which has already
 * happened three times in this repo. Strip comments first.
 */
const COMMANDS = COMMANDS_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATIONS = path.resolve(ROOT, "supabase/migrations");
const FN_MIGRATION_NAME = readdirSync(MIGRATIONS).filter((f) =>
  f.endsWith("_couranr_request_commands.sql")
)[0];
const FN_SQL_RAW = readFileSync(path.join(MIGRATIONS, FN_MIGRATION_NAME), "utf8");
const FN_SQL = FN_SQL_RAW.replace(/^\s*--.*$/gm, "");

function draft(overrides: Record<string, unknown> = {}) {
  const r = normalizeDeliveryRequestInput({
    pickupAddress: { line1: "10 Market St", city: "Stafford", region: "VA", postalCode: "22554" },
    dropoffAddress: { line1: "9 Elm Ave", city: "Fredericksburg", region: "VA", postalCode: "22401" },
    loadedMiles: 4.2,
    weightLb: 12.5,
    ...overrides,
  });
  if (isNormalizeFailure(r)) throw new Error("fixture is invalid: " + JSON.stringify(r.errors));
  return r.value;
}

/**
 * The shipment arguments are built once and shared by create and re-estimate.
 *
 * The bug this guards against: re-estimate used to price the STORED row and
 * ignore the merchant's edits, so a merchant who changed the distance and
 * clicked "Calculate estimate" again was shown a price for the old distance.
 * Two separate argument lists would let the same drift return.
 */
describe("shipmentArgs", () => {
  const EXPECTED_KEYS = [
    "p_additional_stops",
    "p_dropoff_address",
    "p_loaded_miles",
    "p_overnight_requested",
    "p_payer_type",
    "p_pickup_address",
    "p_proof_method",
    "p_readiness_state",
    "p_recipient_email",
    "p_recipient_name",
    "p_recipient_phone",
    "p_service_level",
    "p_signature_required",
    "p_source",
    "p_weight_lb",
  ];

  it("covers every merchant-editable field", () => {
    expect(Object.keys(shipmentArgs(draft())).sort()).toEqual(EXPECTED_KEYS);
  });

  /** Identity and lifecycle are not the merchant's to edit. */
  it("names no identity or lifecycle field", () => {
    const keys = Object.keys(shipmentArgs(draft()));
    for (const forbidden of [
      "p_id",
      "p_business_account_id",
      "p_created_by",
      "p_idempotency_key",
      "p_request_state",
      "p_review_state",
      "p_service_area_review_state",
      "p_submitted_at",
      "p_version",
    ]) {
      expect(keys, `shipmentArgs sends ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("carries no money field at all", () => {
    for (const k of Object.keys(shipmentArgs(draft()))) {
      expect(k).not.toMatch(/cents|amount|price|subtotal|total/i);
    }
  });

  it("carries the overnight request, which has no column of its own", () => {
    expect(shipmentArgs(draft({ overnightRequested: true })).p_overnight_requested).toBe(true);
    expect(shipmentArgs(draft()).p_overnight_requested).toBe(false);
    // Overnight must never be smuggled in as a service level: the database
    // CHECK allows exactly standard, priority and rush.
    expect(shipmentArgs(draft({ overnightRequested: true })).p_service_level).toBe("standard");
  });

  it("both write paths use it, so they cannot drift", () => {
    // createDeliveryRequestDraft and calculateDeliveryRequestEstimate.
    expect((COMMANDS.match(/shipmentArgs\(draft\)/g) || []).length).toBe(2);
  });

  it("re-estimate accepts an edited shipment", () => {
    expect(COMMANDS).toMatch(/rawInput\?: unknown/);
    const route = readFileSync(
      path.join(ROOT, "app/api/couranr/delivery-requests/[id]/estimate/route.ts"),
      "utf8"
    );
    expect(route).toMatch(/rawInput: body\?\.request/);
  });
});

/**
 * `quoteArgs` is the single place a pricing result becomes RPC arguments.
 * The database re-checks every one of these, so each case here has a matching
 * CHECK or a CR422 guard on the other side.
 */
describe("quoteArgs", () => {
  const estimated = quoteDelivery({ loadedMiles: 4.2, weightLb: 12.5 });
  const manual = quoteDelivery({ loadedMiles: 4.2, weightLb: 12.5, overnightRequested: true });

  it("an estimate carries both the subtotal and the policy version", () => {
    const a = quoteArgs(estimated);
    expect(a.p_quote_status).toBe("estimated");
    expect(a.p_delivery_subtotal_cents).toBe(estimated.deliverySubtotalCents);
    expect(a.p_pricing_policy_version).toBeTruthy();
  });

  it("a manual-review quote carries no subtotal", () => {
    const a = quoteArgs(manual);
    expect(a.p_quote_status).toBe("manual_review_required");
    expect(a.p_delivery_subtotal_cents).toBe(null);
    expect(a.p_pricing_policy_version).toBe(null);
    expect(a.p_review_reasons).toContain("overnight_not_offered_in_this_release");
  });

  /**
   * The strongest form of "no client-provided payment amount": there is no
   * parameter to put one in, on either side of the wire.
   */
  it("sends no payment, rounding or tax argument at all", () => {
    for (const q of [estimated, manual]) {
      const keys = Object.keys(quoteArgs(q));
      expect(keys).not.toContain("p_payment_due_cents");
      expect(keys).not.toContain("p_rounding_applied");
      expect(keys).not.toContain("p_tax_included");
    }
  });

  it("the subtotal is exactly the sum of the line items it sends", () => {
    const a = quoteArgs(estimated);
    const sum = a.p_quote_line_items.reduce((n, li) => n + li.amountCents, 0);
    expect(a.p_delivery_subtotal_cents).toBe(sum);
    expect(Number.isInteger(sum)).toBe(true);
  });
});

/** Structural guarantees the whole command layer rests on. */
describe("command layer invariants", () => {
  it("does not reintroduce the resilientUpdateById retry pattern", () => {
    expect(COMMANDS).not.toMatch(/does not exist/i);
    expect(COMMANDS).not.toMatch(/resilientUpdate/i);
    // Positive control: the phrase IS present in the file, in a comment
    // explaining why the pattern is absent. Without this the assertions above
    // would pass even if comment-stripping silently removed everything.
    expect(COMMANDS_RAW).toMatch(/resilientUpdateById/);
    expect(COMMANDS.length).toBeGreaterThan(COMMANDS_RAW.length / 2);
  });

  it("never selects every column", () => {
    expect(COMMANDS).not.toMatch(/\.select\("\*"\)/);
  });

  /**
   * THE COMMIT I INVARIANT. Every mutation now goes through an RPC, so there is
   * no `.update()` and no `.insert()` left in this file to be a second
   * transaction alongside the first.
   */
  it("performs no direct update or insert", () => {
    expect(COMMANDS).not.toMatch(/\.update\(/);
    expect(COMMANDS).not.toMatch(/\.insert\(/);
  });

  it("has exactly one rpc call per mutating command", () => {
    // One helper definition plus four call sites.
    expect((COMMANDS.match(/callRpc\(/g) || []).length).toBe(5);
    expect((COMMANDS.match(/supabaseAdmin\.rpc\(/g) || []).length).toBe(1);
    for (const fn of Object.values(RPC)) {
      expect(COMMANDS_RAW, `no RPC name for ${fn}`).toContain(fn);
    }
  });

  it("uses the service-role client, never the browser client", () => {
    expect(COMMANDS).toMatch(/from "@\/lib\/supabaseAdmin"/);
    expect(COMMANDS).not.toMatch(/from "@\/lib\/supabaseClient"/);
  });
});

/**
 * The SQL side of the same guarantees. These read the migration that is
 * actually applied to production — the filename carries its version.
 */
describe("command functions migration", () => {
  it("is the version applied to production", () => {
    expect(FN_MIGRATION_NAME).toBe("20260731055802_couranr_request_commands.sql");
  });

  it("creates exactly the four named functions, and TypeScript calls those", () => {
    const created = Array.from(FN_SQL.matchAll(/create\s+function\s+(public\.\w+)/gi)).map((m) =>
      m[1].toLowerCase()
    );
    const expected = [
      "public.couranr_begin_delivery_request_review",
      "public.couranr_calculate_delivery_request_estimate",
      "public.couranr_create_delivery_request_draft",
      "public.couranr_submit_delivery_request",
    ];
    expect(created.sort()).toEqual(expected);
    expect(Object.values(RPC).map((n) => `public.${n}`).sort()).toEqual(expected);
  });

  it("is SECURITY INVOKER, never SECURITY DEFINER", () => {
    // Anchored to the DDL clause: the phrase also appears in the four
    // COMMENT ON strings, which are documentation, not enforcement.
    expect((FN_SQL.match(/language plpgsql\s+security invoker/g) || []).length).toBe(4);
    expect(/security\s+definer/i.test(FN_SQL)).toBe(false);
  });

  it("pins an empty search_path on every function", () => {
    expect((FN_SQL.match(/set\s+search_path\s*=\s*''/g) || []).length).toBe(4);
  });

  it("revokes EXECUTE from PUBLIC, anon and authenticated, then grants only service_role", () => {
    const revokes = FN_SQL.match(
      /revoke\s+all\s+on\s+function[\s\S]*?from\s+public,\s*anon,\s*authenticated,\s*service_role;/gi
    );
    expect(revokes).toHaveLength(4);
    const grants = FN_SQL.match(/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role;/gi);
    expect(grants).toHaveLength(4);
    // No other role may be granted anything.
    expect(/\bto\s+(anon|authenticated|public)\b/i.test(FN_SQL)).toBe(false);
  });

  it("hard-codes the columns that must never be parameters", () => {
    expect(FN_SQL).not.toMatch(/p_payment_due_cents/);
    expect(FN_SQL).not.toMatch(/p_rounding_applied/);
    expect(FN_SQL).not.toMatch(/p_tax_included/);
    // Two update branches in re-estimate plus submit assign the literal.
    expect((FN_SQL.match(/payment_due_cents\s*=\s*null/g) || []).length).toBe(3);
    expect((FN_SQL.match(/rounding_applied\s*=\s*false/g) || []).length).toBe(3);
  });

  it("accepts no target-state and no actor-type parameter", () => {
    expect(FN_SQL).not.toMatch(/p_request_state/);
    expect(FN_SQL).not.toMatch(/p_review_state/);
    expect(FN_SQL).not.toMatch(/p_to_state/);
    expect(FN_SQL).not.toMatch(/p_actor_type/);
    // The destination states are literals in the function bodies.
    expect(FN_SQL).toMatch(/request_state\s*=\s*'pending_couranr_review'/);
  });

  it("guards every update with id, business account, version and a fixed state", () => {
    const guards = FN_SQL.match(
      /where\s+id\s*=\s*p_request_id[\s\S]*?and\s+business_account_id\s*=\s*p_business_account_id[\s\S]*?and\s+version\s*=\s*p_expected_version[\s\S]*?and\s+request_state\s*=\s*'/gi
    );
    // Two branches of re-estimate, plus submit, plus begin-review.
    expect(guards).toHaveLength(4);
    expect((FN_SQL.match(/errcode\s*=\s*'CR409'/g) || []).length).toBe(3);
  });

  it("inserts an event in every mutating path", () => {
    const inserts = FN_SQL.match(/insert into public\.couranr_delivery_request_events/g) || [];
    expect(inserts.length).toBe(4);
  });

  it("checks quote integrity rather than trusting the caller's subtotal", () => {
    expect((FN_SQL.match(/quote_subtotal_mismatch/g) || []).length).toBe(3);
    expect((FN_SQL.match(/errcode\s*=\s*'CR422'/g) || []).length).toBe(12);
  });

  it("contains no destructive statement", () => {
    for (const rx of [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdelete\s+from\b/i,
      /\bdrop\s+policy\b/i,
      /\balter\s+table\b/i,
      /(^|;)\s*truncate\s+/i,
    ]) {
      expect(rx.test(FN_SQL), `migration must not contain ${rx}`).toBe(false);
    }
  });

  it("aborts rather than silently replacing an existing function", () => {
    expect(FN_SQL).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(FN_SQL).toMatch(/raise\s+exception/i);
    expect(FN_SQL).toMatch(/pg_catalog\.pg_proc/);
  });

  it("has a rollback that drops only these four, by full signature", () => {
    const rollback = readFileSync(
      path.join(MIGRATIONS, "20260731055802_couranr_request_commands.rollback.sql"),
      "utf8"
    ).replace(/^\s*--.*$/gm, "");
    const drops = Array.from(
      rollback.matchAll(/drop\s+function\s+if\s+exists\s+(public\.\w+)/gi)
    ).map((m) => m[1].toLowerCase());
    expect(drops.sort()).toEqual([
      "public.couranr_begin_delivery_request_review",
      "public.couranr_calculate_delivery_request_estimate",
      "public.couranr_create_delivery_request_draft",
      "public.couranr_submit_delivery_request",
    ]);
    expect(/drop\s+table/i.test(rollback)).toBe(false);
    expect(/delete\s+from\s+public/i.test(rollback)).toBe(false);
  });
});
