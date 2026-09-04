import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("Operations-assisted business delivery entry", () => {
  it("keeps the general Operations permission matrix read/review-only", () => {
    const permissions = read("lib/couranr/requests/permissions.ts");
    expect(permissions).toContain("It does not create");
    expect(permissions).toContain('capability === "read" || capability === "review"');
  });

  it("requires explicit Operations-assisted authority and server-owned source", () => {
    const commands = read("lib/couranr/requests/commands.ts");
    const create = read("app/api/couranr/operations/delivery-requests/route.ts");
    const estimate = read("app/api/couranr/operations/delivery-requests/[id]/estimate/route.ts");
    const submit = read("app/api/couranr/operations/delivery-requests/[id]/submit/route.ts");

    expect(commands).toContain('export type RequestWriteAuthority = "merchant" | "operations"');
    expect(commands).toContain('source: "merchant_portal" | "operations" = "merchant_portal"');
    expect(create).toContain('writeAuthority: "operations"');
    expect(create).toContain('source: "operations"');
    expect(estimate).toContain('writeAuthority: "operations"');
    expect(submit).toContain('writeAuthority: "operations"');
    expect(submit).toContain("merchantAcknowledged: false");
    expect(commands).toContain("operationsAssisted ? false : params.merchantAcknowledged === true");
  });

  it("gives Operations a business selector and manual create page", () => {
    const businesses = read("app/api/couranr/operations/businesses/route.ts");
    const page = read("app/(couranr)/operations/deliveries/new/page.tsx");
    const flow = read("components/couranr/requests/NewDeliveryFlow.tsx");
    const dashboard = read("app/(couranr)/operations/page.tsx");

    expect(businesses).toContain("resolveRequestActor(req, null)");
    expect(businesses).toContain('.eq("status", "active")');
    expect(page).toContain('<NewDeliveryFlow mode="operations"');
    expect(flow).toContain('label="Who pays?"');
    expect(flow).toContain("Payer approval stays separate");
    expect(dashboard).toContain("/operations/deliveries/new");
  });

  it("normalizes audit actor identity only for source=operations", () => {
    const migration = read("supabase/migrations/20260904025520_operations_assisted_request_audit.sql");
    expect(migration).toContain("new.actor_type = 'merchant'");
    expect(migration).toContain("v_source = 'operations'");
    expect(migration).toContain("new.actor_type := 'operations'");
    expect(migration).toContain("'submit_delivery_request'");
  });


  it("does not confuse a dual-role admin/owner with the Operations surface", () => {
    const actor = read("lib/couranr/requests/actor.ts");
    const detail = read("components/couranr/requests/DeliveryRequestDetail.tsx");
    const opsPage = read("app/(couranr)/operations/deliveries/[id]/page.tsx");
    const businessPage = read("app/(couranr)/app/business/deliveries/[id]/page.tsx");

    expect(actor).toContain("resolve the membership first for an explicit business scope");
    expect(actor.indexOf("if (membership)")).toBeLessThan(
      actor.indexOf("Compatibility fallback for Operations callers")
    );
    expect(detail).toContain('surface: "operations" | "business"');
    expect(detail).toContain('if (surface === "operations")');
    expect(opsPage).toContain('surface="operations"');
    expect(businessPage).toContain('surface="business"');
  });

  it("hands an Operations-entered merchant quote to the real Business payer", () => {
    const migration = read(
      "supabase/migrations/20260904050016_operations_assisted_payer_handoff.sql"
    );
    const review = read("components/couranr/requests/ReviewOutcomeActions.tsx");

    expect(migration).toContain("v_req.source='operations'");
    expect(migration).toContain("v_submit_actor='operations'");
    expect(migration).toContain("v_target:='awaiting_quote_acceptance'");
    expect(migration).toContain("private.couranr_quote_version_is_expired(v_quote)");
    expect(migration).toContain("payerApprovalPending");
    expect(review).toContain("Confirm service & request business approval");
    expect(review).toContain("it does not approve the price for the business");
  });

  it("shows the Operations-to-Business payer handoff instead of impersonating approval", () => {
    const detail = read("components/couranr/requests/DeliveryRequestDetail.tsx");
    const workbench = read("components/couranr/operations/OperationsDeliveryWorkbench.tsx");
    expect(detail).toContain("OperationsDeliveryWorkbench");
    expect(workbench).toContain("Business approval required");
    expect(workbench).toContain("Open Business approval");
    expect(workbench).toContain('/app/business/deliveries/');
    expect(workbench).toContain('request.source === "operations"');
    const lifecycle = read("lib/couranr/fulfillment/lifecycle.ts");
    expect(lifecycle).toContain('"awaiting_quote_acceptance"');
    expect(lifecycle).toContain('"quote_revision_required"');
    expect(lifecycle).toContain('if (!commerciallySecured) return "awaiting_payment_authorization"');
    expect(workbench).toContain('work.phase === "commercial"');
  });
});
