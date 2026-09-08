/**
 * HOSTED TIMING — ZERO-DOWNTIME DEPLOY CUTOVER, PostgREST EXECUTION PROOF.
 *
 * 20260908220000 keeps the OLD 13-argument hosted create and 26-argument
 * hosted validate commands alive through the deploy gap while the STRICT
 * 17/29-argument arities (no defaults) carry the TMZ-001 timing contract; the
 * POSTDEPLOY fence 20260908230000 then retires the old arities. Every claim is
 * proven THROUGH PostgREST — the exact RPC path both application generations
 * use — not just in SQL:
 *
 *   POSTDEPLOY (full sequence, fence applied):
 *     · the OLD shapes are GONE — PGRST202 (not found), explicitly not
 *       PGRST203 (ambiguous) and not a policy refusal;
 *     · the NEW shapes create ASAP and SCHEDULED requests and validate them,
 *       with the two-sided instant the new application derives under
 *       America/New_York accepted by PostgreSQL's own tzdata.
 *   PREDEPLOY (fence rolled back = production after applying 20260908220000,
 *              before deploy):
 *     · the OLD application's exact named shapes still create and validate
 *       an ASAP request exactly as production does today;
 *     · the NEW shapes resolve to the strict arities in the same window;
 *     · neither direction is ambiguous — no PGRST203.
 *
 * PostgREST caches the schema, so each migration flip restarts it — the same
 * reload production gets from NOTIFY pgrst / a deploy.
 */
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import {
  POSTGREST_PORT,
  SERVICE_ROLE_JWT,
  startPostgrest,
  waitForPostgrest,
  waitForPortFree,
} from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PGRST_BIN = postgrestTarget();
const FENCE = path.join(ROOT, "supabase/migrations/20260908230000_couranr_hosted_legacy_arity_fence.sql");
const FENCE_RB = path.join(ROOT, "supabase/rollbacks/20260908230000_couranr_hosted_legacy_arity_fence.rollback.sql");

let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const jsonLit = (v) => `'${esc(JSON.stringify(v))}'::jsonb`;
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};

const BUSINESS = "51111111-1111-4111-8111-111111111111";
const OWNER = "52222222-2222-4222-8222-222222222222";
const SLUG = "hst-cutover-shop";
const POLICY = "couranr-pricing-v2-2026-09-01";
const PICKUP = {
  googlePlaceId: "hst-cutover-pickup", formattedAddress: "1 Main St, Stafford, VA 22554, USA",
  line1: "1 Main St", line2: null, city: "Stafford", region: "VA", postalCode: "22554",
  countryCode: "US", latitude: 38.42, longitude: -77.41, addressSource: "google_places_new", instructions: null,
};
const dropoff = (pid) => ({
  googlePlaceId: pid, formattedAddress: "9 Receive Ct, Woodbridge, VA 22191, USA",
  line1: "9 Receive Ct", line2: null, city: "Woodbridge", region: "VA", postalCode: "22191",
  countryCode: "US", latitude: 38.658, longitude: -77.25, addressSource: "google_places_new", instructions: null,
});
/* An ordinary Wednesday inside the operating window, before the 2027 DST
   change (2027-03-14): 10:30 America/New_York is 15:30Z. This is the instant
   the NEW application derives with Node's ICU; PostgreSQL re-derives it with
   its own tzdata and must agree — the two-sided rule, through PostgREST. */
const LOCAL = "2027-03-10T10:30";
const INSTANT = "2027-03-10T15:30:00.000Z";

