import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905003000_couranr_activation_decision_guard.sql"),
  "utf8"
);
const COMMANDS = readFileSync(path.join(ROOT, "lib/couranr/activation/commands.ts"), "utf8");
const RETIRE = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905003100_couranr_retire_legacy_activation_decision.sql"),
  "utf8"
);

describe("MER-003 Operations activation authority", () => {
  it("makes live/block a review outcome rather than a generic state setter", () => {
    expect(MIGRATION).toContain("v_row.activation_state <> 'pending_couranr_review'");
    expect(MIGRATION).toContain("activation_not_pending_review");
    expect(MIGRATION).toMatch(/where business_account_id = p_business_account_id\s+for update/i);
  });

  it("re-checks current policy versions and non-consent prerequisites at grant time", () => {
    expect(MIGRATION).toContain("v_required_acks constant jsonb");
    expect(MIGRATION).toContain("jsonb_each_text(v_required_acks)");
    expect(MIGRATION).toMatch(/ack_kind = v_kind\s+and ack_version = v_version/i);
    expect(MIGRATION).toContain("v_row.contact_verified_at is null");
    expect(MIGRATION).toContain("v_row.test_delivery_request_id is null");
    expect(MIGRATION).toContain("v_row.requested_at is null");
    expect(MIGRATION).toMatch(
      /couranr_delivery_requests[\s\S]*id = v_row\.test_delivery_request_id[\s\S]*business_account_id = p_business_account_id/
    );
  });

  it("accepts only the governed closed block-reason vocabulary", () => {
    for (const reason of [
      "contact_unreachable",
      "prohibited_items_risk",
      "incomplete_information",
      "additional_review_required",
    ]) {
      expect(MIGRATION).toContain(`'${reason}'`);
    }
    expect(MIGRATION).toContain("unknown_activation_block_reason");
  });

  it("keeps the new database command service-role-only", () => {
    expect(MIGRATION).toMatch(
      /revoke all on function public\.couranr_decide_activation_guarded\([^)]+\)\s+from public, anon, authenticated, service_role/i
    );
    expect(MIGRATION).toMatch(
      /grant execute on function public\.couranr_decide_activation_guarded\([^)]+\)\s+to service_role/i
    );
  });

  it("retires the legacy unguarded service-role entrypoint after cutover", () => {
    expect(RETIRE).toMatch(
      /revoke execute on function public\.couranr_decide_activation\(uuid,uuid,boolean,text\)\s+from service_role/i
    );
  });

  it("does not let the service layer choose the grant prerequisites", () => {
    const at = COMMANDS.indexOf("export async function decideActivation");
    expect(at).toBeGreaterThan(-1);
    const body = COMMANDS.slice(at);
    expect(body).toContain('"couranr_decide_activation_guarded"');
    expect(body).not.toContain("p_required_acks");
  });

  it("keeps database-owned acknowledgement versions aligned with governed TypeScript", async () => {
    const { ACKNOWLEDGEMENT_VERSIONS } = await import("@/lib/couranr/activation/states");
    for (const [kind, version] of Object.entries(ACKNOWLEDGEMENT_VERSIONS)) {
      expect(MIGRATION).toContain(`"${kind}":"${version}"`);
    }
  });
});
