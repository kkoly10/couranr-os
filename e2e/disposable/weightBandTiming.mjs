/**
 * SUR-001 weight band + TMZ-001 requested timing — DATABASE EXECUTION.
 *
 * Everything here is invisible to a text scan and fatal at runtime: the new
 * CHECKs, the two-sided America/New_York re-derivation, the old-arity
 * deploy-gap resolution, the truthful quote snapshot, and the rollback's
 * evidence guard. So every one of them is CALLED against a real disposable
 * PostgreSQL with real rows.
 */
import { up, psql } from "./up.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const raw = (q) => psql(q);
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _p(code text, msg text);
     do $probe$ begin ${stmt} insert into _p values ('NO_ERROR','');
     exception when others then insert into _p values (SQLSTATE, SQLERRM); end $probe$;
     select code || '|' || msg from _p;`
  ).trim();
}

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const POLICY = "couranr-pricing-v2-2026-09-01";

const addr = (pid, line1) =>
  `jsonb_build_object('googlePlaceId','${pid}','formattedAddress','${line1}, Stafford, VA 22554, USA',
   'line1','${line1}','line2',null,'city','Stafford','region','VA','postalCode','22554',
   'countryCode','US','latitude',38.422,'longitude',-77.408,'addressSource','google_places_new','instructions',null)`;
const items = (a) =>
  `jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base','quantity',1,
   'unitAmountCents',${a},'amountCents',${a}))`;

/**
 * 36-argument routed create call. `weight` / `band` / timing args are the
 * suite's variables; everything else is the boring fixture.
 */
function draft36(key, { weight = "null", band = "null", intent = "null", local = "null", departure = "null", reasons = "'[]'::jsonb", status = "'estimated'", policy = `'${POLICY}'`, amount = 799, itemsJson = null } = {}) {
  const li = itemsJson ?? (status === "'estimated'" ? items(amount) : "'[]'::jsonb");
  const amt = status === "'estimated'" ? amount : "null";
  const pol = status === "'estimated'" ? policy : "null";
  const inc = status === "'estimated'" ? 2 : "null";
  const rr = status === "'estimated'" ? "'[]'::jsonb" : `'["weight_unresolved"]'::jsonb`;
  return `select id from public.couranr_create_routed_delivery_request_draft(
    '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','r@example.test',${weight},0,'standard',false,'photo_or_pin',
    ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
    3219,900,600,300,'google_routes_v2','available_for_request',null,
    ${status},${pol},${amt},${inc},0,${li},${rr},
    ${band},${intent},${local},${departure},${reasons})`;
}

/** The OLD 31-argument positional call, exactly as the deployed app makes it. */
function draft31(key) {
  return `select id from public.couranr_create_routed_delivery_request_draft(
    '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','r@example.test',12.5,0,'standard',false,'photo_or_pin',
    ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
    3219,900,600,300,'google_routes_v2','available_for_request',null,
    'estimated','${POLICY}',799,2,0,${items(799)},'[]'::jsonb)`;
}

const MIG = "supabase/migrations/20260902200000_couranr_weight_band_and_requested_timing.sql";
const RB = "supabase/rollbacks/20260902200000_couranr_weight_band_and_requested_timing.rollback.sql";
const applyScript = (file) => {
  try {
    raw(readFileSync(file, "utf8").replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, ""));
    return "NO_ERROR|";
  } catch (e) {
    return `ERROR|${String(e.message).split("\n").find((l) => /ERROR:/.test(l)) ?? "unknown"}`;
  }
};

async function main() {
  up({ quiet: true });
  try {
    raw(`insert into auth.users(id,email) values ('${USER}','wbt@example.test');
         insert into public.business_accounts(id,name,slug,created_by)
           values ('${BUSINESS}','WBT Fixture','wbt-fixture','${USER}');
         insert into public.business_members(business_account_id,user_id,role,status)
           values ('${BUSINESS}','${USER}','owner','active');`);

    console.log("\n  Weight band + requested timing — database execution\n");

    /* ---- 0. rollback/replay on the EVIDENCE-FREE database first --------- */
    check("WBT-01", "the rollback applies cleanly before any evidence exists",
      applyScript(RB), "NO_ERROR|");
    check("WBT-02", "... and the columns are gone",
      one(`select count(*) from information_schema.columns
            where table_name='couranr_delivery_requests' and column_name in
            ('weight_band','timing_intent','requested_departure_at')`), "0");
    check("WBT-03", "... and the routed create is back to its 31-argument arity",
      one(`select max(pronargs) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='couranr_create_routed_delivery_request_draft'`), "31");
    check("WBT-04", "the forward migration replays over its own rollback",
      applyScript(MIG), "NO_ERROR|");
    check("WBT-05", "... and is re-runnable over itself (second run, recovery path)",
      applyScript(MIG), "NO_ERROR|");
    check("WBT-06", "... with exactly ONE arity of each routed command",
      one(`select string_agg(distinct pronargs::text,',') from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname in
            ('couranr_create_routed_delivery_request_draft')`), "36");

    /* ---- 1. deploy gap: the OLD 31-argument call still resolves --------- */
    const legacy = one(draft31("wbt-legacy"));
    check("WBT-07", "the deployed app's 31-argument call resolves against the 36-argument function",
      legacy.length, "36");
    check("WBT-08", "... and its exact weight is stored exactly, band untouched",
      one(`select weight_lb||'|'||coalesce(weight_band,'-') from public.couranr_delivery_requests where id='${legacy}'`),
      "12.50|-");
    check("WBT-09", "... and its quote snapshot says weightKnowledge=exact",
      one(`select shipment_snapshot->>'weightKnowledge' from public.couranr_quote_versions
            where request_id='${legacy}'`), "exact");

    /* ---- 2. band-only requests -------------------------------------- */
    const banded = one(draft36("wbt-band", {
      band: "'over_25_to_50_lb'", intent: "'asap'", amount: 1099,
      itemsJson: `jsonb_build_array(
        jsonb_build_object('code','base_delivery','label','Base','quantity',1,'unitAmountCents',799,'amountCents',799),
        jsonb_build_object('code','weight_band','label','Weight handling','quantity',1,'unitAmountCents',300,'amountCents',300))`,
    }));
    check("WBT-10", "a band-only request persists NULL exact weight and the governed band",
      one(`select coalesce(weight_lb::text,'-')||'|'||weight_band from public.couranr_delivery_requests where id='${banded}'`),
      "-|over_25_to_50_lb");
    check("WBT-11", "... its snapshot tells the band truth, no invented pounds",
      one(`select (shipment_snapshot->>'weightLb') is null || '|' ||
                  (shipment_snapshot->>'weightBand') || '|' ||
                  (shipment_snapshot->>'weightKnowledge')
            from public.couranr_quote_versions where request_id='${banded}'`),
      "true|over_25_to_50_lb|band");

    const unknown = one(draft36("wbt-unknown", { band: "'unknown'", intent: "'asap'", status: "'manual_review_required'" }));
    check("WBT-12", "an unknown-band request snapshots weightKnowledge=unresolved",
      one(`select shipment_snapshot->>'weightKnowledge' from public.couranr_quote_versions
            where request_id='${unknown}'`), "unresolved");

    check("WBT-13", "a request that says NOTHING about weight is refused",
      raises(draft36("wbt-nothing", { intent: "'asap'" })), "CR422|weight_or_band_required");

    check("WBT-14", "a band outside the governed vocabulary is refused by the CHECK",
      raises(`update public.couranr_delivery_requests set weight_band='about_30_lb' where id='${banded}'`)
        .split("|")[0], "23514");

    /* ---- 3. requested timing ---------------------------------------- */
    // 2026-09-03 09:30 America/New_York (EDT, UTC-4) = 13:30 UTC.
    const sched = one(draft36("wbt-sched", {
      weight: "10", intent: "'scheduled'",
      local: "'2026-09-03T09:30'", departure: "'2026-09-03T13:30:00Z'::timestamptz",
    }));
    check("WBT-15", "a scheduled request stores local words, zone and canonical instant",
      one(`select requested_pickup_local||'|'||operating_timezone||'|'||
                  to_char(requested_departure_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI')
            from public.couranr_delivery_requests where id='${sched}'`),
      "2026-09-03T09:30|America/New_York|2026-09-03T13:30");
    check("WBT-16", "... and the quote snapshot carries the requested timing evidence",
      one(`select (shipment_snapshot->'timing'->>'intent')||'|'||(shipment_snapshot->'timing'->>'operatingTimezone')
            from public.couranr_quote_versions where request_id='${sched}'`),
      "scheduled|America/New_York");

    check("WBT-17", "a canonical instant that does NOT match the local words is refused",
      raises(draft36("wbt-lie", {
        weight: "10", intent: "'scheduled'",
        local: "'2026-09-03T09:30'", departure: "'2026-09-03T09:30:00Z'::timestamptz",
      })), "CR422|requested_departure_mismatch");

    check("WBT-18", "winter local time re-derives under EST (UTC-5), not a fixed offset",
      raises(draft36("wbt-winter", {
        weight: "10", intent: "'scheduled'",
        local: "'2026-01-15T12:00'", departure: "'2026-01-15T17:00:00Z'::timestamptz",
      })), "NO_ERROR|");
    check("WBT-19", "summer local time re-derives under EDT (UTC-4) — a fixed offset fails one of these",
      raises(draft36("wbt-summer", {
        weight: "10", intent: "'scheduled'",
        local: "'2026-07-15T12:00'", departure: "'2026-07-15T16:00:00Z'::timestamptz",
      })), "NO_ERROR|");

    // The two tzdata authorities (Node Intl in the app, PostgreSQL here) must
    // agree on the spring-forward gap, or the two-sided check would refuse
    // legitimate input. Node's algorithm resolves 02:30 in the gap to the
    // post-gap instant 07:30Z (asserted in the unit suite); PostgreSQL:
    check("WBT-20", "PostgreSQL resolves the DST gap to the same instant Node does",
      one(`select to_char(('2026-03-08 02:30'::timestamp at time zone 'America/New_York')
                  at time zone 'UTC','HH24:MI')`), "07:30");

    check("WBT-21", "scheduled without a local time is refused",
      raises(draft36("wbt-nolocal", {
        weight: "10", intent: "'scheduled'", departure: "'2026-09-03T13:30:00Z'::timestamptz",
      })), "CR422|scheduled_timing_incomplete");

    check("WBT-22", "a malformed local format is refused by the CHECK",
      raises(`update public.couranr_delivery_requests
               set requested_pickup_local='tomorrow', requested_departure_at=now()
             where id='${sched}'`).split("|")[0], "23514");

    check("WBT-23", "an operating timezone other than America/New_York cannot be stored",
      raises(`update public.couranr_delivery_requests set operating_timezone='America/Chicago'
             where id='${sched}'`).split("|")[0], "23514");

    /* ---- 4. estimate keeps the band through a re-quote ------------------ */
    const ver = one(`select version from public.couranr_delivery_requests where id='${banded}'`);
    raw(`select public.couranr_calculate_routed_delivery_request_estimate(
      '${banded}','${BUSINESS}',${ver},'${USER}',false,
      'merchant_portal','not_confirmed','merchant','Recipient','555-0100','r@example.test',
      null,0,'standard',false,'photo_or_pin',
      ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
      3219,900,600,300,'google_routes_v2','available_for_request',null,
      'estimated','${POLICY}',1099,2,0,
      jsonb_build_array(
        jsonb_build_object('code','base_delivery','label','Base','quantity',1,'unitAmountCents',799,'amountCents',799),
        jsonb_build_object('code','weight_band','label','Weight handling','quantity',1,'unitAmountCents',300,'amountCents',300)),
      '[]'::jsonb,
      null,null,null,null,null)`);
    check("WBT-24", "a no-shipment-update estimate PRESERVES the stored band",
      one(`select coalesce(weight_lb::text,'-')||'|'||weight_band from public.couranr_delivery_requests where id='${banded}'`),
      "-|over_25_to_50_lb");
    check("WBT-25", "... and Quote N+1's snapshot still tells the band truth",
      one(`select shipment_snapshot->>'weightKnowledge' from public.couranr_quote_versions
            where request_id='${banded}' order by quote_number desc limit 1`), "band");

    /* ---- 5. rollback hard-refuses once evidence exists ------------------ */
    const attempted = applyScript(RB);
    check("WBT-26", "the rollback HARD-REFUSES once band/timing evidence exists",
      attempted.includes("weight_band_rollback_would_destroy_shipment_evidence"), "true");
    check("WBT-27", "... and the evidence survives the refused rollback",
      one(`select weight_band from public.couranr_delivery_requests where id='${banded}'`),
      "over_25_to_50_lb");

    /* ---- 6. privileges --------------------------------------------------- */
    check("WBT-28", "the new arity is executable by service_role and NOBODY else",
      one(`select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE'))
                || '|' ||
              bool_or(has_function_privilege('anon',p.oid,'EXECUTE')
                   or has_function_privilege('authenticated',p.oid,'EXECUTE'))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in
             ('couranr_create_routed_delivery_request_draft',
              'couranr_calculate_routed_delivery_request_estimate')`),
      "true|false");
  } finally {
    const summary = `\n  Weight band + timing: ${pass} passed, ${fail} failed\n`;
    try { raw("select 1"); } catch { /* cluster already gone */ }
    console.log(summary);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exit(1);
});
