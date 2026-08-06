import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BILLING_GAPS,
  CHARGE_RECORD_DESCRIPTIONS,
  CHARGE_RECORD_LABELS,
  CHARGE_RECORD_STATES,
  chargeRecordState,
  formatCents,
  moneyWasTaken,
  paymentMethodState,
  totalChargedCents,
  type ChargeRecord,
} from "@/lib/couranr/billing/records";
import {
  PAYMENT_STATES,
  REACHABLE_PAYMENT_STATES,
  UNREACHABLE_PAYMENT_STATES,
} from "@/lib/couranr/payments/states";
import { MEMBER_ROLES, memberMay } from "@/lib/couranr/settings/permissions";

const ROOT = path.resolve(__dirname, "..");

/**
 * Source with COMMENTS REMOVED.
 *
 * A ban on a word has to be a ban on what SHIPS, not on what is explained.
 * Both of these files quote the very constraints they honour — the registry's
 * "no monthly subscription invoice during pilot", and why the amount must not
 * come from `delivery_subtotal_cents` — so a naive `toContain` on the raw file
 * fails against code that is exactly right. Strip the comments and the
 * assertion is about the behaviour again. This is the same lesson the MER-003
 * browser run learned when a word ban fired on the screen's own "No website …
 * is required" disclaimer.
 */
function code(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * MER-016 — billing records.
 *
 * The rule this file protects: a billing screen may state what money did, and
 * nothing else. Every number comes from a stored row, every state it cannot
 * reach is named rather than faked, and no copy implies Couranr refunds
 * merchandise.
 */

function record(over: Partial<ChargeRecord> = {}): ChargeRecord {
  return {
    obligationId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    amountCents: 2299,
    capturedAmountCents: null,
    currency: "usd",
    state: "authorized",
    payerType: "merchant",
    recipientName: "A recipient",
    createdAt: "2026-08-06T00:00:00Z",
    settledAt: null,
    ...over,
  };
}

describe("every stored payment state maps to exactly one merchant-facing state", () => {
  it("every REACHABLE payment state has a mapping", () => {
    for (const s of REACHABLE_PAYMENT_STATES) {
      const mapped = chargeRecordState(s);
      expect(CHARGE_RECORD_STATES, `${s} mapped to something unknown`).toContain(mapped);
    }
  });

  it("the mapping is a renaming, not a second opinion", () => {
    expect(chargeRecordState("not_started")).toBe("not_authorized");
    expect(chargeRecordState("requires_action")).toBe("action_required");
    expect(chargeRecordState("authorized")).toBe("authorized");
    expect(chargeRecordState("capture_pending")).toBe("capture_pending");
    expect(chargeRecordState("captured")).toBe("charged");
    expect(chargeRecordState("failed")).toBe("failed");
    expect(chargeRecordState("cancelled")).toBe("cancelled");
  });

  it("an unknown or unwritten state claims the LEAST, never a charge", () => {
    // A row carrying a state this build does not understand must never render
    // as "we took your money".
    for (const s of [...UNREACHABLE_PAYMENT_STATES, "something_new", "", null, undefined]) {
      const mapped = chargeRecordState(s as any);
      expect(moneyWasTaken(mapped), `${s} rendered as charged`).toBe(false);
    }
  });

  it("`charged` is the ONLY state that says money moved", () => {
    const charged = CHARGE_RECORD_STATES.filter(moneyWasTaken);
    expect([...charged]).toEqual(["charged"]);
  });

  it("every state has a label and a sentence saying whether money moved", () => {
    for (const s of CHARGE_RECORD_STATES) {
      expect(CHARGE_RECORD_LABELS[s], s).toBeTruthy();
      const d = CHARGE_RECORD_DESCRIPTIONS[s];
      expect(d, s).toBeTruthy();
      // Each one answers the only question a billing screen exists to answer.
      expect(/charged|charge|held|taken|settle/i.test(d), `${s} does not say what happened to the money`).toBe(true);
    }
  });
});

describe("the total is what was TAKEN, never what was held", () => {
  it("sums only charged records", () => {
    const rs = [
      record({ state: "charged", capturedAmountCents: 2299 }),
      record({ state: "authorized", amountCents: 5000 }),
      record({ state: "failed", amountCents: 9900 }),
      record({ state: "capture_pending", amountCents: 4000 }),
    ];
    expect(totalChargedCents(rs)).toBe(2299);
  });

  it("prefers the CAPTURED amount over the authorized one", () => {
    // Using the authorization would overstate what a merchant paid — the worst
    // direction to be wrong in on a billing screen.
    //
    // THIS INPUT CANNOT OCCUR TODAY. `couranr_po_captured_amount_chk` requires
    // `captured_amount_cents = amount_cents`, so the two never differ — the
    // disposable database refused a fixture that tried to seed a partial
    // capture. The branch is kept because it is right the day that constraint
    // is relaxed, and this test documents it rather than implying partial
    // captures are a thing that happens here.
    const rs = [record({ state: "charged", amountCents: 5000, capturedAmountCents: 2299 })];
    expect(totalChargedCents(rs)).toBe(2299);
  });

  it("the constraint that makes that branch unreachable really is in the schema", () => {
    // If this ever disappears, partial captures become possible and the
    // preference above stops being theoretical.
    const sql = readFileSync(
      path.join(ROOT, "supabase/migrations/20260801083000_couranr_service_plan_and_deliveries.sql"),
      "utf8"
    );
    expect(sql).toMatch(/couranr_po_captured_amount_chk/);
    expect(sql).toMatch(/captured_amount_cents\s*=\s*amount_cents/);
  });

  it("falls back to the authorized amount only when no captured amount exists", () => {
    const rs = [record({ state: "charged", amountCents: 2299, capturedAmountCents: null })];
    expect(totalChargedCents(rs)).toBe(2299);
  });

  it("an empty list totals zero, not NaN", () => {
    expect(totalChargedCents([])).toBe(0);
  });
});

describe("cents are formatted as cents, never as floats", () => {
  it("formats whole and part dollars", () => {
    expect(formatCents(2299)).toBe("$22.99");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100000)).toBe("$1000.00");
  });

  it("a negative amount keeps its sign in front of the symbol", () => {
    expect(formatCents(-2299)).toBe("-$22.99");
  });
});

