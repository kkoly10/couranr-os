import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const ROOT=process.cwd();
const read=(p:string)=>fs.readFileSync(path.join(ROOT,p),"utf8");

const MIGRATION=read("supabase/migrations/20260907223000_couranr_customer_problem_reports.sql");
const ROLLBACK=read("supabase/rollbacks/20260907223000_couranr_customer_problem_reports.rollback.sql");
const SERVER=read("lib/couranr/conversations/problemReports.ts");
const PAGE=read("components/couranr/help/DeliveryHelpPage.tsx");
const CLIENT=read("components/couranr/help/client.ts");
const OPS=read("components/couranr/operations/IncidentsWorkspace.tsx");
const HELP_ROUTE=read("app/api/couranr/help/[token]/route.ts");
const PROBLEM_ROUTE=read("app/api/couranr/help/[token]/problem-report/route.ts");

describe("CUS-004 customer delivery-problem report contract",()=>{
  it("keeps customer report evidence separate from Operations incident authority",()=>{
    expect(MIGRATION).toContain("create table if not exists public.couranr_customer_problem_reports");
    expect(MIGRATION).toContain("create table if not exists public.couranr_customer_problem_evidence");
    expect(MIGRATION).not.toContain("insert into public.couranr_delivery_incidents");
    expect(SERVER).not.toContain("couranr_open_delivery_incident");
  });

  it("never lets the browser author report state or Operations commands through the customer route",()=>{
    expect(MIGRATION).toContain("couranr_submit_customer_problem_report");
    expect(MIGRATION).toContain("couranr_transition_customer_problem_report");
    expect(MIGRATION).toContain("v_role is distinct from 'admin'");
    expect(MIGRATION).not.toContain("p_report_state");
    expect(PROBLEM_ROUTE).not.toContain("transitionOperationsProblemReport");
  });

  it("scopes customer read/write authority to the redeemed one-delivery help token",()=>{
    expect(MIGRATION).toContain("h.delivery_id=r.delivery_id");
    expect(MIGRATION).toContain("and c.delivery_id=v_delivery");
    expect(MIGRATION).toContain("where id=p_report_id and delivery_id=v_delivery");
    expect(MIGRATION).toContain("r.delivery_id=v_delivery");
  });

  it("makes submit replay-safe before current-state eligibility",()=>{
    const replay=MIGRATION.indexOf("LOST-RESPONSE RULE");
    const state=MIGRATION.indexOf("if v_row.report_state<>'draft'");
    const update=MIGRATION.indexOf("set report_state='reported'");
    expect(replay).toBeGreaterThan(-1);
    expect(state).toBeGreaterThan(replay);
    expect(update).toBeGreaterThan(state);
  });

  it("expires stale pending upload grants instead of permanently wedging a draft",()=>{
    expect(MIGRATION).toContain("expires_at timestamptz not null");
    expect(MIGRATION).toContain("upload_state='abandoned'");
    expect(MIGRATION).toContain("expires_at<=v_now");
    expect(MIGRATION).toContain("expires_at>v_now");
  });

  it("uses the existing private bucket with opaque server-owned paths and storage revalidation",()=>{
    expect(SERVER).toContain('const BUCKET="delivery-photos"');
    expect(SERVER).toContain("randomBytes(16).toString");
    expect(SERVER).toContain(".createSignedUploadUrl");
    expect(SERVER).toContain("readStoredObject");
    expect(SERVER).toContain("stored.size!==Number(auth.expected_bytes)");
    expect(MIGRATION).toContain("storage_bucket='delivery-photos'");
    expect(MIGRATION).toContain("customer-problem/v1/");
  });

  it("never persists signed URLs and rollback refuses to destroy evidence",()=>{
    expect(MIGRATION).not.toContain("signed_url");
    expect(ROLLBACK).toContain("rollback_refused: customer problem-report evidence exists");
  });

  it("inherits the HRS-002 operating-hours support clock",()=>{
    expect(MIGRATION).toContain("couranr_add_operating_minutes(v_now,15)");
    expect(MIGRATION).toContain("couranr_is_within_operating_hours(v_now)");
    expect(MIGRATION).toContain("couranr_next_operating_period_start(v_now)");
    expect(MIGRATION).not.toContain("v_now + interval '15 minutes'");
  });

  it("renders the canonical structured report flow and merchandise boundary",()=>{
    expect(PAGE).toContain('id="delivery-problem"');
    expect(PAGE).toContain("What went wrong?");
    expect(PAGE).toContain("Add photos");
    expect(PAGE).toContain("Submit delivery report");
    expect(PAGE).toContain("The business remains responsible for the merchandise");
    expect(CLIENT).toContain("uploadCustomerProblemPhoto");
  });

  it("distinguishes report-subsystem failure from an empty report list",()=>{
    expect(HELP_ROUTE).toContain("problemReports: isProblemFailure(problemReportsResult)");
    expect(HELP_ROUTE).toContain("? null");
    expect(PAGE).toContain("Problem reports are temporarily unavailable");
  });

  it("wires submitted reports into the existing Operations incident workspace",()=>{
    expect(OPS).toContain("Customer delivery reports");
    expect(OPS).toContain("/api/couranr/operations/problem-reports");
    expect(OPS).toContain("Request evidence");
    expect(OPS).toContain("Resolve report");
    expect(OPS).toContain("View photo");
    expect(CLIENT).not.toContain("/operations/problem-reports");
  });

  it("does not import money, return, custody or delivery-state mutation into CUS-004",()=>{
    const joined=[MIGRATION,SERVER,CLIENT,PROBLEM_ROUTE].join("\n");
    for(const forbidden of [
      "refundPayment(",
      "couranr_require_return",
      "couranr_start_return",
      "couranr_cancel_delivery",
      "update public.couranr_deliveries",
      "payer_owes_cents",
    ])expect(joined,forbidden).not.toContain(forbidden);
  });
});
