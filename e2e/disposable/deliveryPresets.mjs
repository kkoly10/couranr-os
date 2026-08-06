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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { up, down, psql, dbUrl } from "./up.mjs";

const execFileAsync = promisify(execFile);

/**
 * Run a statement in its OWN process, so two can genuinely overlap.
 *
 * `psql()` is synchronous, so it cannot express a race. The concurrent-save
 * test below needs two transactions alive at the same time — which is the only
 * way to tell a `for update` lock apart from a version check that happens to
 * pass twice.
 */
async function psqlAsync(statement) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/lib/postgresql/16/bin/psql",
      [dbUrl(), "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { timeout: 30_000 }
    );
    return { ok: true, out: String(stdout).trim() };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
}

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

  /* ══════════════ the NAMED COMMANDS, every one CALLED ══════════════ */

  const mgr = sql(`insert into auth.users (email) values ('pre-mgr@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${mgr}','pre-mgr@couranr.invalid','customer')`);
  const disp = sql(`insert into auth.users (email) values ('pre-disp@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${disp}','pre-disp@couranr.invalid','customer')`);
  for (const [u, r] of [[owner, "owner"], [mgr, "manager"], [disp, "dispatcher"]]) {
    sql(`insert into public.business_members (business_account_id,user_id,role,status,joined_at)
         values ('${biz}','${u}','${r}','active',now())`);
  }

  console.log("\nCommands — create, and the baseline it must not take from the caller");
  const made = sql(
    `select (public.couranr_create_merchant_preset('${biz}','${owner}','From Couranr',
       '{"commonItem":"Bouquet"}'::jsonb,'${gp}')).id`
  );
  check("C1", "create records the global's CURRENT version as the baseline, not a caller's claim",
    sql(`select source_version from public.couranr_merchant_presets where id='${made}'`) === "2");
  check("C2", "and version 1 is in the history — a preset with a hole at v1 breaks day-one deliveries",
    sql(`select count(*) from public.couranr_merchant_preset_versions
          where merchant_preset_id='${made}' and version=1`) === "1");

  expectRaise("C3", "a dispatcher may not manage presets",
    `select public.couranr_create_merchant_preset('${biz}','${disp}','Nope','{}'::jsonb,null)`,
    /CR403|role_may_not_manage_presets/);
  expectRaise("C4", "an empty name is refused",
    `select public.couranr_create_merchant_preset('${biz}','${owner}','  ','{}'::jsonb,null)`,
    /CR400|preset_name_required/);
  expectRaise("C5", "an unknown source preset is refused",
    `select public.couranr_create_merchant_preset('${biz}','${owner}','X','{}'::jsonb,
       '00000000-0000-4000-8000-000000000000')`,
    /CR404|source_preset_not_found/);

  console.log("\nUpdate — optimistic concurrency, MER-011's version conflict");
  sql(`select public.couranr_update_merchant_preset('${biz}','${mgr}','${made}','From Couranr',
        '{"commonItem":"Bouquet","handling":"Upright"}'::jsonb,1)`);
  check("U1", "a manager may save, and the version advances",
    sql(`select version from public.couranr_merchant_presets where id='${made}'`) === "2");
  check("U2", "the new version is appended to the history",
    sql(`select count(*) from public.couranr_merchant_preset_versions
          where merchant_preset_id='${made}'`) === "2");
  expectRaise("U3", "a STALE expected version is refused — a colleague's save is not overwritten",
    `select public.couranr_update_merchant_preset('${biz}','${owner}','${made}','X','{}'::jsonb,1)`,
    /CR409|preset_version_conflict/);
  expectRaise("U4", "and a null expected version is refused rather than treated as 'any'",
    `select public.couranr_update_merchant_preset('${biz}','${owner}','${made}','X','{}'::jsonb,null)`,
    /CR409|preset_version_conflict/);
  expectRaise("U5", "a forbidden field is refused by the CHECK even through the command",
    `select public.couranr_update_merchant_preset('${biz}','${owner}','${made}','X',
       '{"finalPrice":2299}'::jsonb,2)`,
    /couranr_mp_body_chk/);

  console.log("\nAdopt — the ONLY path a global update reaches a merchant preset");
  check("A1", "before adopting, the merchant still holds their own body",
    sql(`select (body->>'handling')||','||source_version::text
           from public.couranr_merchant_presets where id='${made}'`) === "Upright,2");
  sql(`update public.couranr_category_presets
          set body='{"commonItem":"Bouquet","handling":"Keep cool","packageCount":2}'::jsonb,
              version=version+1 where id='${gp}'`);
  check("A2", "a global bump does NOT touch the merchant row",
    sql(`select (body->>'handling')||','||version::text||','||source_version::text
           from public.couranr_merchant_presets where id='${made}'`) === "Upright,2,2");
  sql(`select public.couranr_adopt_preset_recommendation('${biz}','${owner}','${made}',2)`);
  check("A3", "adopting takes the global body and re-baselines the source version",
    sql(`select (body->>'handling')||','||source_version::text||','||version::text
           from public.couranr_merchant_presets where id='${made}'`) === "Keep cool,3,3");
  check("A4", "and the merchant's OWN previous body is still in the history",
    sql(`select body->>'handling' from public.couranr_merchant_preset_versions
          where merchant_preset_id='${made}' and version=2`) === "Upright");
  expectRaise("A5", "adopting when there is nothing to adopt is a CONFLICT, not a silent success",
    `select public.couranr_adopt_preset_recommendation('${biz}','${owner}','${made}',3)`,
    /CR409|no_recommendation_to_adopt/);
  const ownMade = sql(
    `select (public.couranr_create_merchant_preset('${biz}','${owner}','Ours only','{}'::jsonb,null)).id`
  );
  expectRaise("A6", "a merchant-created preset has nothing to adopt FROM",
    `select public.couranr_adopt_preset_recommendation('${biz}','${owner}','${ownMade}',1)`,
    /CR409|preset_has_no_couranr_source/);

  console.log("\nDuplicate and archive");
  const copy = sql(
    `select (public.couranr_duplicate_merchant_preset('${biz}','${owner}','${made}','From Couranr copy')).id`
  );
  check("D1", "a copy of a CUSTOMIZED preset is merchant-created — one baseline, one preset",
    sql(`select coalesce(source_category_preset_id::text,'NULL')||','||coalesce(source_version::text,'NULL')
           from public.couranr_merchant_presets where id='${copy}'`) === "NULL,NULL");
  check("D2", "the copy carries the body and starts its own history at 1",
    sql(`select (body->>'handling')||','||version::text from public.couranr_merchant_presets
          where id='${copy}'`) === "Keep cool,1");

  sql(`select public.couranr_set_merchant_preset_archived('${biz}','${owner}','${copy}',true)`);
  check("D3", "archiving stamps the row rather than deleting it",
    sql(`select (archived_at is not null)::text from public.couranr_merchant_presets
          where id='${copy}'`) === "true");
  check("D4", "and the archived name is free again",
    sql(`select (public.couranr_create_merchant_preset('${biz}','${owner}','From Couranr copy',
           '{}'::jsonb,null)).id`) !== "");
  expectRaise("D5", "an archived preset cannot be edited",
    `select public.couranr_update_merchant_preset('${biz}','${owner}','${copy}','X','{}'::jsonb,1)`,
    /CR409|preset_is_archived/);

  console.log("\nTHE LOCK — two saves at the same version, at the same moment");
  {
    /*
     * The check alone is not enough and this is the only test that can show
     * it. Without `for update`, both transactions read version N, both find
     * their expected version matching, and both write N+1 — the check passes
     * TWICE and the second save silently destroys the first. With the lock the
     * second blocks, re-reads under READ COMMITTED, sees N+1 and is refused.
     */
    const raceTarget = sql(
      `select (public.couranr_create_merchant_preset('${biz}','${owner}','Race target','{}'::jsonb,null)).id`
    );
    const before = sql(`select version from public.couranr_merchant_presets where id='${raceTarget}'`);

    const [a, b] = await Promise.all([
      psqlAsync(`select public.couranr_update_merchant_preset('${biz}','${owner}','${raceTarget}',
                   'Race A','{"commonItem":"A"}'::jsonb,${before})`),
      psqlAsync(`select public.couranr_update_merchant_preset('${biz}','${mgr}','${raceTarget}',
                   'Race B','{"commonItem":"B"}'::jsonb,${before})`),
    ]);

    const winners = [a, b].filter((r) => r.ok).length;
    check("L1", "EXACTLY ONE of two concurrent saves succeeds",
      winners === 1, `${winners} succeeded`);
    check("L2", "and the loser is refused with a version conflict, not a crash",
      [a, b].some((r) => !r.ok && /preset_version_conflict/.test(r.err)),
      [a, b].find((r) => !r.ok)?.err?.split("\n").find((l) => l.includes("ERROR"))?.slice(0, 80) ?? "");
    check("L3", "the version advanced by exactly one, not two",
      sql(`select version from public.couranr_merchant_presets where id='${raceTarget}'`) ===
        String(Number(before) + 1));
    check("L4", "and the history holds one row per version — no lost write",
      sql(`select count(*) from public.couranr_merchant_preset_versions
            where merchant_preset_id='${raceTarget}'`) === String(Number(before) + 1));
  }

  console.log("\nCross-tenant");
  const biz2 = sql(
    `insert into public.business_accounts (name,slug,status) values ('[PRE] other','pre-other','active') returning id`
  );
  sql(`insert into public.business_members (business_account_id,user_id,role,status,joined_at)
       values ('${biz2}','${owner}','owner','active',now())`);
  expectRaise("X1", "an owner of another business cannot edit this one's preset",
    `select public.couranr_update_merchant_preset('${biz2}','${owner}','${made}','X','{}'::jsonb,3)`,
    /CR404|preset_not_found/);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
} finally {
  down({ quiet: true });
}
