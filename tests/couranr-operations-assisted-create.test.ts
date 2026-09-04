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
});
