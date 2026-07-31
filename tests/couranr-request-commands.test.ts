import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quoteColumns, shipmentColumns } from "@/lib/couranr/requests/commands";
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
 * The shipment columns are built once and shared by create and re-estimate.
 *
 * The bug this guards against: re-estimate used to price the STORED row and
 * ignore the merchant's edits, so a merchant who changed the distance and
 * clicked "Calculate estimate" again was shown a price for the old distance.
 * Two separate column lists would let the same drift return.
 */
describe("shipmentColumns", () => {
  const EXPECTED_KEYS = [
    "additional_stops",
    "dropoff_address",
    "loaded_miles",
    "normalized_request_payload",
    "payer_type",
    "pickup_address",
    "proof_method",
    "readiness_state",
    "recipient_email",
    "recipient_name",
    "recipient_phone",
    "service_level",
    "signature_required",
    "source",
    "weight_lb",
  ];

  it("covers every merchant-editable column", () => {
    expect(Object.keys(shipmentColumns(draft())).sort()).toEqual(EXPECTED_KEYS);
  });

  /** Identity and lifecycle are not the merchant's to edit. */
  it("touches no identity or lifecycle column", () => {
    const keys = Object.keys(shipmentColumns(draft()));
    for (const forbidden of [
      "id",
      "business_account_id",
      "created_by",
      "idempotency_key",
      "request_state",
      "review_state",
      "service_area_review_state",
      "submitted_at",
      "version",
      "created_at",
    ]) {
      expect(keys, `shipmentColumns writes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("carries no money column at all", () => {
    for (const k of Object.keys(shipmentColumns(draft()))) {
      expect(k).not.toMatch(/cents|amount|price|subtotal|total/i);
    }
  });

  it("persists the overnight request, which has no column of its own", () => {
    const on = shipmentColumns(draft({ overnightRequested: true }));
    const off = shipmentColumns(draft());
    expect(on.normalized_request_payload).toEqual({ overnightRequested: true });
    expect(off.normalized_request_payload).toEqual({ overnightRequested: false });
    // Overnight must never be smuggled in as a service level: the database
    // CHECK allows exactly standard, priority and rush.
    expect(on.service_level).toBe("standard");
  });

  it("both write paths use it, so they cannot drift", () => {
    // create_delivery_request_draft and calculate_delivery_request_estimate.
    const uses = COMMANDS.match(/shipmentColumns\(draft\)/g) || [];
    expect(uses.length).toBe(2);
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
 * `quoteColumns` is the single place the pricing result becomes database
 * columns. Every case here corresponds to a CHECK constraint that would
 * otherwise reject the write at runtime.
 */
describe("quoteColumns", () => {
  const estimated = quoteDelivery({ loadedMiles: 4.2, weightLb: 12.5 });
  const manual = quoteDelivery({ loadedMiles: 4.2, weightLb: 12.5, overnightRequested: true });

  it("an estimate carries both the subtotal and the policy version", () => {
    // couranr_dr_estimate_completeness_chk requires both or the insert fails.
    const c = quoteColumns(estimated);
    expect(c.quote_status).toBe("estimated");
    expect(c.delivery_subtotal_cents).toBe(estimated.deliverySubtotalCents);
    expect(c.pricing_policy_version).toBeTruthy();
  });

  it("a manual-review quote carries no subtotal", () => {
    // couranr_dr_manual_review_chk requires delivery_subtotal_cents to be null.
    const c = quoteColumns(manual);
    expect(c.quote_status).toBe("manual_review_required");
    expect(c.delivery_subtotal_cents).toBe(null);
    expect(c.pricing_policy_version).toBe(null);
    expect(c.review_reasons).toContain("overnight_not_offered_in_this_release");
  });

  it("never persists a payment amount", () => {
    // couranr_dr_no_payment_due_chk enforces this in the database too.
    for (const q of [estimated, manual]) {
      expect(quoteColumns(q).payment_due_cents).toBe(null);
    }
  });

  it("never asserts rounding or tax, which are unresolved", () => {
    // couranr_dr_no_rounding_chk and couranr_dr_no_tax_chk.
    for (const q of [estimated, manual]) {
      expect(quoteColumns(q).rounding_applied).toBe(false);
      expect(quoteColumns(q).tax_included).toBe(false);
    }
  });

  it("the subtotal is exactly the sum of the persisted line items", () => {
    const c = quoteColumns(estimated);
    const sum = (c.quote_line_items as any[]).reduce((n, li) => n + li.amountCents, 0);
    expect(c.delivery_subtotal_cents).toBe(sum);
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

  it("every update compare-and-sets the version", () => {
    const updates = COMMANDS.match(/\.update\(/g) || [];
    const versionGuards = COMMANDS.match(/\.eq\("version", params\.expectedVersion\)/g) || [];
    expect(updates.length).toBe(1);
    expect(versionGuards.length).toBe(1);
  });

  it("every write path scopes by business account", () => {
    // The single update, plus the idempotency re-read, plus the tenant list.
    const scoped = COMMANDS.match(/\.eq\("business_account_id"/g) || [];
    expect(scoped.length).toBeGreaterThanOrEqual(3);
  });

  it("uses the service-role client, never the browser client", () => {
    expect(COMMANDS).toMatch(/from "@\/lib\/supabaseAdmin"/);
    expect(COMMANDS).not.toMatch(/from "@\/lib\/supabaseClient"/);
  });

  it("audit failures are returned, not swallowed", () => {
    const audits = COMMANDS.match(/const audit = await appendEvent\(/g) || [];
    const checks = COMMANDS.match(/if \(isCommandFailure\(audit\)\) return audit;/g) || [];
    expect(audits.length).toBe(4);
    expect(checks.length).toBe(audits.length);
  });
});