describe("no payment method is stored, and the screen says so", () => {
  it("paymentMethodState is always none_on_file today", () => {
    expect(paymentMethodState()).toBe("none_on_file");
  });

  it("nothing in the repository stores a Stripe customer or a SetupIntent", () => {
    /**
     * The claim behind the "no saved payment method" state. Saving a method
     * for reuse needs a Stripe Customer AND a SetupIntent with the customer id
     * persisted here; if either ever appears, this state stops being
     * universally true and the screen must stop asserting it.
     */
    const migrations = readFileSync(
      path.join(ROOT, "supabase/migrations/20260731230000_couranr_payment_authorization.sql"),
      "utf8"
    );
    expect(migrations).not.toMatch(/stripe_customer_id|setup_intent/i);
    const stripeLib = readFileSync(path.join(ROOT, "lib/couranr/payments/stripe.ts"), "utf8");
    expect(stripeLib).not.toMatch(/setupIntents|customers\.create/);
  });
});

describe("the gaps are cited, not editorial", () => {
  it("names all three, each with merchant copy and a reason", () => {
    expect(BILLING_GAPS.map((g) => g.id).sort()).toEqual([
      "downloadable_receipt",
      "refunds_and_credits",
      "saved_payment_method",
    ]);
    for (const g of BILLING_GAPS) {
      expect(g.label, g.id).toBeTruthy();
      expect(g.merchantCopy, g.id).toBeTruthy();
      expect(g.blockedBy, g.id).toBeTruthy();
    }
  });

  it("the receipt gap is UNDECIDED and cites TAX-001", () => {
    // The distinction matters: an unbuilt thing is unblocked by an engineer,
    // an undecided one only by the owner. Getting this wrong sends the
    // problem to the wrong person.
    const receipt = BILLING_GAPS.find((g) => g.id === "downloadable_receipt")!;
    expect(receipt.kind).toBe("undecided");
    expect(receipt.blockedBy).toContain("TAX-001");
  });

  it("TAX-001 really is unresolved and really does block MER-016", () => {
    // Read from the registry itself, so this test fails the day the decision
    // lands rather than leaving the screen apologising for nothing.
    const registry = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
    const tax = registry.decisions.find((d: any) => d.id === "TAX-001");
    expect(tax).toBeTruthy();
    expect(tax.status).toBe("unresolved");
    expect(tax.blocked_screen_ids).toContain("MER-016");
  });

  it("the refund gap matches the payment vocabulary's own unreachable set", () => {
    expect(UNREACHABLE_PAYMENT_STATES).toContain("refunded");
    expect(UNREACHABLE_PAYMENT_STATES).toContain("partially_refunded");
    const refunds = BILLING_GAPS.find((g) => g.id === "refunds_and_credits")!;
    expect(refunds.blockedBy).toContain("REF-001");
  });

  it("no merchant-facing copy implies Couranr refunds merchandise (REF-002)", () => {
    const copy = BILLING_GAPS.map((g) => `${g.label} ${g.merchantCopy}`).join(" ");
    const screen = code("components/couranr/billing/BillingRecords.tsx");
    const all = `${copy} ${Object.values(CHARGE_RECORD_DESCRIPTIONS).join(" ")}`;
    // Couranr must never appear as the party refunding a PRODUCT.
    expect(all).not.toMatch(/refund (your|the) (product|order|merchandise|purchase)/i);
    expect(screen).not.toMatch(/refund (your|the) (product|order|merchandise|purchase)/i);
    // And the screen must say the product price is not Couranr's.
    expect(screen).toMatch(/price of what you sold/i);
  });

  it("no subscription or monthly invoice is offered anywhere on the screen", () => {
    // The registry's explicit constraint: "No monthly subscription invoice
    // during pilot."
    expect(code("components/couranr/billing/BillingRecords.tsx")).not.toMatch(
      /subscription|monthly plan|your plan/i
    );
  });
});

