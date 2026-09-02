/**
 * Couranr Pricing Authority V2 — DATABASE EXECUTION.
 *
 * The engine tests prove the arithmetic. These prove the things that only
 * exist at execution time and that a text scan cannot see: a CHECK that
 * re-derives the traffic delay, a command that refuses the superseded policy
 * version, a rollback that refuses to destroy commercial evidence, and the
 * fact that applying this migration does not touch one historical amount.
 */
import { up, down, psql } from "./up.mjs";
import { readFileSync } from "node:fs";

const KEEP = process.argv.includes("--keep");
let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const raw = (q) => psql(q);
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};
/** Runs SQL expecting a raise, and returns SQLSTATE|message. */
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
const addr = (pid, line1) =>
  `jsonb_build_object('googlePlaceId','${pid}','formattedAddress','${line1}, Stafford, VA 22554, USA',
   'line1','${line1}','line2',null,'city','Stafford','region','VA','postalCode','22554',
   'countryCode','US','latitude',38.422,'longitude',-77.408,'addressSource','google_places_new','instructions',null)`;
const items = (a) =>
  `jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base','quantity',1,
   'unitAmountCents',${a},'amountCents',${a}))`;

/** One draft through the canonical routed command. */
function draft(key, { duration = 600, staticDuration = 600, delay = 0, policy = "couranr-pricing-v2-2026-09-01", amount = 799 } = {}) {
  return `select id from public.couranr_create_routed_delivery_request_draft(
    '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','r@example.test',10,0,'standard',false,'photo_or_pin',
    ${addr("place-pickup","10 Market St")},${addr("place-drop","20 Main St")},false,
    3219,${duration},${staticDuration},${delay},'google_routes_v2','available_for_request',null,
    'estimated','${policy}',${amount},2,0,${items(amount)},'[]'::jsonb)`;
}

