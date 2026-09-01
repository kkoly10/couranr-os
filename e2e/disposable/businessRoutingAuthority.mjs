#!/usr/bin/env node
/** Execution verification for Fast Track Launch Batch 1 routing authority. */
import { execFileSync } from "node:child_process";
import { up, down, psql } from "./up.mjs";

const dockerContainer = process.env.COURANR_ROUTING_DOCKER_CONTAINER || "";
const KEEP = process.argv.includes("--keep");
let passed = 0;
let failed = 0;
const USER = "91000000-0000-4000-8000-000000000001";
const BUSINESS = "92000000-0000-4000-8000-000000000001";

const raw = (sql) => dockerContainer
  ? execFileSync(
      "docker",
      ["exec", "-i", dockerContainer, "psql", "-qAt", "-v", "ON_ERROR_STOP=1",
        "-U", "postgres", "-d", "couranr"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    )
  : psql(sql);
const service = (sql) => raw(`set role service_role;\n${sql}`);
const one = (sql) => service(sql).trim();

function check(id, description, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}` +
    (ok ? "" : ` [expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}]`));
}

const address = (placeId, line1) =>
  `jsonb_build_object(
    'googlePlaceId','${placeId}','formattedAddress','${line1}, Stafford, VA 22554, USA',
    'line1','${line1}','line2',null,'city','Stafford','region','VA',
    'postalCode','22554','countryCode','US','latitude',38.422,'longitude',-77.408,
    'addressSource','google_places_new','instructions',null)`;
const items = (amount) =>
  `jsonb_build_array(jsonb_build_object('code','base','label','Base','quantity',1,
    'unitAmountCents',${amount},'amountCents',${amount}))`;

function createAvailable(key, dropPlace = "place-drop-a", meters = 8047, amount = 3000) {
  return one(`select id from public.couranr_create_routed_delivery_request_draft(
    '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','recipient@example.test',10,0,'standard',false,'photo_or_pin',
    ${address("place-pickup", "10 Market St")},${address(dropPlace, "20 Main St")},false,
    ${meters},600,'google_routes_v2','available_for_request',null,
    'estimated','routing-test-v1',${amount},3,2,${items(amount)},'[]'::jsonb)`);
}

function main() {
  if (!dockerContainer) up({ quiet: true });
  try {
    raw(`
      insert into auth.users(id,email) values ('${USER}','routing@example.test');
      insert into public.business_accounts(id,name,slug,created_by)
        values ('${BUSINESS}','Routing Fixture','routing-fixture','${USER}');
      insert into public.business_members(business_account_id,user_id,role,status)
        values ('${BUSINESS}','${USER}','owner','active');
    `);

    console.log("\n  Business routing authority — database execution\n");
    check("BRA-DB-01", "pre-routing create RPC no longer executes as service_role",
      raw(`select has_function_privilege('service_role',
        'public.couranr_create_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb)',
        'EXECUTE')`).trim(), "f");

    const request = createAvailable("route-create");
    check("BRA-DB-02", "request mileage is derived from exact route meters",
      one(`select loaded_miles from public.couranr_delivery_requests where id='${request}'`), "5.000");
    check("BRA-DB-03", "immutable quote persists Places IDs and route evidence",
      one(`select (pickup_address_snapshot->>'googlePlaceId')||'|'||
                  (dropoff_address_snapshot->>'googlePlaceId')||'|'||
                  route_distance_meters||'|'||loaded_distance_miles||'|'||
                  route_duration_seconds||'|'||distance_source||'|'||serviceability_outcome
             from public.couranr_quote_versions where request_id='${request}'`),
      "place-pickup|place-drop-a|8047|5.000|600|google_routes_v2|available_for_request");
    check("BRA-DB-04", "routed RPC has no browser loaded-mile parameter",
      one(`select coalesce(array_position(proargnames,'p_loaded_miles'),0)
             from pg_proc where oid='public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)'::regprocedure`),
      "0");

    const version = one(`select version from public.couranr_delivery_requests where id='${request}'`);
    service(`select id from public.couranr_calculate_routed_delivery_request_estimate(
      '${request}','${BUSINESS}',${version},'${USER}',true,
      'merchant_portal','not_confirmed','merchant','Recipient','555-0100','recipient@example.test',
      10,0,'standard',false,'photo_or_pin',
      ${address("place-pickup", "10 Market St")},${address("place-drop-b", "90 Changed St")},false,
      16093,900,'google_routes_v2','available_for_request',null,
      'estimated','routing-test-v1',4500,3,7,${items(4500)},'[]'::jsonb)`);
    check("BRA-DB-05", "address change appends Quote 2 and preserves Quote 1",
      one(`select string_agg(quote_number||':'||(dropoff_address_snapshot->>'googlePlaceId')||':'||
              route_distance_meters,',' order by quote_number)
             from public.couranr_quote_versions where request_id='${request}'`),
      "1:place-drop-a:8047,2:place-drop-b:16093");

    const review = one(`select id from public.couranr_create_routed_delivery_request_draft(
      '${BUSINESS}','${USER}','route-review','merchant_portal','not_confirmed','merchant',
      'Recipient','555-0100','recipient@example.test',10,0,'standard',false,'photo_or_pin',
      ${address("place-pickup", "10 Market St")},${address("place-review", "30 Review St")},false,
      null,null,'google_routes_v2','needs_review','google_routes_unavailable',
      'manual_review_required',null,null,3,0,'[]'::jsonb,'["route_needs_review"]'::jsonb)`);
    check("BRA-DB-06", "Google failure persists needs_review with no distance or amount",
      one(`select serviceability_outcome||'|'||(route_distance_meters is null)||'|'||
                  (loaded_distance_miles is null)||'|'||(subtotal_cents is null)
             from public.couranr_quote_versions where request_id='${review}'`),
      "needs_review|true|true|true");

    const marketReview = one(`select id from public.couranr_create_routed_delivery_request_draft(
      '${BUSINESS}','${USER}','market-review','merchant_portal','not_confirmed','merchant',
      'Recipient','555-0100','recipient@example.test',10,0,'standard',false,'photo_or_pin',
      ${address("place-pickup", "10 Market St")},${address("place-surrounding", "100 King St")},false,
      8047,600,'google_routes_v2','needs_review','market_needs_review',
      'manual_review_required',null,null,3,0,'[]'::jsonb,'["route_needs_review"]'::jsonb)`);
    check("BRA-DB-07", "successful out-of-market route remains needs_review with evidence",
      one(`select serviceability_outcome||'|'||route_distance_meters||'|'||
                  loaded_distance_miles||'|'||(subtotal_cents is null)
             from public.couranr_quote_versions where request_id='${marketReview}'`),
      "needs_review|8047|5.000|true");
    check("BRA-DB-08", "anon/authenticated cannot execute routed commands",
      raw(`select has_function_privilege('anon',
          'public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)',
          'EXECUTE')||','||has_function_privilege('authenticated',
          'public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)',
          'EXECUTE')`).trim(), "false,false");
    check("BRA-DB-09", "Foundation integrity remains clean",
      one("select count(*) from public.couranr_foundation_integrity()"), "0");

    console.log(`\n  Business routing authority: ${passed} passed, ${failed} failed\n`);
    if (failed) process.exitCode = 1;
  } finally {
    if (!KEEP && !dockerContainer) down({ quiet: true });
  }
}

main();