function seedMerchant() {
  psql(`insert into auth.users(id,email) values ('${OWNER}','hst-cutover@example.test');
        insert into public.business_accounts(id,name,slug,created_by)
          values ('${BUSINESS}','[HST] cutover shop','${SLUG}','${OWNER}');
        insert into public.business_members(business_account_id,user_id,role,status)
          values ('${BUSINESS}','${OWNER}','owner','active');
        insert into public.couranr_merchant_workspaces
          (business_account_id,created_by,idempotency_key,business_category,
           pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at)
        values ('${BUSINESS}','${OWNER}','hst-cut-ws-${crypto.randomUUID()}','general_local_business',
          ${jsonLit(PICKUP)},'540-555-0100','merchant','v1',now());
        insert into public.couranr_workspace_activations
          (business_account_id,activation_state,reviewed_at,reviewed_by)
        values ('${BUSINESS}','live',now(),'${OWNER}');
        insert into public.couranr_website_tool_configs(business_account_id,status,updated_by)
        values ('${BUSINESS}','published','${OWNER}');`);
}
function newIntake() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return one(`select id from public.couranr_create_hosted_request_intake(
    p_slug := '${SLUG}', p_token_hash := '${sha256(raw)}', p_ttl_minutes := 1440)`);
}
const destinationOf = (intakeId) =>
  one(`select destination_place_id from public.couranr_hosted_request_intakes where id='${intakeId}'`);

/** The OLD application's create body — the EXACT 13 named keys the deployed SHA sends today. */
function oldCreateBody(intakeId) {
  return {
    p_intake_id: intakeId,
    p_order_reference: "ORDER-42", p_requested_payer_type: "customer",
    p_destination_place_id: `hst-cut-drop-${crypto.randomUUID().slice(0, 8)}`,
    p_destination_label: "9 Receive Ct, Woodbridge, VA",
    p_recipient_name: "Rae Recipient", p_recipient_phone: "+15715550188", p_recipient_email: null,
    p_weight_lb: null, p_weight_band: "0_25_lb",
    p_customer_restricted_class: "none", p_signature_requested: false,
    p_shipment_description: "one boxed lamp",
  };
}
/** The NEW application's create body — all 17 keys. */
function newCreateBody(intakeId, timing) {
  return {
    ...oldCreateBody(intakeId),
    p_timing_intent: timing.intent,
    p_requested_pickup_local: timing.local ?? null,
    p_requested_departure_at: timing.instant ?? null,
    p_timing_review_reasons: [],
  };
}
/** The OLD application's validate body — its exact 26 named keys. */
function oldValidateBody(requestId, version, destinationPlace) {
  return {
    p_request_id: requestId, p_host_business_account_id: BUSINESS,
    p_expected_version: version, p_actor_user_id: OWNER,
    p_payer_type: "customer", p_weight_lb: null, p_weight_band: "0_25_lb",
    p_restricted_class: "none", p_signature_required: false,
    p_pickup_address: PICKUP, p_dropoff_address: dropoff(destinationPlace),
    p_route_distance_meters: Math.round(5 * 1609.344), p_route_duration_seconds: 600,
    p_route_static_duration_seconds: 600, p_route_traffic_delay_seconds: 0,
    p_distance_source: "mapbox_directions_v5", p_serviceability_outcome: "available_for_request",
    p_route_review_reason: null,
    p_quote_status: "estimated", p_pricing_policy_version: POLICY,
    p_delivery_subtotal_cents: 2299, p_included_loaded_miles: 2, p_billable_loaded_miles: 3,
    p_quote_line_items: [{ code: "delivery_base", label: "Delivery", amountCents: 2299 }],
    p_review_reasons: [],
    p_timing_review_reasons: [],
  };
}
/** The NEW application's validate body — all 29 keys. */
function newValidateBody(requestId, version, destinationPlace, timing) {
  return {
    ...oldValidateBody(requestId, version, destinationPlace),
    p_timing_intent: timing.intent,
    p_requested_pickup_local: timing.local ?? null,
    p_requested_departure_at: timing.instant ?? null,
  };
}

