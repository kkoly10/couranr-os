import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const M1 = read("supabase/migrations/20260831035450_fnd_a_m1_universal_requester.sql");
const M2 = read("supabase/migrations/20260831035452_fnd_a_m2_immutable_quote_schema.sql");
const M3 = read("supabase/migrations/20260831035454_fnd_a_m3_deterministic_quote_backfill.sql");
const M4 = read("supabase/migrations/20260831035456_fnd_a_m4_command_cutover.sql");
const M5 = read("supabase/migrations/20260831035458_fnd_a_m5_invariant_cutover.sql");
const M6 = read("supabase/migrations/20260831035500_fnd_a_m6_single_destination.sql");
const packageJson = JSON.parse(read("package.json"));

describe("Foundation Gate A static authority", () => {
  it("FND-REQ-02/03/04 encodes the universal requester shape without fake tenancy", () => {
    expect(M1).toContain("requester_kind text not null default 'business'");
    expect(M1).toContain("alter column business_account_id drop not null");
    expect(M1).toContain("alter column created_by drop not null");
    expect(M1).toContain("couranr_dr_requester_tenancy_chk");
    expect(M1).toContain("couranr_dr_consumer_submitted_contact_chk");
    expect(M1).not.toContain("insert into public.business_accounts");
  });

  it("FND-IDEM-01/02 scopes durable idempotency independently of nullable tenancy", () => {
    expect(M1).toContain("unique (idempotency_scope, idempotency_key)");
    expect(M1).toContain("'business:' || business_account_id::text");
    expect(M1).toContain("server_consumer_idempotency_scope_required");
  });

  it("FND-Q-01/02 gives runtime SELECT/INSERT only and enforces append-only history", () => {
    expect(M2).toContain("grant select, insert on table public.couranr_quote_versions to service_role");
    expect(M5).toContain("before update or delete on public.couranr_quote_versions");
    expect(M5).toContain("quote_versions_are_append_only");
  });

  it("FND-Q-03/04 creates exact arithmetic and one linear successor", () => {
    expect(M2).toContain("couranr_qv_line_item_arithmetic_chk");
    expect(M2).toContain("couranr_qv_one_successor_uniq");
    expect(M4).toContain("quote_subtotal_mismatch");
    expect(M4).toContain("couranr_create_quote_version");
  });

  it("FND-Q-05/06 submission and acknowledgment name the quote UUID", () => {
    const submit = M4.slice(M4.indexOf("couranr_submit_delivery_request_v2"),
      M4.indexOf("create or replace function public.couranr_submit_delivery_request("));
    expect(submit).toContain("v_req.current_quote_version_id");
    expect(submit).toContain("'quoteVersionId',v_quote.id");
    expect(submit).toContain("'acknowledgment',coalesce(p_acknowledged,false)");
    expect(M4).toContain("quote_revised_since_acknowledgment");
  });

  it("FND-Q-07 and FND-PAY/PLAN/DLV use quote UUID, not mutable request version", () => {
    expect(M4).toContain("'readinessMeaning','pickup'");
    expect(M4).toContain("v_ob.quote_version_id is distinct from v_req.current_quote_version_id");
    expect(M4).toContain("v_plan.quote_version_id is distinct from v_req.current_quote_version_id");
    expect(M4).toContain("v_quote.pickup_address_snapshot");
    expect(M4).toContain("v_quote.shipment_snapshot");
    expect(M4).toContain("coalesce(v_ob.captured_amount_cents,v_ob.amount_cents)");
    expect(M5).toContain("new.pickup_address is distinct from v_q.pickup_address_snapshot");
    expect(M5).toContain("new.scheduled_pickup_start is distinct from v_p.scheduled_pickup_start");
  });

  it("FND-STOP-01 retires additional_stops for every new canonical request", () => {
    expect(M6).toContain("new_delivery_request_requires_one_destination");
    expect(M6).toContain("Future multi-stop is a route aggregate");
    expect(read("lib/couranr/pricing/quote.ts")).toContain("additional_stops_unsupported");
  });

  it("FND-DML-01 canonical runtime contains no direct protected-table write", () => {
    const output = execFileSync("node", ["scripts/checkCanonicalDmlBoundary.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(output).toContain("PASS — protected commercial mutations use named commands");
    expect(read("scripts/positiveControls.mjs")).toContain("check:canonical-dml");
  });

  it("FND-LEG-01 canonical runtime cannot import quarantined legacy authority", () => {
    const output = execFileSync("node", ["scripts/checkLegacyImports.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(output).toContain("PASS — canonical code imports no legacy module");
  });

  it("FND-TYPE-01 has a focused strict-null no-emit boundary", () => {
    const config = JSON.parse(read("tsconfig.couranr-foundation.json"));
    expect(config.compilerOptions.strictNullChecks).toBe(true);
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(packageJson.scripts["typecheck:couranr-foundation"]).toBeDefined();
    for (const route of ["service-plan", "capture", "release", "reconcile-capture"]) {
      const source = read(`app/api/couranr/operations/delivery-requests/[id]/${route}/route.ts`);
      expect(source).not.toContain("String(loaded.value.request.business_account_id)");
      expect(source).toContain("loaded.value.request.business_account_id ?? null");
    }
  });

  it("FND-SEC-01/02 preserves service-only mutation and RLS", () => {
    expect(M2).toContain("enable row level security");
    expect(M5).toContain("No browser posture changes are tolerated at cutover");
    expect(M5).toContain("has_table_privilege('anon'");
    expect(M5).toContain("has_table_privilege('authenticated'");
    expect(M5).not.toMatch(/grant\s+(insert|update|delete)[^;]+\s+to\s+(anon|authenticated)/i);
  });

  it("FND-MIG-01 is deterministic, classifies imperfect evidence, and hard-refuses guessing", () => {
    expect(M3).toContain("md5(");
    expect(M3).toContain("legacy_partial");
    expect(M3).toContain("legacy_mismatch");
    expect(M3).toContain("unmappable delivery");
    expect(M3).toContain("unmappable payment obligation: request missing or tenancy disagrees");
    expect(M3).toContain("p.business_account_id is distinct from o.business_account_id");
    expect(M3).toContain("deterministic obligation quote id collision");
    expect(read("e2e/disposable/foundationBackfill.mjs")).toContain("backfill replay is idempotent byte-for-byte");
  });

  it("FND-MIG-02 rollback refuses to destroy live semantic quote history", () => {
    const rollbacks = [
      "20260831035452_fnd_a_m2_immutable_quote_schema.rollback.sql",
      "20260831035456_fnd_a_m4_command_cutover.rollback.sql",
      "20260831035458_fnd_a_m5_invariant_cutover.rollback.sql",
      "20260831035500_fnd_a_m6_single_destination.rollback.sql",
    ].map((file) => read(`supabase/rollbacks/${file}`)).join("\n");
    expect(rollbacks).toMatch(/record_origin\s*=\s*'runtime'/);
    expect(rollbacks).toMatch(/forward repair/i);
    expect(rollbacks).toMatch(/refus/i);
  });

  it("the permanent integrity command is read-only and covers the commercial spine", () => {
    expect(packageJson.scripts["couranr:integrity"]).toBe("node scripts/couranrIntegrity.mjs");
    const start = M5.indexOf("create function public.couranr_foundation_integrity");
    const end = M5.indexOf("comment on function public.couranr_foundation_integrity");
    const body = M5.slice(start, end);
    expect(body).toContain("language sql stable");
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(body).toContain("delivery_plan_quote_mismatch");
    expect(body).toContain("captured_without_delivery");
  });
});
