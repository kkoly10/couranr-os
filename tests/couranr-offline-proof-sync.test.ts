import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_OFFLINE_SYNC_ATTEMPTS,
  OFFLINE_PROOF_PERSISTED_FIELDS,
  classifyProofSyncFailure,
  sameOfflineEnvelope,
  type OfflineProofEnvelope,
} from "@/components/couranr/dispatch/offlineProofQueue";

const ROOT=process.cwd();
const read=(p:string)=>readFileSync(join(ROOT,p),"utf8");
const MIG=read("supabase/migrations/20260906020000_couranr_offline_proof_sync.sql");
const RB=read("supabase/rollbacks/20260906020000_couranr_offline_proof_sync.rollback.sql");

function envelope(over:Partial<OfflineProofEnvelope>={}):OfflineProofEnvelope {
  return {
    id:"11111111-1111-4111-8111-111111111111",
    deliveryId:"22222222-2222-4222-8222-222222222222",
    stage:"pickup",
    proofType:"shipment_photo",
    mimeType:"image/jpeg",
    byteSize:1234,
    sha256:"a".repeat(64),
    capturedAt:"2026-09-06T01:00:00.000Z",
    latitude:38.4,
    longitude:-77.4,
    accuracyM:8,
    discrepancyId:null,
    ...over,
  };
}

describe("P7-004 offline proof queue",()=>{
  it("persists only the encrypted evidence envelope and retry metadata",()=>{
    expect(OFFLINE_PROOF_PERSISTED_FIELDS).toEqual([
      "id","envelope","ciphertext","iv","state","attempts","lastAttemptAt","lastErrorCode","alertReported",
    ]);
    for(const secret of ["accessToken","authorization","signedUrl","uploadToken","objectPath","recipient","address","phone"]){
      expect((OFFLINE_PROOF_PERSISTED_FIELDS as readonly string[])).not.toContain(secret);
    }
    const src=read("components/couranr/dispatch/offlineProofQueue.ts");
    expect(src).toContain('{ name: "AES-GCM", length: 256 }');
    expect(src).toContain("false,\n    [\"encrypt\", \"decrypt\"]");
    expect(src).not.toContain("localStorage.setItem");
    expect(src).not.toContain("sessionStorage.setItem");
  });

  it("keeps an immutable stable evidence identity across retries",()=>{
    expect(sameOfflineEnvelope(envelope(),envelope())).toBe(true);
    expect(sameOfflineEnvelope(envelope(),envelope({byteSize:1235}))).toBe(false);
    expect(sameOfflineEnvelope(envelope(),envelope({deliveryId:"33333333-3333-4333-8333-333333333333"}))).toBe(false);
  });

  it("uses bounded retry semantics and terminal server/tenure failures",()=>{
    expect(MAX_OFFLINE_SYNC_ATTEMPTS).toBe(5);
    expect(classifyProofSyncFailure(0)).toEqual({kind:"retryable",code:"http_0"});
    expect(classifyProofSyncFailure(503)).toEqual({kind:"retryable",code:"http_503"});
    expect(classifyProofSyncFailure(409,"conflict")).toEqual({
      kind:"terminal",code:"conflict",reason:"assignment_or_stage_changed"
    });
    expect(classifyProofSyncFailure(422,"invalid_input")).toEqual({
      kind:"terminal",code:"invalid_input",reason:"server_rejected"
    });
  });
});

describe("P7-004 server reconciliation",()=>{
  it("is additive and leaves the legacy proof RPCs available during rollout",()=>{
    expect(MIG).toContain("couranr_prepare_proof_upload_v2");
    expect(MIG).toContain("couranr_finalize_proof_upload_v2");
    expect(MIG).not.toContain("drop function if exists public.couranr_create_proof_upload");
    expect(MIG).not.toContain("drop function if exists public.couranr_finalize_proof_upload");
  });

  it("serializes duplicate evidence and makes finalized proof identity unique",()=>{
    expect(MIG).toContain("pg_advisory_xact_lock(hashtextextended");
    expect(MIG).toContain("couranr_dp_client_evidence_uniq");
    expect(MIG).toContain("'status','verified'");
    expect(MIG).toContain("evidence_identity_conflict");
  });

  it("binds capture-time evidence before upload and never trusts retry-time location",()=>{
    expect(MIG).toContain("captured_latitude");
    expect(MIG).toContain("captured_longitude");
    expect(MIG).toContain("captured_accuracy_m");
    const finalize=MIG.slice(
      MIG.indexOf("create or replace function public.couranr_finalize_proof_upload_v2"),
      MIG.indexOf("/* --------------------------- terminal alert writer",MIG.indexOf("couranr_finalize_proof_upload_v2"))
    );
    expect(finalize).toContain("v_up.captured_latitude");
    expect(finalize).not.toContain("p_latitude");
  });

  it("surfaces terminal failure as service-role-only Operations work",()=>{
    expect(MIG).toContain("create table if not exists public.couranr_proof_sync_failures");
    expect(MIG).toContain("couranr_report_proof_sync_failure");
    expect(MIG).toContain("psf.failure_state='open'");
    expect(MIG).toMatch(/revoke all on public\.couranr_proof_sync_failures from public,anon,authenticated,service_role;/);
    expect(MIG).toMatch(/grant select,insert,update on public\.couranr_proof_sync_failures to service_role;/);
    const lifecycle=read("lib/couranr/fulfillment/lifecycle.ts");
    expect(lifecycle).toContain('"proof_sync_attention"');
  });

  it("refuses rollback once offline evidence or alert evidence exists",()=>{
    expect(RB).toContain("offline_proof_sync_rollback_would_destroy_evidence");
    expect(RB).toContain("where client_evidence_id is not null");
    expect(RB).toContain("select 1 from public.couranr_proof_sync_failures");
  });

  it("the browser route supports both stale legacy bundles and V2 evidence envelopes",()=>{
    const route=read("app/api/couranr/driver/deliveries/[id]/proof-upload/route.ts");
    expect(route).toContain("clientEvidenceId");
    expect(route).toContain("prepareProofUploadV2");
    expect(route).toContain("createProofUpload");
    const hook=read("components/couranr/dispatch/useProofUpload.ts");
    expect(hook).toContain("saveOfflineProof");
    expect(hook).toContain('setStatus("queued")');
  });

  it("DRV-007 is a real route variant, not a placeholder",()=>{
    const page=read("app/(couranr)/driver/deliveries/[id]/page.tsx");
    expect(page).toContain('searchParams?.panel === "offline-sync"');
    expect(page).toContain("<OfflineProofSyncPanel");
    const panel=read("components/couranr/dispatch/OfflineProofSyncPanel.tsx");
    expect(panel).toContain("Pending sync");
    expect(panel).toContain("Operations attention");
    expect(panel).toContain("Retry now");
  });
});