describe("billing.read is the billing contact's capability", () => {
  it("owner, manager and billing may read; dispatcher and viewer may not", () => {
    const may = MEMBER_ROLES.filter((r) => memberMay({ role: r, status: "active" }, "billing.read"));
    expect([...may].sort()).toEqual(["billing", "manager", "owner"]);
  });

  it("the `billing` role has a capability that is actually about billing", () => {
    // Before MER-016 the role named "billing" could do nothing billing-related
    // at all. If this ever regresses, the role is decorative again.
    expect(memberMay({ role: "billing", status: "active" }, "billing.read")).toBe(true);
  });

  it("an invited or disabled billing contact reads nothing", () => {
    for (const status of ["invited", "disabled", null, "pending"]) {
      expect(memberMay({ role: "billing", status }, "billing.read")).toBe(false);
    }
  });
});

describe("the read layer cannot write", () => {
  it("the commands module exposes no mutation", () => {
    /**
     * Every state a merchant might want to change here is either undecided
     * (TAX-001) or Operations-only (REF-001). A write command would be the
     * first step toward a refund button that must not exist, so its absence is
     * asserted rather than assumed.
     */
    // `READ ONLY` is checked on the RAW file — it is a claim the header makes,
    // and the point is that the claim is present AND true.
    expect(readFileSync(path.join(ROOT, "lib/couranr/billing/commands.ts"), "utf8")).toMatch(/READ ONLY/);
    const src = code("lib/couranr/billing/commands.ts");
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the route has a GET and no other method", () => {
    const src = code("app/api/couranr/merchant/billing/route.ts");
    expect(src).toMatch(/export async function GET/);
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("the amount comes from the obligation, never from the request's quote", () => {
    // A quote is what a delivery WOULD cost. Reading it here would show a
    // merchant amounts for deliveries nobody ever authorized.
    const src = code("lib/couranr/billing/commands.ts");
    expect(src).toContain("couranr_payment_obligations");
    expect(src).not.toMatch(/delivery_subtotal_cents/);
  });
});

describe("the payment vocabulary this screen renders is the real one", () => {
  it("every state the screen can show is a declared payment state", () => {
    // Guards against the screen inventing a status word that no row can hold.
    const declared = new Set<string>(PAYMENT_STATES as readonly string[]);
    for (const s of REACHABLE_PAYMENT_STATES) expect(declared.has(s)).toBe(true);
  });
});
