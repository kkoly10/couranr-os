import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RPC, quoteArgs, shipmentArgs } from "@/lib/couranr/requests/commands";
import { classifyDatabaseError } from "@/lib/couranr/errors";
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

/** Every forward migration, comments stripped. Rollbacks are not applied. */
const ALL_FORWARD_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .replace(/^\s*--.*$/gm, "");

const RO_MIGRATION_NAME = readdirSync(MIGRATIONS).filter((f) =>
  f.endsWith("_couranr_review_outcomes.sql")
)[0];
const RO_SQL = readFileSync(path.join(MIGRATIONS, RO_MIGRATION_NAME), "utf8").replace(
  /^\s*--.*$/gm,
  ""
);

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
    // One helper definition plus one call site per mutating command. Seven
    // commands now: create, estimate, submit, begin-review, and the three
    // review outcomes.
    expect(Object.keys(RPC)).toHaveLength(7);
    expect((COMMANDS.match(/callRpc\(/g) || []).length).toBe(1 + Object.keys(RPC).length);
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

  it("creates exactly the four named functions", () => {
    const created = Array.from(FN_SQL.matchAll(/create\s+function\s+(public\.\w+)/gi)).map((m) =>
      m[1].toLowerCase()
    );
    expect(created.sort()).toEqual([
      "public.couranr_begin_delivery_request_review",
      "public.couranr_calculate_delivery_request_estimate",
      "public.couranr_create_delivery_request_draft",
      "public.couranr_submit_delivery_request",
    ]);
  });

  /**
   * The RPC map is no longer satisfied by one migration — the review outcomes
   * arrived in a later one, and `couranr_submit_delivery_request` was dropped
   * and recreated there with a twelfth parameter. So the correspondence is
   * checked against ALL forward migrations, which is what production actually
   * has.
   */
  it("every name TypeScript calls is created by some forward migration", () => {
    const createdAnywhere = new Set(
      Array.from(ALL_FORWARD_SQL.matchAll(/create\s+function\s+public\.(\w+)/gi)).map((m) =>
        m[1].toLowerCase()
      )
    );
    for (const fn of Object.values(RPC)) {
      expect(createdAnywhere.has(fn.toLowerCase()), `${fn} is called but never created`).toBe(true);
    }
    // Negative control: the check can fail.
    expect(createdAnywhere.has("couranr_not_a_real_function")).toBe(false);
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

/**
 * The review-outcome migration (REV-001). Same guarantees as the command
 * migration above, asserted against its own file — a new migration that
 * inherits none of the earlier checks is how a SECURITY DEFINER or a
 * client-supplied amount gets in.
 */
describe("review outcome functions migration", () => {
  it("is the version applied to production", () => {
    expect(RO_MIGRATION_NAME).toBe("20260731180000_couranr_review_outcomes.sql");
  });

  it("creates exactly the three outcome commands plus the re-signed submit", () => {
    const created = Array.from(RO_SQL.matchAll(/create\s+function\s+(public\.\w+)/gi)).map((m) =>
      m[1].toLowerCase()
    );
    expect(created.sort()).toEqual([
      "public.couranr_accept_delivery_request_as_quoted",
      "public.couranr_decline_delivery_request",
      "public.couranr_requote_delivery_request",
      "public.couranr_submit_delivery_request",
    ]);
  });

  it("is SECURITY INVOKER with an empty search_path on every function", () => {
    expect((RO_SQL.match(/language plpgsql\s+security invoker/g) || []).length).toBe(4);
    expect(/security\s+definer/i.test(RO_SQL)).toBe(false);
    expect((RO_SQL.match(/set\s+search_path\s*=\s*''/g) || []).length).toBe(4);
  });

  it("revokes EXECUTE from PUBLIC, anon, authenticated and service_role, then re-grants only service_role", () => {
    const revokes = RO_SQL.match(
      /revoke\s+all\s+on\s+function[\s\S]*?from\s+public,\s*anon,\s*authenticated,\s*service_role;/gi
    );
    expect(revokes).toHaveLength(4);
    const grants = RO_SQL.match(/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role;/gi);
    expect(grants).toHaveLength(4);
    expect(/\bto\s+(anon|authenticated|public)\b/i.test(RO_SQL)).toBe(false);
  });

  /**
   * The core of REV-001: no caller names where the request lands, and no
   * caller names the price. Both are literals inside the function bodies.
   */
  it("accepts no target state and no amount from a caller", () => {
    expect(RO_SQL).not.toMatch(/p_request_state/);
    expect(RO_SQL).not.toMatch(/p_review_state/);
    expect(RO_SQL).not.toMatch(/p_to_state/);
    expect(RO_SQL).not.toMatch(/p_actor_type/);
    expect(RO_SQL).not.toMatch(/p_payment_due_cents/);
    expect(RO_SQL).not.toMatch(/p_rounding_applied/);
    expect(RO_SQL).not.toMatch(/p_tax_included/);

    // Confirm-as-quoted takes NO amount parameter at all — it reads the
    // subtotal off the stored request.
    const accept = RO_SQL.slice(
      RO_SQL.indexOf("create function public.couranr_accept_delivery_request_as_quoted"),
      RO_SQL.indexOf("create function public.couranr_requote_delivery_request")
    );
    expect(accept.length).toBeGreaterThan(500);
    expect(accept).not.toMatch(/p_delivery_subtotal_cents/);
    expect(accept).toMatch(/v_current\.delivery_subtotal_cents/);
  });

  it("hard-codes each outcome's destination as a literal", () => {
    expect(RO_SQL).toMatch(/v_target\s*:=\s*'confirmed'/);
    expect(RO_SQL).toMatch(/v_target\s*:=\s*'awaiting_quote_acceptance'/);
    expect(RO_SQL).toMatch(/request_state\s*=\s*'quote_revision_required'/);
    expect(RO_SQL).toMatch(/request_state\s*=\s*'declined'/);
  });

  /**
   * The acknowledgment gate. Absence must raise, not fall through to a
   * confirm — the owner's instruction was explicit that an absent
   * acknowledgment returns a stable conflict.
   */
  it("refuses a merchant-paid confirm without an acknowledgment", () => {
    expect(RO_SQL).toMatch(/merchant_acknowledgment_missing'\s+using\s+errcode\s*=\s*'CR409'/);
    expect(RO_SQL).toMatch(/quote_revised_since_acknowledgment'\s+using\s+errcode\s*=\s*'CR409'/);
    // The acknowledgment is read from the event log, not from a parameter.
    expect(RO_SQL).toMatch(/from public\.couranr_delivery_request_events/);
    expect(RO_SQL).toMatch(/v_ack\s*->>\s*'acknowledgment'/);
  });

  /**
   * The submission event records the STORED quote. If any of these read a
   * `p_` parameter instead of `v_row`, a browser-supplied subtotal would be
   * what accept-as-quoted later compares against — which defeats the gate.
   */
  it("writes the submission acknowledgment from the stored row, never from a parameter", () => {
    const submit = RO_SQL.slice(
      RO_SQL.indexOf("create function public.couranr_submit_delivery_request"),
      RO_SQL.indexOf("create function public.couranr_accept_delivery_request_as_quoted")
    );
    const metadata = submit.slice(submit.indexOf("jsonb_build_object"));
    expect(metadata).toMatch(/'deliverySubtotalCents',\s*v_row\.delivery_subtotal_cents/);
    expect(metadata).toMatch(/'pricingPolicyVersion',\s*v_row\.pricing_policy_version/);
    expect(metadata).toMatch(/'payerType',\s*v_row\.payer_type/);
    // The only p_ value in the metadata is the flag itself.
    const pRefs = metadata.match(/p_\w+/g) || [];
    expect(pRefs).toEqual(["p_merchant_acknowledged"]);
  });

  it("guards every update with id, business account, version and both fixed states", () => {
    const guards = RO_SQL.match(
      /where\s+id\s*=\s*p_request_id[\s\S]*?and\s+business_account_id\s*=\s*p_business_account_id[\s\S]*?and\s+version\s*=\s*p_expected_version[\s\S]*?and\s+request_state\s*=\s*'/gi
    );
    // submit, accept, requote, decline.
    expect(guards).toHaveLength(4);
    // The three outcomes additionally require review_state = 'pending'.
    expect((RO_SQL.match(/and\s+review_state\s*=\s*'pending'/g) || []).length).toBe(3);
  });

  it("inserts an event in every mutating path", () => {
    expect(
      (RO_SQL.match(/insert into public\.couranr_delivery_request_events/g) || []).length
    ).toBe(4);
  });

  it("requires a reason for requote and decline", () => {
    expect(RO_SQL).toMatch(/requote_reason_required'\s+using\s+errcode\s*=\s*'CR422'/);
    expect(RO_SQL).toMatch(/decline_reason_required'\s+using\s+errcode\s*=\s*'CR422'/);
    // A revised quote's parts must still add up.
    expect((RO_SQL.match(/quote_subtotal_mismatch/g) || []).length).toBe(2);
  });

  /**
   * ADDITIVE. The one `alter table` is the CHECK widening and nothing else —
   * asserted by shape, because "no alter table at all" would have been a lie
   * here and a weaker guard than naming what the alter is allowed to do.
   */
  it("is additive: no table, column or row is destroyed", () => {
    for (const rx of [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdelete\s+from\b/i,
      /\bdrop\s+policy\b/i,
      /(^|;)\s*truncate\s+/i,
      /\bdrop\s+index\b/i,
    ]) {
      expect(rx.test(RO_SQL), `migration must not contain ${rx}`).toBe(false);
    }

    // Take each `alter table` statement whole, to its terminating semicolon,
    // and require it to be about the one constraint being widened. Matching a
    // short prefix instead would pass on `... drop constraint if` and prove
    // nothing about which constraint is touched.
    const alters: string[] = [];
    for (const m of RO_SQL.matchAll(/alter\s+table/gi)) {
      const end = RO_SQL.indexOf(";", m.index);
      expect(end, "an alter table statement is unterminated").toBeGreaterThan(m.index);
      alters.push(RO_SQL.slice(m.index, end));
    }
    expect(alters).toHaveLength(2);
    for (const a of alters) {
      expect(a.toLowerCase()).toContain("couranr_dre_command_chk");
      expect(a.toLowerCase()).toContain("couranr_delivery_request_events");
      expect(/\b(drop|add)\s+constraint\b/i.test(a), `not a constraint change: ${a}`).toBe(true);
    }
  });

  /**
   * Widening only. Every command the old constraint allowed must still be
   * allowed, or an existing event row would become invalid.
   */
  it("only widens the event command allow-list", () => {
    const before = ["create_delivery_request_draft", "calculate_delivery_request_estimate",
      "submit_delivery_request", "begin_delivery_request_review"];
    const add = RO_SQL.slice(RO_SQL.indexOf("add constraint couranr_dre_command_chk"));
    const listed = (add.slice(0, add.indexOf(";")).match(/'([a-z_]+)'/g) || []).map((s) =>
      s.slice(1, -1)
    );
    for (const c of before) {
      expect(listed, `${c} was dropped from the allow-list`).toContain(c);
    }
    expect(listed).toHaveLength(7);
  });

  it("drops the submit function by its exact prior signature", () => {
    // The 11-parameter form that 20260731055802 created. A mismatched
    // signature would leave BOTH overloads live and make every named-argument
    // call ambiguous.
    expect(RO_SQL).toMatch(
      /drop function if exists public\.couranr_submit_delivery_request\(\s*uuid,\s*uuid,\s*integer,\s*uuid,\s*text,\s*text,\s*integer,\s*integer,\s*numeric,\s*jsonb,\s*jsonb\s*\)/
    );
    expect(RO_SQL).not.toMatch(/create\s+or\s+replace\s+function/i);
  });

  it("has a rollback that refuses to rewrite the append-only log", () => {
    const rb = readFileSync(
      path.join(MIGRATIONS, "20260731180000_couranr_review_outcomes.rollback.sql"),
      "utf8"
    );
    expect(rb).toMatch(/refusing to narrow couranr_dre_command_chk/);
    expect(rb).toMatch(/drop function if exists public\.couranr_accept_delivery_request_as_quoted/);
    expect(rb).toMatch(/drop function if exists public\.couranr_requote_delivery_request/);
    expect(rb).toMatch(/drop function if exists public\.couranr_decline_delivery_request/);
    // Restores the 11-parameter submit rather than leaving none.
    expect(rb).toMatch(/create function public\.couranr_submit_delivery_request/);
    for (const rx of [/\bdrop\s+table\b/i, /\bdelete\s+from\s+public\./i, /truncate/i]) {
      expect(rx.test(rb), `rollback must not contain ${rx}`).toBe(false);
    }
  });
});

/**
 * The acknowledgment refusal and a concurrency race are both "conflicts" and
 * they need OPPOSITE advice. While they shared CR409 the operator was told to
 * reload for a condition reloading cannot change. These assertions pin the
 * split at every enforcement point, because it is only correct if all three
 * agree: the SQL that raises, the classifier that maps, and the UI that reads.
 */
describe("a missing acknowledgment is a different conflict from a stale version", () => {
  /** The LAST definition of the function across forward migrations wins. */
  const acceptBody = (() => {
    const at = ALL_FORWARD_SQL.lastIndexOf(
      "create function public.couranr_accept_delivery_request_as_quoted"
    );
    expect(at, "the accept command is never created").toBeGreaterThan(-1);
    return ALL_FORWARD_SQL.slice(at, ALL_FORWARD_SQL.indexOf("$fn$;", at) + 5);
  })();

  it("the EFFECTIVE accept command raises CR412 for both acknowledgment failures", () => {
    expect(acceptBody).toMatch(/merchant_acknowledgment_missing'\s+using\s+errcode\s*=\s*'CR412'/);
    expect(acceptBody).toMatch(
      /quote_revised_since_acknowledgment'\s+using\s+errcode\s*=\s*'CR412'/
    );
  });

  it("a genuine stale-version conflict is still CR409", () => {
    expect(acceptBody).toMatch(/version_or_state_conflict'\s+using\s+errcode\s*=\s*'CR409'/);
    // Exactly one CR409 in this function: the compare-and-set failure.
    expect((acceptBody.match(/CR409/g) || []).length).toBe(1);
    expect((acceptBody.match(/CR412/g) || []).length).toBe(2);
  });

  it("the classifier maps the two codes to two different public codes", () => {
    expect(classifyDatabaseError({ code: "CR412" })).toBe("conflict");
    expect(classifyDatabaseError({ code: "CR409" })).toBe("version_conflict");
    expect(classifyDatabaseError({ code: "CR412" })).not.toBe(
      classifyDatabaseError({ code: "CR409" })
    );
  });

  /**
   * CR412 must be a legal user-defined SQLSTATE: five characters, digits and
   * upper-case ASCII letters, not `00000`, and not ending in three zeroes —
   * a category code can only be trapped as a whole category.
   * (PostgreSQL 17 §43.9)
   */
  it("every custom SQLSTATE in the migrations is legal", () => {
    const codes = new Set(
      Array.from(ALL_FORWARD_SQL.matchAll(/errcode\s*=\s*'([^']+)'/g)).map((m) => m[1])
    );
    expect(codes.size).toBeGreaterThan(0);
    for (const c of codes) {
      expect(c, `${c} is not five characters`).toHaveLength(5);
      expect(/^[0-9A-Z]{5}$/.test(c), `${c} has an illegal character`).toBe(true);
      expect(c, "00000 is reserved").not.toBe("00000");
      expect(c.endsWith("000"), `${c} is a category code`).toBe(false);
    }
    // CR403 comes from the workspace command; the rest from the request
    // commands. Pinned as an exact set so a new code has to be added here
    // deliberately and pass the legality rules above.
    expect([...codes].sort()).toEqual(["CR403", "CR404", "CR409", "CR412", "CR422"]);
  });

  /**
   * The UI half. `ConflictState` is the reload affordance and must be reached
   * ONLY by version_conflict; a `conflict` has to surface the server's message.
   */
  it("the review panel gives the reload affordance only to a real race", () => {
    const ui = readFileSync(
      path.join(ROOT, "components/couranr/requests/ReviewOutcomeActions.tsx"),
      "utf8"
    );
    expect(ui).toMatch(/failure\?\.code === "version_conflict" \? \(\s*<ConflictState/);
    expect(ui).toMatch(/failure\.code === "conflict"/);
    // Exactly one ConflictState render, behind that one condition.
    expect((ui.match(/<ConflictState/g) || []).length).toBe(1);
  });

  it("the command layer overrides the message for the code the SQL actually raises", () => {
    // The bug this replaced: the branch tested for "conflict" while the SQL
    // raised CR409 -> version_conflict, so it never ran.
    expect(COMMANDS).toMatch(/result\.code === "conflict" && row\.payer_type === "merchant"/);
    expect(COMMANDS).toMatch(/without the payer's approval/);
  });
});
