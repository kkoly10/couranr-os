import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905023000_couranr_activation_contact_verification.sql"),
  "utf8"
);
const RETIRE = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905023100_couranr_retire_merchant_contact_self_verification.sql"),
  "utf8"
);
const MERCHANT_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/me/activation/route.ts"),
  "utf8"
);
const OPS_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/operations/activation/route.ts"),
  "utf8"
);
const CHECKLIST = readFileSync(
  path.join(ROOT, "components/couranr/activation/ActivationChecklist.tsx"),
  "utf8"
);

describe("MER-003 operations-verified contact", () => {
  it("retires merchant self-attestation as an executable authority path", () => {
    expect(RETIRE).toMatch(
      /revoke execute on function public\.couranr_verify_activation_contact\(uuid,uuid\)\s+from service_role/i
    );
    expect(MERCHANT_ROUTE).not.toContain('action === "verify_contact"');
    expect(MERCHANT_ROUTE).toContain('action === "request_contact_verification"');
    expect(CHECKLIST).not.toContain("Confirm contact");
    expect(CHECKLIST).toContain("Ask Couranr to verify");
  });

  it("lets only Operations mark a requested contact verified", () => {
    const at = SQL.indexOf("create function public.couranr_verify_activation_contact_by_operations");
    expect(at).toBeGreaterThan(-1);
    const body = SQL.slice(at);
    expect(body).toMatch(/select role into v_profile_role[\s\S]*profiles/i);
    expect(body).toContain("operations_access_required");
    expect(body).toContain("contact_verification_not_requested");
    expect(body).toMatch(/contact_verified_at\s*=\s*now\(\)/i);
    expect(body).toMatch(/contact_verified_by\s*=\s*p_actor_user_id/i);
    expect(OPS_ROUTE).toContain('action !== "verify_contact"');
    expect(OPS_ROUTE).toContain("verifyContactForOperations");
  });

  it("requires the merchant to request verification against a real stored phone", () => {
    const at = SQL.indexOf("create function public.couranr_request_activation_contact_verification");
    expect(at).toBeGreaterThan(-1);
    const body = SQL.slice(at);
    expect(body).toMatch(/v_actor_role not in \('owner', 'manager'\)/i);
    expect(body).toMatch(/from public\.couranr_merchant_workspaces[\s\S]*contact_phone/i);
    expect(body).toContain("operations_contact_required");
    expect(body).toMatch(/contact_verification_requested_at\s*=\s*coalesce/i);
  });

  it("invalidates verification when the operations phone changes without logging the phone", () => {
    expect(SQL).toContain("couranr_workspace_contact_activation_invalidation_trg");
    expect(SQL).toMatch(/after update of contact_phone/i);
    expect(SQL).toMatch(/contact_verified_at\s*=\s*null/i);
    expect(SQL).toMatch(/contact_verification_requested_at\s*=\s*null/i);
    expect(SQL).toContain("'invalidate_contact_verification'");
    expect(SQL).toContain("'operations_contact_changed'");
    expect(SQL).not.toMatch(/jsonb_build_object\([^)]*old\.contact_phone/i);
    expect(SQL).not.toMatch(/jsonb_build_object\([^)]*new\.contact_phone/i);
  });

  it("moves a changed-phone activation review back to in_progress instead of granting stale evidence", () => {
    expect(SQL).toMatch(
      /when activation_state = 'pending_couranr_review' then 'in_progress'/i
    );
    expect(SQL).toMatch(
      /when activation_state = 'pending_couranr_review' then null\s+else requested_at/i
    );
  });

  it("keeps both new commands service-role-only", () => {
    for (const fn of [
      "couranr_request_activation_contact_verification",
      "couranr_verify_activation_contact_by_operations",
    ]) {
      expect(SQL).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\(uuid,uuid\\)\\s+from public, anon, authenticated, service_role`,
          "i"
        )
      );
      expect(SQL).toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}\\(uuid,uuid\\)\\s+to service_role`,
          "i"
        )
      );
    }
  });
});
