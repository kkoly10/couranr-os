import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const ROUTE = fs.readFileSync(
  path.join(ROOT, "app/api/couranr/delivery-requests/[id]/tracking-link/route.ts"),
  "utf8"
);
const PANEL = fs.readFileSync(
  path.join(ROOT, "components/couranr/tracking/MerchantTrackingPanel.tsx"),
  "utf8"
);
const DETAIL = fs.readFileSync(
  path.join(ROOT, "components/couranr/requests/DeliveryRequestDetail.tsx"),
  "utf8"
);
const HOSTED = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260905070500_couranr_hosted_tracking_relationship_scope.sql"),
  "utf8"
);
const CONSUMER = fs.readFileSync(
  path.join(ROOT, "lib/couranr/consumer/send.ts"),
  "utf8"
);

describe("merchant tracking-link issuance", () => {
  it("proves tenant relationship and write permission before minting a credential", () => {
    const scope = ROUTE.indexOf("getDeliveryRequest({");
    const permission = ROUTE.indexOf('canActOnDeliveryRequest(actor.actor, "submit"');
    const issue = ROUTE.indexOf("issueTrackingLink({ requestId: id })");
    expect(scope).toBeGreaterThanOrEqual(0);
    expect(permission).toBeGreaterThan(scope);
    expect(issue).toBeGreaterThan(permission);
  });

  it("accepts only the business scope from the browser", () => {
    expect(ROUTE).toContain('const BODY_KEYS = new Set(["businessAccountId"])');
    expect(ROUTE).toContain("Object.keys(record).some");
    for (const forbidden of [
      "requestState",
      "deliveryId",
      "audience",
      "expiresAt",
      "tokenHash",
      "token",
    ]) {
      expect(ROUTE).not.toContain("record." + forbidden);
    }
  });

  it("never lets merchant issuance replace a hosted customer\'s own live token", () => {
    const hostedGuard = ROUTE.indexOf('request.source === "hosted_request"');
    const issue = ROUTE.indexOf("issueTrackingLink({ requestId: id })");
    expect(hostedGuard).toBeGreaterThanOrEqual(0);
    expect(hostedGuard).toBeLessThan(issue);
    expect(DETAIL).toContain('request.source !== "hosted_request"');
    expect(HOSTED).toContain("couranr_issue_hosted_tracking_if_absent");
    expect(HOSTED).toContain("pg_advisory_xact_lock");
  });

  it("keeps direct Consumer /send on its existing guest-owned issuance path", () => {
    expect(CONSUMER).toContain("issueTrackingLink({ requestId: String(row.id) })");
    expect(CONSUMER).toContain('row.request_state === "confirmed"');
  });

  it("makes confirmed state server-owned rather than accepting it from the body", () => {
    expect(ROUTE).toContain('request.request_state !== "confirmed"');
    expect(ROUTE).not.toMatch(/record\.[A-Za-z_]*[Ss]tate/);
    expect(DETAIL).toContain('request.requestState === "confirmed"');
  });

  it("keeps the raw tracking token ephemeral in the merchant browser", () => {
    expect(PANEL).toContain("encodeURIComponent(token)");
    expect(PANEL).toContain("navigator.clipboard.writeText");
    for (const banned of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "navigator.sendBeacon",
      "console.log",
    ]) {
      expect(PANEL).not.toContain(banned);
    }
  });

  it("does not claim Couranr sends SMS or email", () => {
    const renderedCode = PANEL.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const lower = renderedCode.toLowerCase();
    expect(lower).not.toContain("we text");
    expect(lower).not.toContain("we email");
    expect(lower).not.toContain("sms");
    expect(renderedCode).toContain("customer channel you already use");
  });

  it("keeps replacement semantics visible and derives expiry from the server response", () => {
    expect(PANEL).toContain("Replace link");
    expect(PANEL).toContain("disables");
    expect(PANEL).toContain("expiryCopy(link.expiresAt)");
    expect(PANEL).not.toContain("expire after 30 days");
  });
});
