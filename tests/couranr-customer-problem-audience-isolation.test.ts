import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const migration = readFileSync(path.join(ROOT,
  "supabase/migrations/20260926013000_couranr_customer_problem_audience_isolation.sql"), "utf8");
const rollback = readFileSync(path.join(ROOT,
  "supabase/rollbacks/20260926013000_couranr_customer_problem_audience_isolation.rollback.sql"), "utf8");

function fn(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} missing`).toBeGreaterThan(-1);
  const end = migration.indexOf("\n$fn$;", start);
  expect(end, `${name} terminator missing`).toBeGreaterThan(start);
  return migration.slice(start, end + 7);
}

describe("CUS-004 sender/recipient problem-report isolation", () => {
  it("stores audience on the report and scopes the open-case uniqueness by it", () => {
    expect(migration).toMatch(/add column customer_audience text/i);
    expect(migration).toMatch(/delivery_id\s*,\s*customer_audience[\s\S]*report_state='draft'/i);
    expect(migration).toMatch(/delivery_id\s*,\s*customer_audience[\s\S]*report_state<>'resolved'/i);
    expect(migration).toMatch(
      /delivery_id\s*,\s*customer_audience\s*,\s*submit_idempotency_key[\s\S]*submit_idempotency_key is not null/i,
    );
    expect(rollback).toContain("drop index public.couranr_cpr_submit_key_audience_uniq");
    expect(rollback).toMatch(/couranr_cpr_submit_key_uniq[\s\S]*delivery_id\s*,\s*submit_idempotency_key/i);
  });

  it("filters reads and all customer write/evidence commands by token audience", () => {
    const names = [
      "couranr_customer_problem_report_view",
      "couranr_save_customer_problem_draft",
      "couranr_prepare_customer_problem_evidence",
      "couranr_collect_expired_customer_problem_evidence",
      "couranr_abandon_customer_problem_evidence",
      "couranr_customer_problem_evidence_authorization",
      "couranr_finalize_customer_problem_evidence",
      "couranr_submit_customer_problem_report",
      "couranr_renew_customer_problem_evidence_grant",
    ];
    for (const name of names) expect(fn(name), name).toMatch(/audience|customer_audience/);
    expect(fn("couranr_customer_problem_report_view")).toContain("h.audience=r.customer_audience");
    expect(fn("couranr_submit_customer_problem_report")).toContain("customer_audience=v_audience");
  });

  it("reasserts service-role-only execution on every replaced token RPC", () => {
    const signatures = [
      "couranr_customer_problem_report_view(uuid)",
      "couranr_save_customer_problem_draft(uuid,text,text)",
      "couranr_collect_expired_customer_problem_evidence(uuid,uuid)",
      "couranr_abandon_customer_problem_evidence(uuid,uuid)",
      "couranr_customer_problem_evidence_authorization(uuid,uuid)",
      "couranr_submit_customer_problem_report(uuid,uuid,text)",
      "couranr_renew_customer_problem_evidence_grant(uuid,uuid)",
    ];
    for (const signature of signatures) {
      expect(migration, signature).toContain(`revoke all on function public.${signature}`);
      expect(migration, signature).toContain(`grant execute on function public.${signature}`);
    }
    expect(migration).toContain("revoke all on function public.couranr_prepare_customer_problem_evidence(");
    expect(migration).toContain("revoke all on function public.couranr_finalize_customer_problem_evidence(");
  });

  it("keeps same-audience reissued tokens possible without collapsing audiences", () => {
    const save = fn("couranr_save_customer_problem_draft");
    expect(save).toContain("customer_audience=v_audience");
    expect(save).toContain("set help_token_id=p_token_id");
  });

  it("refuses a destructive rollback after non-legacy audience history exists", () => {
    expect(rollback).toContain("customer_problem_audience_rollback_refuses_semantic_use");
    expect(rollback).toMatch(/customer_audience\s*<>\s*'legacy'/i);
  });
});
