import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const ROOT=process.cwd();
const read=(p:string)=>fs.readFileSync(path.join(ROOT,p),"utf8");

const MIGRATION=read("supabase/migrations/20260907223000_couranr_customer_problem_reports.sql");
const ROLLBACK=read("supabase/rollbacks/20260907223000_couranr_customer_problem_reports.rollback.sql");
const HARDENING=read("supabase/migrations/20260908142000_couranr_customer_problem_report_hardening.sql");
const HARDENING_ROLLBACK=read("supabase/rollbacks/20260908142000_couranr_customer_problem_report_hardening.rollback.sql");
const CLEANUP_ACK=read("supabase/migrations/20260908143800_couranr_customer_problem_cleanup_ack.sql");
const CLEANUP_ACK_ROLLBACK=read("supabase/rollbacks/20260908143800_couranr_customer_problem_cleanup_ack.rollback.sql");
const OPS_ROUTE=read("app/api/couranr/operations/problem-reports/route.ts");
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

  it("makes submit replay-safe in SQL and keeps the exact report id in the browser",()=>{
    const replay=MIGRATION.indexOf("LOST-RESPONSE RULE");
    const state=MIGRATION.indexOf("if v_row.report_state<>'draft'");
    const update=MIGRATION.indexOf("set report_state='reported'");
    expect(replay).toBeGreaterThan(-1);
    expect(state).toBeGreaterThan(replay);
    expect(update).toBeGreaterThan(state);

    const pending=PAGE.indexOf("if(pendingSubmit.current)");
    const save=PAGE.indexOf("const saved=await saveProblemDraft",pending);
    expect(pending).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(pending);
    expect(PAGE).toContain("pendingSubmit.current=request");
    expect(PAGE).toContain("reportId:pendingSubmit.current.reportId");
  });

  it("allows only one unresolved customer report per delivery",()=>{
    expect(MIGRATION).toContain("couranr_cpr_one_open_per_delivery_uniq");
    expect(MIGRATION).toContain("where report_state<>'resolved'");
    expect(MIGRATION).toContain("raise exception 'problem_report_open' using errcode='CR409'");
    expect(SERVER).toContain('"A delivery problem report is already open. Reload to see its status."');
  });

  it("serializes concurrent first-draft creation on the canonical delivery row",()=>{
    const lock=MIGRATION.indexOf("for update of d;");
    const openLookup=MIGRATION.indexOf("where delivery_id=v_delivery and report_state<>'resolved'");
    expect(lock).toBeGreaterThan(-1);
    expect(openLookup).toBeGreaterThan(lock);
    expect(MIGRATION).toContain("raise exception 'problem_report_open' using errcode='CR409'");
  });

  it("aligns database upload-grant lifetime with the provider and has an object cleanup path",()=>{
    expect(MIGRATION).toContain("interval '125 minutes'");
    expect(MIGRATION).toContain("couranr_collect_expired_customer_problem_evidence");
    expect(MIGRATION).toContain("upload_state='abandoned'");
    expect(SERVER).toContain("cleanupExpiredCustomerProblemEvidence");
    expect(SERVER).toContain(".from(BUCKET).remove(paths)");
    expect(SERVER).toContain("cleanupExpiredCustomerProblemEvidence({");
  });

  it("uses a safe evidence-cap refusal instead of a retry-later rate-limit message",()=>{
    expect(MIGRATION).toContain("problem_evidence_limit_reached' using errcode='CR400'");
    expect(SERVER).toContain('"This report already has five photos."');
    expect(PAGE).toContain("remainingPhotoSlots");
  });

  it("moves support ownership to the customer when Operations requests evidence and back after upload",()=>{
    expect(MIGRATION).toContain("waiting_on='customer'");
    expect(MIGRATION).toContain("awaiting_reply_kind=null");
    expect(MIGRATION).toContain("first_couranr_response_at=coalesce");
    expect(MIGRATION).toContain("if v_report.report_state='awaiting_evidence'");
    expect(MIGRATION).toContain("waiting_on='couranr'");
    expect(MIGRATION).toContain("awaiting_reply_kind='customer'");
  });

  it("uses the existing private bucket with opaque server-owned paths and storage revalidation",()=>{
    expect(SERVER).toContain('const BUCKET="delivery-photos"');
    expect(SERVER).toContain("randomBytes(16).toString");
    expect(SERVER).toContain(".createSignedUploadUrl");
    expect(SERVER).toContain("readStoredObject");
    expect(SERVER).toContain("stored.size!==authExpectedBytes");
    expect(SERVER).toContain("stored.mime!==authExpectedMime");
    expect(MIGRATION).toContain("storage_bucket='delivery-photos'");
    expect(MIGRATION).toContain("customer-problem/v1/");
  });

  it("converges a lost successful storage PUT and never rotates a still-live mismatched path",()=>{
    const inspect=SERVER.indexOf("const stored=await readStoredObject");
    const exact=SERVER.indexOf("stored.size===Number(row.expected_bytes)",inspect);
    const finalize=SERVER.indexOf("finalizeCustomerProblemEvidence",exact);
    const mismatch=SERVER.indexOf("A non-matching object stays quarantined",finalize);
    const sign=SERVER.indexOf(".createSignedUploadUrl",mismatch);
    expect(inspect).toBeGreaterThan(-1);
    expect(exact).toBeGreaterThan(inspect);
    expect(finalize).toBeGreaterThan(exact);
    expect(mismatch).toBeGreaterThan(finalize);
    expect(sign).toBeGreaterThan(mismatch);
    expect(SERVER).not.toContain("couranr_refresh_customer_problem_evidence");
    expect(MIGRATION).not.toContain("couranr_refresh_customer_problem_evidence");
    expect(ROLLBACK).toContain(
      "drop function if exists public.couranr_collect_expired_customer_problem_evidence"
    );
  });

  it("scopes the finalization envelope to the redeemed Help token before reading a private object path",()=>{
    expect(MIGRATION).toContain("couranr_customer_problem_evidence_authorization");
    expect(MIGRATION).toContain("h.delivery_id=r.delivery_id");
    expect(SERVER).toContain('"couranr_customer_problem_evidence_authorization"');
    const finalizeStart=SERVER.indexOf("export async function finalizeCustomerProblemEvidence");
    const finalizeEnd=SERVER.indexOf("export async function submitCustomerProblemReport",finalizeStart);
    const finalizeBody=SERVER.slice(finalizeStart,finalizeEnd);
    expect(finalizeBody).not.toContain('.from("couranr_customer_problem_evidence")');
    expect(finalizeBody).toContain("authPath");
  });

  it("rejects expired finalization and persists abandonment before storage cleanup",()=>{
    expect(MIGRATION).toContain("problem_evidence_grant_expired");
    expect(SERVER).toContain('"couranr_customer_problem_evidence_authorization"');
    expect(SERVER).toContain("authExpiresAt");
    expect(SERVER).toContain('"couranr_abandon_customer_problem_evidence"');
    expect(SERVER).toContain(".remove([authPath])");
    expect(ROLLBACK).toContain(
      "drop function if exists public.couranr_abandon_customer_problem_evidence"
    );
  });

  it("renews the DB envelope before every freshly minted provider upload URL",()=>{
    expect(HARDENING).toContain("couranr_renew_customer_problem_evidence_grant");
    expect(HARDENING).toContain("interval '125 minutes'");
    const renew=SERVER.indexOf('"couranr_renew_customer_problem_evidence_grant"');
    const sign=SERVER.indexOf(".createSignedUploadUrl",renew);
    expect(renew).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(renew);
    expect(HARDENING_ROLLBACK).toContain(
      "drop function if exists public.couranr_renew_customer_problem_evidence_grant"
    );
  });

  it("treats a concurrent verification during grant renewal as successful convergence",()=>{
    const renew=SERVER.indexOf('"couranr_renew_customer_problem_evidence_grant"');
    const verified=SERVER.indexOf('if(row.upload_state==="verified")',renew);
    const sign=SERVER.indexOf(".createSignedUploadUrl",verified);
    expect(renew).toBeGreaterThan(-1);
    expect(verified).toBeGreaterThan(renew);
    expect(sign).toBeGreaterThan(verified);
    expect(SERVER.slice(verified,sign)).toContain('status:"verified"');
  });

  it("gives Operations an explicit retryable orphan cleanup path without a cron",()=>{
    expect(HARDENING).toContain(
      "couranr_collect_expired_problem_evidence_ops"
    );
    expect(HARDENING).toContain("for update skip locked");
    expect(SERVER).toContain("cleanupExpiredOperationsProblemEvidence");
    expect(SERVER).toContain("problemEvidence.operations.cleanupStorage");
    expect(OPS_ROUTE).toContain('body?.command!=="cleanup_expired_evidence"');
    expect(OPS).toContain("Clean expired uploads");
    expect(HARDENING_ROLLBACK).toContain(
      "drop function if exists public.couranr_collect_expired_problem_evidence_ops"
    );
  });

  it("retires successful cleanup tombstones so bounded batches can advance",()=>{
    expect(CLEANUP_ACK).toContain("storage_cleaned_at timestamptz");
    expect(CLEANUP_ACK).toContain("and e.storage_cleaned_at is null");
    expect(CLEANUP_ACK).toContain("couranr_ack_problem_evidence_cleanup_ops");
    const remove=SERVER.indexOf(".from(BUCKET).remove(paths)");
    const ack=SERVER.indexOf('"couranr_ack_problem_evidence_cleanup_ops"',remove);
    expect(remove).toBeGreaterThan(-1);
    expect(ack).toBeGreaterThan(remove);
    expect(SERVER.slice(remove,ack)).toContain("if(removeError)");
    expect(CLEANUP_ACK_ROLLBACK).toContain(
      "drop function if exists public.couranr_ack_problem_evidence_cleanup_ops"
    );
    expect(CLEANUP_ACK_ROLLBACK).toContain("drop column if exists storage_cleaned_at");
  });

  it("refuses an Operations evidence request when all five technical evidence slots are consumed",()=>{
    expect(HARDENING).toContain("v_evidence_slots>=5");
    expect(HARDENING).toContain(
      "raise exception 'problem_evidence_limit_reached' using errcode='CR409'"
    );
    expect(SERVER).toContain(
      "This report already has five photos. Review the existing evidence instead of requesting more."
    );
    expect(OPS).toContain('disabled={evidenceAtCap}');
    expect(OPS).toContain('evidenceAtCap?"Evidence limit reached":"Request evidence"');
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

  it("keeps the canonical resolved case status visible after review completes",()=>{
    expect(PAGE).toContain("const active=reports?.[0]??null");
    expect(PAGE).toContain('active.state==="resolved"');
    expect(PAGE).toContain('title="Resolved"');
    expect(PAGE).toContain('active.state==="resolved"?"success":"warning"');
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

  it("opens the Operations evidence window from the click before awaiting the signed URL",()=>{
    const openAt=OPS.indexOf('window.open("about:blank"');
    const awaitAt=OPS.indexOf("await loadCustomerProblemEvidenceUrl",openAt);
    expect(openAt).toBeGreaterThan(-1);
    expect(awaitAt).toBeGreaterThan(openAt);
    expect(OPS).toContain("viewer.location.replace");
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