function main() {
  up({ quiet: true });
  try {
    raw(`insert into auth.users(id,email) values ('${USER}','pricing@example.test');
         insert into public.business_accounts(id,name,slug,created_by)
           values ('${BUSINESS}','Pricing Fixture','pricing-fixture','${USER}');
         insert into public.business_members(business_account_id,user_id,role,status)
           values ('${BUSINESS}','${USER}','owner','active');`);

    console.log("\n  Pricing V2 authority — database execution\n");

    /* ---------------------------------------------- traffic evidence ---- */

    const okId = one(draft("v2-ok", { duration: 900, staticDuration: 600, delay: 300 }));
    check("PV2-01", "a correctly derived delay is accepted", /^[0-9a-f-]{36}$/.test(okId), true);
    check("PV2-02", "both durations and the delay are persisted on the immutable quote",
      one(`select route_duration_seconds||'|'||route_static_duration_seconds||'|'||route_traffic_delay_seconds
             from public.couranr_quote_versions where request_id='${okId}'`), "900|600|300");

    check("PV2-03", "a FLATTERING delay is refused, not stored",
      raises(draft("v2-lie", { duration: 900, staticDuration: 600, delay: 0 })),
      "CR422|traffic_delay_must_equal_route_evidence");

    check("PV2-04", "an INFLATED delay is refused too",
      raises(draft("v2-inflate", { duration: 900, staticDuration: 600, delay: 9999 })),
      "CR422|traffic_delay_must_equal_route_evidence");

    check("PV2-05", "a missing baseline duration is refused rather than read as zero delay",
      raises(draft("v2-nobase", { duration: 900, staticDuration: "null", delay: 300 })),
      "CR422|complete_traffic_evidence_required");

    check("PV2-06", "a negative delay is refused",
      raises(draft("v2-neg", { duration: 600, staticDuration: 900, delay: -300 })),
      "CR422|complete_traffic_evidence_required");

    /* ------------------------------------------------ policy cutover ---- */

    check("PV2-07", "the superseded policy version cannot be MINTED",
      raises(draft("v2-old-policy", { policy: "couranr-pricing-2026-07-31" })),
      "CR422|superseded_pricing_policy_cannot_be_minted");

    /* ------------------------------- historical quotes are untouched ---- */

    // A historical row, written directly as the pre-V2 world would have left
    // it: old policy version, old amount, and NO traffic columns.
    raw(`insert into public.couranr_delivery_requests
           (id,business_account_id,created_by,idempotency_key,recipient_name,quote_status)
         values ('33333333-3333-4333-8333-333333333333','${BUSINESS}','${USER}','hist-1','Historical','not_quoted');
         insert into public.couranr_quote_versions
           (request_id,quote_number,request_version_at_creation,quote_status,
            pricing_policy_version,payer_type,currency,subtotal_cents,
            quote_line_items,provenance_state,record_origin)
         values ('33333333-3333-4333-8333-333333333333',1,1,'estimated',
                 'couranr-pricing-2026-07-31','merchant','usd',2299,
                 jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base delivery (first 3 loaded miles)',
                   'quantity',1,'unitAmountCents',2299,'amountCents',2299)),
                 'verified','legacy_backfill');`);

    check("PV2-08", "a historical quote keeps its own amount and policy version",
      one(`select subtotal_cents||'|'||pricing_policy_version from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`),
      "2299|couranr-pricing-2026-07-31");

    check("PV2-09", "a historical quote's stored line items are readable verbatim",
      one(`select quote_line_items->0->>'label' from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`),
      "Base delivery (first 3 loaded miles)");

    check("PV2-10", "the traffic columns are NULL on a historical row, not backfilled with a guess",
      one(`select coalesce(route_static_duration_seconds::text,'null')||'|'||
                  coalesce(route_traffic_delay_seconds::text,'null')
             from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`), "null|null");

    check("PV2-11", "V2 and historical policy versions coexist — a future V3 could too",
      one(`select count(distinct pricing_policy_version) from public.couranr_quote_versions
            where pricing_policy_version is not null`), "2");

    /* ------------------------------------------- structural guarantees -- */

    check("PV2-12", "no routed command exposes a browser mileage or duration parameter",
      one(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname in ('public','private') and p.proname like '%routed%'
              and array_to_string(p.proargnames,',') ~ '(p_loaded_miles|p_client_|p_browser_)'`), "0");

    check("PV2-13", "each routed function exists at exactly one arity — no pre-traffic overload survives",
      one(`select count(*) from (
             select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname in ('public','private') and p.proname like '%routed%'
              group by p.proname having count(*) > 1) x`), "0");

    check("PV2-14", "anon and authenticated cannot execute the routed create command",
      one(`select bool_or(has_function_privilege(r,
             'public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)',
             'EXECUTE')) from unnest(array['anon','authenticated']) r`), "f");

    check("PV2-15", "Foundation integrity remains zero",
      one(`select count(*) from public.couranr_foundation_integrity()`), "0");

    /* ------------------------------------------------------- rollback --- */

    const rollback = readFileSync(
      "supabase/rollbacks/20260902090000_couranr_pricing_v2_traffic_authority.rollback.sql", "utf8");
    const attempted = raises(rollback.replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, ""));
    check("PV2-16", "the rollback HARD-REFUSES once V2 quote evidence exists",
      attempted.split("|")[1], "pricing_v2_rollback_would_destroy_commercial_evidence");
    check("PV2-17", "... and the traffic evidence survives the refused rollback",
      one(`select route_traffic_delay_seconds from public.couranr_quote_versions where request_id='${okId}'`), "300");
    check("PV2-18", "... and the historical amount survives it too",
      one(`select subtotal_cents from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`), "2299");

    console.log(`\n  Pricing V2 authority: ${pass} passed, ${fail} failed\n`);
  } finally {
    if (!KEEP) down({ quiet: true });
  }
  process.exit(fail === 0 ? 0 : 1);
}
main();