async function rpc(name, body) {
  const res = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

/** Apply a migration/rollback file and restart PostgREST so it re-reads the schema. */
async function flip(file, pgrstRef) {
  const pgbin = process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin";
  const pgport = process.env.COURANR_DISPOSABLE_PORT || "55432";
  execFileSync(path.join(pgbin, "psql"), [
    "-h", "127.0.0.1", "-p", String(pgport), "-U", "postgres", "-d", "couranr_disposable",
    "-q", "-v", "ON_ERROR_STOP=1", "-f", file,
  ], { encoding: "utf8" });
  pgrstRef.proc.kill("SIGTERM");
  await waitForPortFree(POSTGREST_PORT, "PostgREST", { log: () => {} });
  pgrstRef.proc = await startPostgrest({
    dbUrl: dbUrl(),
    binary: PGRST_BIN,
    workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
  });
  if (!(await waitForPostgrest())) throw new Error("PostgREST did not restart");
}

const CREATE = "couranr_create_hosted_delivery_request";
const VALIDATE = "couranr_validate_hosted_delivery_request";
const arities = (fn) =>
  one(`select coalesce(string_agg(distinct pronargs::text,',' order by pronargs::text),'-')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='${fn}'`);
const timingOf = (row) => `${row?.timing_intent ?? "-"}|${row?.requested_pickup_local ?? "-"}|${row?.requested_departure_at ? "instant" : "-"}`;

async function main() {
  const pgrstRef = { proc: null };
  try {
    console.log("  bringing up the disposable database (full sequence, fence included)...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);
    seedMerchant();

    pgrstRef.proc = await startPostgrest({
      dbUrl: dbUrl(), binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");

    console.log("\n  Hosted timing deploy cutover — PostgREST resolution proof\n");

    /* ═══ POSTDEPLOY state (full sequence): old shapes gone, strict serves ═══ */
    check("HCUT-01", "postdeploy: only the strict arities exist (create 17, validate 29)",
      `${arities(CREATE)}/${arities(VALIDATE)}`, "17/29");
    const oldPost = await rpc(CREATE, oldCreateBody(newIntake()));
    check("HCUT-02", "postdeploy: the OLD create shape is REFUSED as not-found — PGRST202",
      `${oldPost.status}|${oldPost.json?.code}`, "404|PGRST202");
    check("HCUT-03", "... and explicitly NOT ambiguous — PGRST203 never appears",
      oldPost.json?.code === "PGRST203", "false");
    const asapPost = await rpc(CREATE, newCreateBody(newIntake(), { intent: "asap" }));
    check("HCUT-04", "postdeploy: the NEW shape creates an ASAP hosted request",
      `${asapPost.status}|${asapPost.json?.request_state}|${timingOf(asapPost.json)}`,
      "200|awaiting_merchant_confirmation|asap|-|-");
    const schedIntake = newIntake();
    const schedPost = await rpc(CREATE, newCreateBody(schedIntake, { intent: "scheduled", local: LOCAL, instant: INSTANT }));
    check("HCUT-05", "postdeploy: the NEW shape creates a SCHEDULED request — the Node-derived instant agrees with PostgreSQL's tzdata",
      `${schedPost.status}|${timingOf(schedPost.json)}`, `200|scheduled|${LOCAL}|instant`);
    const badInstant = await rpc(CREATE, newCreateBody(newIntake(), { intent: "scheduled", local: LOCAL, instant: "2027-03-10T16:30:00.000Z" }));
    // PostgREST answers a custom SQLSTATE with HTTP 400 and the code verbatim; the
    // application layer (lib/couranr/errors.ts) is what maps CR422 to 422.
    check("HCUT-06", "postdeploy: a mismatched instant is a CR422 refusal through PostgREST, not a stored lie",
      `${badInstant.status}|${badInstant.json?.code}|${badInstant.json?.message}`, "400|CR422|requested_departure_mismatch");
    const schedVal = await rpc(VALIDATE, newValidateBody(schedPost.json?.id, schedPost.json?.version, destinationOf(schedIntake),
      { intent: "scheduled", local: LOCAL, instant: INSTANT }));
    check("HCUT-07", "postdeploy: the NEW validate shape confirms the schedule and mints the quote against it",
      `${schedVal.status}|${schedVal.json?.request_state}|${schedVal.json?.quote_status}|${schedVal.json?.timing_intent}|${schedVal.json?.requested_pickup_local}`,
      `200|pending_couranr_review|estimated|scheduled|${LOCAL}`);
    const oldValPost = await rpc(VALIDATE, oldValidateBody(asapPost.json?.id, asapPost.json?.version, destinationOf(newIntake())));
    check("HCUT-08", "postdeploy: the OLD validate shape is PGRST202 too",
      `${oldValPost.status}|${oldValPost.json?.code}`, "404|PGRST202");

    /* ═══ PREDEPLOY state: roll the fence back — both arities live ═══ */
    console.log("\n  rolling the fence back → the PREDEPLOY compatibility window...\n");
    await flip(FENCE_RB, pgrstRef);
    check("HCUT-09", "predeploy: both arities live (create 13,17; validate 26,29)",
      `${arities(CREATE)}/${arities(VALIDATE)}`, "13,17/26,29");
    const preIntake = newIntake();
    const oldPre = await rpc(CREATE, oldCreateBody(preIntake));
    check("HCUT-10", "PREDEPLOY: the OLD application's exact create shape still creates an ASAP request — zero downtime, no PGRST203",
      `${oldPre.status}|${oldPre.json?.request_state}|${timingOf(oldPre.json)}`,
      "200|awaiting_merchant_confirmation|asap|-|-");
    const oldPreVal = await rpc(VALIDATE, oldValidateBody(oldPre.json?.id, oldPre.json?.version, destinationOf(preIntake)));
    check("HCUT-11", "PREDEPLOY: the OLD validate shape still mints, exactly as today",
      `${oldPreVal.status}|${oldPreVal.json?.quote_status}|${oldPreVal.json?.timing_intent}`, "200|estimated|asap");
    const newPreIntake = newIntake();
    const newPre = await rpc(CREATE, newCreateBody(newPreIntake, { intent: "scheduled", local: LOCAL, instant: INSTANT }));
    check("HCUT-12", "PREDEPLOY: the NEW create shape resolves to the STRICT arity in the same window — no PGRST203 either way",
      `${newPre.status}|${timingOf(newPre.json)}`, `200|scheduled|${LOCAL}|instant`);
    const oldOnScheduled = await rpc(VALIDATE, oldValidateBody(newPre.json?.id, newPre.json?.version, destinationOf(newPreIntake)));
    check("HCUT-12b", "PREDEPLOY: the OLD validate shape on a SCHEDULED row is REFUSED (deploy-gap guard, 20260908220500) — never rewritten to asap",
      `${oldOnScheduled.status}|${oldOnScheduled.json?.code}|${oldOnScheduled.json?.message}`,
      "400|CR409|hosted_scheduled_timing_requires_current_application");
    const newPreVal = await rpc(VALIDATE, newValidateBody(newPre.json?.id, newPre.json?.version, destinationOf(newPreIntake),
      { intent: "scheduled", local: LOCAL, instant: INSTANT }));
    check("HCUT-13", "... and the NEW validate shape too",
      `${newPreVal.status}|${newPreVal.json?.quote_status}|${newPreVal.json?.timing_intent}`, "200|estimated|scheduled");
    check("HCUT-14", "predeploy: the old-shape request recorded NO customer timing statement, the new-shape request did",
      one(`select string_agg(coalesce(customer_timing_intent,'-'),',' order by created_at)
            from public.couranr_hosted_request_intakes where id in ('${preIntake}','${newPreIntake}')`),
      "-,scheduled");

    /* ═══ Fence re-applied: the window closes ═══ */
    console.log("\n  re-applying the fence → POSTDEPLOY again...\n");
    await flip(FENCE, pgrstRef);
    const oldRefenced = await rpc(CREATE, oldCreateBody(newIntake()));
    check("HCUT-15", "after the fence the OLD shape can no longer create a hosted request — PGRST202, not PGRST203",
      `${oldRefenced.status}|${oldRefenced.json?.code}`, "404|PGRST202");
    const newRefenced = await rpc(CREATE, newCreateBody(newIntake(), { intent: "asap" }));
    check("HCUT-16", "... while the NEW shape stays green",
      `${newRefenced.status}|${newRefenced.json?.timing_intent}`, "200|asap");
    check("HCUT-17", "arities back to strict-only", `${arities(CREATE)}/${arities(VALIDATE)}`, "17/29");

    console.log(`\n  Hosted timing deploy cutover: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    try { pgrstRef.proc?.kill("SIGTERM"); } catch { /* gone */ }
    down({ quiet: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
