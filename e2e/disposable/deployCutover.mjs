/**
 * ZERO-DOWNTIME DEPLOY CUTOVER — PostgREST EXECUTION PROOF (correction §2).
 *
 * The compatibility architecture keeps the OLD 31/33-argument routed
 * create/estimate commands alive through the deploy gap while the STRICT
 * 37/39-argument arities (no defaults) carry the new safety-declaration,
 * weight-honesty and timing rules; the POSTDEPLOY fence migration then
 * retires the old arities. Every claim below is proven THROUGH PostgREST —
 * the exact RPC path both application generations use — not just in SQL:
 *
 *   PREDEPLOY  (fence rolled back = the state production is in after
 *               applying 20260902200000 + 20260902210000, before deploy):
 *     · the OLD application's exact named RPC shape still MINTS an
 *       estimated quote (create) and re-estimates (estimate);
 *     · the NEW application's full-key shape works too;
 *     · neither shape is ambiguous — no PGRST203 in either direction.
 *   POSTDEPLOY (fence applied):
 *     · the OLD shape is GONE — PGRST202 (not found), explicitly not
 *       PGRST203 (ambiguous) and not a policy refusal;
 *     · the NEW shape keeps minting.
 *
 * PostgREST caches the schema, so each migration flip restarts it — the same
 * reload production gets from NOTIFY pgrst / a deploy.
 */
import path from "node:path";
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
const FENCE = path.join(ROOT, "supabase/migrations/20260902220000_couranr_legacy_arity_fence.sql");
const FENCE_RB = path.join(ROOT, "supabase/rollbacks/20260902220000_couranr_legacy_arity_fence.rollback.sql");

let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};

const BUSINESS = "31111111-1111-4111-8111-111111111111";
const USER = "32222222-2222-4222-8222-222222222222";
const POLICY = "couranr-pricing-v2-2026-09-01";

const addr = (pid, line1) => ({
  googlePlaceId: pid,
  formattedAddress: `${line1}, Stafford, VA 22554, USA`,
  line1, line2: null, city: "Stafford", region: "VA", postalCode: "22554",
  countryCode: "US", latitude: 38.422, longitude: -77.408,
  addressSource: "google_places_new", instructions: null,
});
const items = (a) => [
  { code: "base_delivery", label: "Base", quantity: 1, unitAmountCents: a, amountCents: a },
];

/**
 * The OLD application's create body — the EXACT 31 named keys the deployed
 * SHA sends today (no band, no timing, no declaration). If this shape's
 * behavior changes, production changes.
 */
function oldCreateBody(key) {
  return {
    p_business_account_id: BUSINESS, p_created_by: USER, p_idempotency_key: key,
    p_source: "merchant_portal", p_readiness_state: "not_confirmed", p_payer_type: "merchant",
    p_recipient_name: "Recipient", p_recipient_phone: "555-0100", p_recipient_email: "r@example.test",
    p_weight_lb: 12.5, p_additional_stops: 0,
    p_service_level: "standard", p_signature_required: false, p_proof_method: "photo_or_pin",
    p_pickup_address: addr("place-pickup", "10 Market St"),
    p_dropoff_address: addr("place-drop", "20 Main St"),
    p_overnight_requested: false,
    p_route_distance_meters: 3219, p_route_duration_seconds: 600,
    p_route_static_duration_seconds: 600, p_route_traffic_delay_seconds: 0,
    p_distance_source: "google_routes_v2", p_serviceability_outcome: "available_for_request",
    p_route_review_reason: null,
    p_quote_status: "estimated", p_pricing_policy_version: POLICY,
    p_delivery_subtotal_cents: 799, p_included_loaded_miles: 2, p_billable_loaded_miles: 0,
    p_quote_line_items: items(799), p_review_reasons: [],
  };
}

/** The NEW application's create body — all 37 keys, declaration stated. */
function newCreateBody(key) {
  return {
    ...oldCreateBody(key),
    p_weight_band: null, p_timing_intent: "asap",
    p_requested_pickup_local: null, p_requested_departure_at: null,
    p_timing_review_reasons: [], p_restricted_class: "none",
  };
}

/** The OLD application's estimate body — its exact 33 named keys. */
function oldEstimateBody(requestId, version) {
  const b = oldCreateBody("unused");
  delete b.p_created_by;
  delete b.p_idempotency_key;
  return {
    p_request_id: requestId, p_expected_version: version,
    p_actor_user_id: USER, p_update_shipment: true, ...b,
  };
}

