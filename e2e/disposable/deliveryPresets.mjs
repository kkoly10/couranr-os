/**
 * ACP-025 — the preset schema, EXECUTED against a real PostgreSQL.
 *
 * The defect class this catches is the one that is invisible until a row is
 * actually written: a CHECK that does not fire, a grant that was a no-op, an
 * append-only table that turns out to be updatable.
 *
 * The assertions that could not have been reasoned out:
 *
 *   - `couranr_preset_body_is_clean` is invoked from CHECKs on four tables and
 *     is revoked from PUBLIC. B-series proves it still evaluates.
 *   - the version table is granted INSERT and SELECT only. V3 proves an UPDATE
 *     is refused by PRIVILEGE, which is what makes "append-only" true rather
 *     than merely intended.
 *   - the delivery snapshot columns move as a set. S-series proves a
 *     half-recorded provenance cannot exist.
 *
 * WHAT THIS DOES NOT PROVE: nothing here goes through PostgREST, a route or a
 * browser. Database half only.
 *
 * Run:  node e2e/disposable/deliveryPresets.mjs
 */

import crypto from "node:crypto";
import { up, down, psql } from "./up.mjs";

let pass = 0;
let fail = 0;
const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

function check(id, d, ok, det = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${det ? `  [${det}]` : ""}`);
}
function expectRaise(id, d, q, re) {
  try {
    psql(q);
    check(id, d, false, "it was ACCEPTED");
  } catch (e) {
    const s = String(e.stderr || e.message);
    check(id, d, re.test(s), s.split("\n").find((l) => l.includes("ERROR"))?.slice(0, 100) ?? "");
  }
}

try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);

  const owner = sql(`insert into auth.users (email) values ('pre-owner@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${owner}','pre-owner@couranr.invalid','customer')`);
  const biz = sql(
    `insert into public.business_accounts (name,slug,status) values ('[PRE] biz','pre-biz','active') returning id`
  );

  /* ───────────── the forbidden-key guard, on every table ───────────── */

  console.log("The body guard — the same rule the TypeScript strips by");
  check("B0", "the guard is IMMUTABLE (a CHECK requires it)",
    sql(`select provolatile from pg_proc where proname='couranr_preset_body_is_clean'`) === "i");
  check("B1", "it accepts a body of only suggestable fields",
    sql(`select public.couranr_preset_body_is_clean(
           '{"commonItem":"Roses","packageCount":2,"handling":"Upright",
             "proofMethod":"photo_or_pin","vehicleCapabilities":["tall"],
             "requiredQuestions":["Which door?"],"payerPreference":"merchant"}'::jsonb)`) === "t");
  check("B2", "and refuses each forbidden concept, however spelled",
    sql(`select bool_and(not public.couranr_preset_body_is_clean(b))
           from (values ('{"exactWeight":12}'::jsonb),('{"weight_lb":12}'::jsonb),
                        ('{"grossWeight":12}'::jsonb),('{"dimensions":"1x2"}'::jsonb),
                        ('{"lengthIn":4}'::jsonb),('{"declaredValue":100}'::jsonb),
                        ('{"finalPrice":2299}'::jsonb),('{"priceCents":2299}'::jsonb),
                        ('{"vehicleId":"x"}'::jsonb),('{"loadingHelp":true}'::jsonb),
                        ('{"isSafe":true}'::jsonb)) as t(b)`) === "t");

  const gp = sql(
    `insert into public.couranr_category_presets (business_category,name,body)
     values ('florists_gifts_specialty_retail','Bouquet delivery',
             '{"commonItem":"Bouquet","packageCount":1}'::jsonb)
     returning id`
  );
  check("B3", "a global preset inserts and starts at version 1",
    sql(`select version from public.couranr_category_presets where id='${gp}'`) === "1");

  expectRaise("B4", "a global preset carrying a price is REFUSED by the CHECK",
    `insert into public.couranr_category_presets (business_category,name,body)
     values ('florists_gifts_specialty_retail','Bad','{"finalPrice":2299}'::jsonb)`,
    /couranr_cp_body_chk/);

  /* ─────────────────── hierarchy: levels 2 and 3 ──────────────────── */

  console.log("\nHierarchy — customized vs merchant-created");
  const customized = sql(
    `insert into public.couranr_merchant_presets
       (business_account_id,name,body,source_category_preset_id,source_version,created_by)
     values ('${biz}','Our bouquets','{"commonItem":"Bouquet","handling":"Upright"}'::jsonb,
             '${gp}',1,'${owner}') returning id`
  );
  const created = sql(
    `insert into public.couranr_merchant_presets
       (business_account_id,name,body,created_by)
     values ('${biz}','Wedding arch','{"commonItem":"Arch","packageCount":3}'::jsonb,'${owner}')
     returning id`
  );
  check("H1", "a CUSTOMIZED preset names its source and the version it came from",
    sql(`select (source_category_preset_id='${gp}')::text||','||source_version::text
           from public.couranr_merchant_presets where id='${customized}'`) === "true,1");
  check("H2", "a merchant-CREATED preset claims no source at all",
    sql(`select coalesce(source_category_preset_id::text,'NULL')||','||coalesce(source_version::text,'NULL')
           from public.couranr_merchant_presets where id='${created}'`) === "NULL,NULL");

  expectRaise("H3", "a source id with no version is refused — 'has the global moved on?' must have an answer",
    `insert into public.couranr_merchant_presets (business_account_id,name,body,source_category_preset_id,created_by)
     values ('${biz}','Half','{}'::jsonb,'${gp}','${owner}')`,
    /couranr_mp_source_pair_chk/);
  expectRaise("H4", "and a version with no source is refused",
    `insert into public.couranr_merchant_presets (business_account_id,name,source_version,body,created_by)
     values ('${biz}','Half2',1,'{}'::jsonb,'${owner}')`,
    /couranr_mp_source_pair_chk/);
  expectRaise("H5", "two live presets cannot share a name",
    `insert into public.couranr_merchant_presets (business_account_id,name,body,created_by)
     values ('${biz}','  our BOUQUETS ','{}'::jsonb,'${owner}')`,
    /couranr_mp_name_uniq/);

  /* ────────── the rule: a global update never overwrites ─────────── */

  console.log("\nGLOBAL UPDATES NEVER OVERWRITE MERCHANT CUSTOMIZATION");
  sql(
    `update public.couranr_category_presets
        set body='{"commonItem":"Bouquet","packageCount":2,"handling":"Keep cool"}'::jsonb,
            version=version+1, updated_at=now()
      where id='${gp}'`
  );
  check("G1", "the global preset advanced to version 2",
    sql(`select version from public.couranr_category_presets where id='${gp}'`) === "2");
  check("G2", "the merchant's customization is UNTOUCHED — body and version both",
    sql(`select body->>'handling' || ',' || version::text || ',' || source_version::text
           from public.couranr_merchant_presets where id='${customized}'`) === "Upright,1,1");
  check("G3", "so 'update suggested' is DERIVABLE: global 2 > source 1",
    sql(`select (cp.version > mp.source_version)::text
           from public.couranr_merchant_presets mp
           join public.couranr_category_presets cp on cp.id = mp.source_category_preset_id
          where mp.id='${customized}'`) === "true");

  /* ──────────────────── versions are append-only ─────────────────── */

  console.log("\nVersions — append-only by PRIVILEGE, not by convention");
  sql(
    `insert into public.couranr_merchant_preset_versions (merchant_preset_id,version,name,body,changed_by)
     values ('${customized}',1,'Our bouquets','{"commonItem":"Bouquet","handling":"Upright"}'::jsonb,'${owner}')`
  );
  check("V1", "a version row is recorded",
    sql(`select count(*) from public.couranr_merchant_preset_versions
          where merchant_preset_id='${customized}'`) === "1");
  expectRaise("V2", "the same version cannot be recorded twice",
    `insert into public.couranr_merchant_preset_versions (merchant_preset_id,version,name,body,changed_by)
     values ('${customized}',1,'Dup','{}'::jsonb,'${owner}')`,
    /couranr_mpv_uniq/);

  const vGrants = sql(
    `select has_table_privilege('service_role','public.couranr_merchant_preset_versions','UPDATE')||','||
            has_table_privilege('service_role','public.couranr_merchant_preset_versions','DELETE')||','||
            has_table_privilege('service_role','public.couranr_merchant_preset_versions','INSERT')`
  );
  check("V3", "service_role may INSERT but NOT update or delete a version",
    vGrants === "false,false,true", vGrants);

  const browserGrants = sql(
    `select has_table_privilege('anon','public.couranr_merchant_presets','SELECT')||','||
            has_table_privilege('authenticated','public.couranr_merchant_presets','SELECT')||','||
            has_table_privilege('anon','public.couranr_category_presets','INSERT')||','||
            has_function_privilege('authenticated','public.couranr_preset_body_is_clean(jsonb)','EXECUTE')`
  );
  check("V4", "no browser role reaches any preset table or the guard",
    browserGrants === "false,false,false,false", browserGrants);

  /* ─────────────── the delivery's immutable snapshot ─────────────── */

  console.log("\nThe delivery snapshot — all four columns or none");
  const req = sql(
    `insert into public.couranr_delivery_requests
       (business_account_id,created_by,idempotency_key,recipient_name,request_state,
        readiness_state,review_state,quote_status,pickup_address,dropoff_address,
        preset_id,preset_version,preset_snapshot,preset_source)
     values ('${biz}','${owner}','pre-${crypto.randomUUID()}','[PRE] r','draft',
             'not_confirmed','not_required','not_quoted','{}'::jsonb,'{}'::jsonb,
             '${customized}',1,'{"commonItem":"Bouquet","handling":"Upright"}'::jsonb,'merchant')
     returning id`
  );
  check("S1", "a request records preset id, version, snapshot and source",
    sql(`select preset_version::text||','||preset_source||','||(preset_snapshot->>'handling')
           from public.couranr_delivery_requests where id='${req}'`) === "1,merchant,Upright");

  expectRaise("S2", "an id with no snapshot is refused — half a provenance reads as whole",
    `update public.couranr_delivery_requests set preset_snapshot=null where id='${req}'`,
    /couranr_dr_preset_pair_chk/);
  expectRaise("S3", "an invented source is refused",
    `update public.couranr_delivery_requests set preset_source='somewhere' where id='${req}'`,
    /couranr_dr_preset_source_chk/);
  expectRaise("S4", "and a snapshot carrying a price is refused ON THE REQUEST too",
    `update public.couranr_delivery_requests set preset_snapshot='{"finalPrice":2299}'::jsonb where id='${req}'`,
    /couranr_dr_preset_body_chk/);

  // THE POINT OF A SNAPSHOT. Change the preset; the delivery must not move.
  sql(
    `update public.couranr_merchant_presets
        set body='{"commonItem":"Bouquet","handling":"Lay flat"}'::jsonb, version=2
      where id='${customized}'`
  );
  check("S5", "changing the preset does NOT change what the delivery recorded",
    sql(`select (preset_snapshot->>'handling')||','||preset_version::text
           from public.couranr_delivery_requests where id='${req}'`) === "Upright,1");
  check("S6", "while the preset itself has moved on",
    sql(`select (body->>'handling')||','||version::text
           from public.couranr_merchant_presets where id='${customized}'`) === "Lay flat,2");

  check("S7", "a request with NO preset is still legal — presets are optional",
    sql(`insert into public.couranr_delivery_requests
           (business_account_id,created_by,idempotency_key,recipient_name,request_state,
            readiness_state,review_state,quote_status,pickup_address,dropoff_address)
         values ('${biz}','${owner}','pre-${crypto.randomUUID()}','[PRE] none','draft',
                 'not_confirmed','not_required','not_quoted','{}'::jsonb,'{}'::jsonb)
         returning (preset_id is null)::text`) === "true");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
} finally {
  down({ quiet: true });
}
