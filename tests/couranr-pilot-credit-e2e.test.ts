import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260908130000_couranr_pilot_credit_business_portal.sql"),
  "utf8"
).toLowerCase();
const ROLLBACK = readFileSync(
  join(ROOT, "supabase/rollbacks/20260908130000_couranr_pilot_credit_business_portal.rollback.sql"),
  "utf8"
).toLowerCase();
const COMMANDS = readFileSync(join(ROOT, "lib/couranr/fulfillment/commands.ts"), "utf8");
const ROUTE = readFileSync(
  join(ROOT, "app/api/couranr/operations/delivery-requests/[id]/promotional-credit/route.ts"),
  "utf8"
);
const CLIENT = readFileSync(join(ROOT, "components/couranr/fulfillment/client.ts"), "utf8");
const PANEL = readFileSync(
  join(ROOT, "components/couranr/fulfillment/OperationsPilotCreditPanel.tsx"),
  "utf8"
);
const WORKBENCH = readFileSync(
  join(ROOT, "components/couranr/operations/OperationsDeliveryWorkbench.tsx"),
  "utf8"
);

describe("merchant-portal pilot credit authority", () => {
  it("allows only real Business merchant-payer requests from the two controlled sources", () => {
    expect(MIGRATION).toContain("v_req.requester_kind <> 'business'");
    expect(MIGRATION).toContain("v_req.payer_type <> 'merchant'");
    expect(MIGRATION).toContain("v_req.source not in ('operations','merchant_portal')");
    expect(MIGRATION).not.toContain("source in ('hosted_request'");
  });

  it("keeps Operations authority in both TypeScript and SQL", () => {
    expect(COMMANDS).toContain('params.actor.kind !== "operations"');
    expect(MIGRATION).toContain("p.id=p_actor_user_id and p.role='admin'");
    expect(ROUTE).toContain("resolveRequestActor(req, null)");
  });

  it("never accepts an amount, quote id, payer or target state from the browser", () => {
    expect(ROUTE).not.toMatch(/body\??\.\w*[Aa]mount/);
    expect(ROUTE).not.toMatch(/body\??\.\w*[Cc]ents/);
    expect(ROUTE).not.toMatch(/body\??\.\w*[Ss]tate/);
    expect(ROUTE).not.toMatch(/body\??\.\w*[Ss]tatus/);
    expect(ROUTE).not.toMatch(/body\??\.\w*[Pp]ayer/);
    expect(ROUTE).not.toContain("expectedVersion = Number(body");
    expect(CLIENT).toContain("No amount, quote id, payer or state leaves the browser");
    expect(PANEL).not.toContain("setAmount");
  });

  it("preserves the request source and PRC-003 commercial evidence", () => {
    expect(MIGRATION).toContain("'requestsource',v_req.source");
    for (const field of [
      "standard_quote_cents",
      "amount_paid_cents",
      "promotional_credit_cents",
      "reason",
      "campaign",
      "market",
      "category",
      "approved_by",
    ]) expect(MIGRATION).toContain(field);
    expect(MIGRATION).not.toMatch(/set[\s\S]{0,120}source=/);
  });

  it("requires the Stripe lane to be fully cancelled before applying credit", () => {
    expect(MIGRATION).toContain("payment_state <> 'cancelled'");
    expect(MIGRATION).toContain("raise exception 'payment_path_already_started'");
    expect(PANEL).toContain("const livePaymentExists = Boolean(fulfillment?.payment)");
    expect(PANEL).toContain("!livePaymentExists");
  });

  it("blocks the reverse race: no payment obligation can become live after credit", () => {
    expect(MIGRATION).toContain("couranr_guard_promotional_credit_payment_exclusivity");
    expect(MIGRATION).toContain("couranr_po_promotional_credit_exclusivity");
    expect(MIGRATION).toContain("new.payment_state <> 'cancelled'");
    expect(MIGRATION).toContain("c.status='applied'");
    expect(MIGRATION).toContain("raise exception 'promotional_credit_already_applied'");
    expect(ROLLBACK).toContain("drop trigger if exists couranr_po_promotional_credit_exclusivity");
    expect(ROLLBACK).toContain(
      "drop function if exists private.couranr_guard_promotional_credit_payment_exclusivity() restrict"
    );
  });

  it("nudges the existing automatic path after credit instead of inventing another fulfillment path", () => {
    expect(ROUTE).toContain("advanceAutomaticFulfillment(params.id)");
    expect(ROUTE).not.toContain("getStripeClient");
    expect(ROUTE).not.toContain("paymentIntents");
  });

  it("wires the action into the Operations commercial workbench", () => {
    expect(WORKBENCH).toContain("<OperationsPilotCreditPanel");
    expect(PANEL).toContain('request.source === "merchant_portal"');
    expect(PANEL).toContain("Apply full");
    expect(PANEL).toContain("Controlled E2E test");
  });

  it("protects rollback once the widened authority has been used", () => {
    expect(ROLLBACK).toContain("rollback_refused: merchant_portal promotional credit evidence exists");
    expect(ROLLBACK).toContain("r.source='merchant_portal'");
    expect(ROLLBACK).toContain("v_req.source <> 'operations'");
  });
});