/** The NEW application's estimate body — all 39 keys. */
function newEstimateBody(requestId, version) {
  return {
    ...oldEstimateBody(requestId, version),
    p_weight_band: null, p_timing_intent: "asap",
    p_requested_pickup_local: null, p_requested_departure_at: null,
    p_timing_review_reasons: [], p_restricted_class: "none",
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
  // Same psql -f invocation up() uses, transaction and all. The env vars
  // mirror up.mjs's own defaults so a COURANR_* override moves both together.
  const { execFileSync } = await import("node:child_process");
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

const CREATE = "couranr_create_routed_delivery_request_draft";
const ESTIMATE = "couranr_calculate_routed_delivery_request_estimate";
const arities = (fn) =>
  one(`select coalesce(string_agg(distinct pronargs::text,',' order by pronargs::text),'-')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='${fn}'`);

async function main() {
  const pgrstRef = { proc: null };
  try {
    console.log("  bringing up the disposable database (full sequence, fence included)...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);
    psql(`insert into auth.users(id,email) values ('${USER}','cutover@example.test');
          insert into public.business_accounts(id,name,slug,created_by)
            values ('${BUSINESS}','Cutover Fixture','cutover-fixture','${USER}');
          insert into public.business_members(business_account_id,user_id,role,status)
            values ('${BUSINESS}','${USER}','owner','active');`);

    pgrstRef.proc = await startPostgrest({
      dbUrl: dbUrl(), binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");

    console.log("\n  Deploy cutover — PostgREST resolution proof\n");

    /* ═══ POSTDEPLOY state (full sequence): old shape gone, strict serves ═══ */
    check("CUT-01", "postdeploy: only the strict arity exists (create 37, estimate 39)",
      `${arities(CREATE)}/${arities(ESTIMATE)}`, "37/39");
    const oldPost = await rpc(CREATE, oldCreateBody("cut-old-postdeploy"));
    check("CUT-02", "postdeploy: the OLD application shape is REFUSED as not-found — PGRST202",
      `${oldPost.status}|${oldPost.json?.code}`, "404|PGRST202");
    check("CUT-03", "... and explicitly NOT ambiguous — PGRST203 never appears",
      oldPost.json?.code === "PGRST203", "false");
    const newPost = await rpc(CREATE, newCreateBody("cut-new-postdeploy"));
    check("CUT-04", "postdeploy: the NEW application shape mints an estimated quote",
      `${newPost.status}|${newPost.json?.quote_status}|${newPost.json?.restricted_class}`,
      "200|estimated|none");
    const newPostEst = await rpc(ESTIMATE, newEstimateBody(newPost.json?.id, newPost.json?.version));
    check("CUT-05", "postdeploy: the NEW estimate shape re-quotes",
      `${newPostEst.status}|${newPostEst.json?.quote_status}`, "200|estimated");
    const oldPostEst = await rpc(ESTIMATE, oldEstimateBody(newPost.json?.id, newPostEst.json?.version));
    check("CUT-06", "postdeploy: the OLD estimate shape is PGRST202 too",
      `${oldPostEst.status}|${oldPostEst.json?.code}`, "404|PGRST202");

    /* ═══ PREDEPLOY state: roll the fence back — both arities live ═══ */
    console.log("\n  rolling the fence back → the PREDEPLOY compatibility window...\n");
    await flip(FENCE_RB, pgrstRef);
    check("CUT-07", "predeploy: both arities live (create 31,37; estimate 33,39)",
      `${arities(CREATE)}/${arities(ESTIMATE)}`, "31,37/33,39");
    const oldPre = await rpc(CREATE, oldCreateBody("cut-old-predeploy"));
    check("CUT-08", "PREDEPLOY: the OLD application's exact RPC shape MINTS an estimated quote — zero downtime, no PGRST203",
      `${oldPre.status}|${oldPre.json?.quote_status}|${oldPre.json?.restricted_class ?? "-"}`,
      "200|estimated|-");
    const oldPreEst = await rpc(ESTIMATE, oldEstimateBody(oldPre.json?.id, oldPre.json?.version));
    check("CUT-09", "PREDEPLOY: the OLD application's estimate shape re-quotes normally",
      `${oldPreEst.status}|${oldPreEst.json?.quote_status}`, "200|estimated");
    const newPre = await rpc(CREATE, newCreateBody("cut-new-predeploy"));
    check("CUT-10", "PREDEPLOY: the NEW application shape resolves to the STRICT arity in the same window — no PGRST203 either way",
      `${newPre.status}|${newPre.json?.quote_status}|${newPre.json?.restricted_class}`,
      "200|estimated|none");
    const newPreEst = await rpc(ESTIMATE, newEstimateBody(newPre.json?.id, newPre.json?.version));
    check("CUT-11", "... and the NEW estimate shape too",
      `${newPreEst.status}|${newPreEst.json?.quote_status}`, "200|estimated");
    check("CUT-12", "predeploy: the old-shape quote carries NO declaration (production behavior), the new-shape quote carries 'none'",
      one(`select string_agg(coalesce(restricted_class,'-'),',' order by created_at)
            from public.couranr_delivery_requests
            where idempotency_key in ('cut-old-predeploy','cut-new-predeploy')`),
      "-,none");

    /* ═══ Fence re-applied: the window closes ═══ */
    console.log("\n  re-applying the fence → POSTDEPLOY again...\n");
    await flip(FENCE, pgrstRef);
    const oldRefenced = await rpc(CREATE, oldCreateBody("cut-old-refenced"));
    check("CUT-13", "after the fence the OLD shape can no longer mint a commercial quote — PGRST202, not PGRST203",
      `${oldRefenced.status}|${oldRefenced.json?.code}`, "404|PGRST202");
    const newRefenced = await rpc(CREATE, newCreateBody("cut-new-refenced"));
    check("CUT-14", "... while the NEW shape stays green",
      `${newRefenced.status}|${newRefenced.json?.quote_status}`, "200|estimated");
    check("CUT-15", "arities back to strict-only",
      `${arities(CREATE)}/${arities(ESTIMATE)}`, "37/39");

    console.log(`\n  Deploy cutover: ${pass} passed, ${fail} failed`);
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
