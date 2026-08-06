/**
 * ACP-024 — the category command, EXECUTED against a real PostgreSQL.
 *
 * A migration applying cleanly proves it parses. A text assertion on the file
 * proves what it says. Neither proves the command RUNS — and the defect class
 * that has bitten this repository is exactly the one that is invisible until
 * execution: a CHECK, a role gate, a `%TYPE` mismatch, an OUT parameter
 * colliding with a column name.
 *
 * So every path is called with a fixture that satisfies its constraints, and
 * the result is read back.
 *
 * The one that could not have been reasoned out: `couranr_text_array_is_distinct`
 * is revoked from PUBLIC, and it is invoked from a CHECK constraint on every
 * workspace write. K2 does a DIRECT update with a duplicate and asserts the
 * constraint still fires — proving the revoke did not quietly stop the check
 * from being evaluated. A CHECK that silently stopped running looks exactly
 * like a passing test.
 *
 * WHAT THIS DOES NOT PROVE: nothing here goes through PostgREST, a route or a
 * browser. It is the database half only.
 *
 * Run:  node e2e/disposable/businessCategories.mjs
 */

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";

let pass = 0, fail = 0;
const sql = (q) => psql(q).trim();
const check = (id, d, ok, det = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${det ? `  [${det}]` : ""}`); };
function expectRaise(id, d, q, codeRe) {
  try { psql(q); check(id, d, false, "it was ACCEPTED"); }
  catch (e) { const s = String(e.stderr || e.message); check(id, d, codeRe.test(s), s.split("\n").find(l => l.includes("ERROR"))?.slice(0, 110) ?? ""); }
}

try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);

  const owner = sql(`insert into auth.users (email) values ('cat-owner@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${owner}','cat-owner@couranr.invalid','customer')`);
  const mgr = sql(`insert into auth.users (email) values ('cat-mgr@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${mgr}','cat-mgr@couranr.invalid','customer')`);
  const disp = sql(`insert into auth.users (email) values ('cat-disp@couranr.invalid') returning id`);
  sql(`insert into public.profiles (id,email,role) values ('${disp}','cat-disp@couranr.invalid','customer')`);

  const biz = sql(`insert into public.business_accounts (name,slug,status) values ('[CAT] biz','cat-biz','active') returning id`);
  sql(`insert into public.couranr_merchant_workspaces
        (business_account_id,created_by,idempotency_key,business_category,pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at)
       values ('${biz}','${owner}','cat-${crypto.randomUUID()}','general_local_business',
               '{"line1":"1 A St"}'::jsonb,'540-555-0100','merchant','v1',now())`);
  for (const [u, r] of [[owner,'owner'],[mgr,'manager'],[disp,'dispatcher']])
    sql(`insert into public.business_members (business_account_id,user_id,role,status,joined_at)
         values ('${biz}','${u}','${r}','active',now())`);

  console.log("Defaults and the helper");
  check("D1", "existing rows default to an empty array and a NULL version",
    sql(`select cardinality(secondary_categories)::text || ',' || coalesce(category_registry_version,'NULL')
           from public.couranr_merchant_workspaces where business_account_id='${biz}'`) === "0,NULL");
  check("D2", "the distinctness helper is IMMUTABLE (a CHECK requires it)",
    sql(`select provolatile from pg_proc where proname='couranr_text_array_is_distinct'`) === "i");
  check("D3", "and it actually detects a duplicate",
    sql(`select public.couranr_text_array_is_distinct(array['a','b','a'])::text || ',' ||
                public.couranr_text_array_is_distinct(array['a','b'])::text`) === "false,true");

  console.log("\nGrants — the PUBLIC-inheritance trap");
  check("G1", "anon and authenticated cannot EXECUTE either function",
    sql(`select has_function_privilege('anon','public.couranr_set_business_categories(uuid,uuid,text,text[],text)','EXECUTE')||','||
                has_function_privilege('authenticated','public.couranr_set_business_categories(uuid,uuid,text,text[],text)','EXECUTE')||','||
                has_function_privilege('anon','public.couranr_text_array_is_distinct(text[])','EXECUTE')||','||
                has_function_privilege('authenticated','public.couranr_text_array_is_distinct(text[])','EXECUTE')`) === "false,false,false,false");
  check("G2", "service_role can EXECUTE both",
    sql(`select has_function_privilege('service_role','public.couranr_set_business_categories(uuid,uuid,text,text[],text)','EXECUTE')||','||
                has_function_privilege('service_role','public.couranr_text_array_is_distinct(text[])','EXECUTE')`) === "true,true");

  console.log("\nThe command, CALLED");
  const r1 = sql(`select (public.couranr_set_business_categories('${biz}','${owner}','florists_gifts_specialty_retail',
                    array['printing_signage_promotional','repair_and_electronics'],'couranr-categories-2026-08')).business_category`);
  check("C1", "an owner sets a primary and two secondaries", r1 === "florists_gifts_specialty_retail", r1);
  check("C2", "the row holds both secondaries, in order, and the version",
    sql(`select array_to_string(secondary_categories,'|')||','||coalesce(category_registry_version,'NULL')
           from public.couranr_merchant_workspaces where business_account_id='${biz}'`)
    === "printing_signage_promotional|repair_and_electronics,couranr-categories-2026-08");

  sql(`select public.couranr_set_business_categories('${biz}','${mgr}','repair_and_electronics',
        array['furniture_and_home_goods','furniture_and_home_goods','books_cards_collectibles_hobby'],null)`);
  check("C3", "a MANAGER may set them, and a duplicate is STRIPPED not refused",
    sql(`select array_to_string(secondary_categories,'|') from public.couranr_merchant_workspaces
          where business_account_id='${biz}'`) === "furniture_and_home_goods|books_cards_collectibles_hobby");
  check("C4", "a null version leaves the stored one alone rather than erasing it",
    sql(`select coalesce(category_registry_version,'NULL') from public.couranr_merchant_workspaces
          where business_account_id='${biz}'`) === "couranr-categories-2026-08");

  console.log("\nRefusals — every one CALLED, not read");
  expectRaise("R1", "a dispatcher is refused",
    `select public.couranr_set_business_categories('${biz}','${disp}','general_local_business',array[]::text[],null)`, /CR403|role_may_not_change_settings/);
  expectRaise("R2", "a non-member is refused",
    `select public.couranr_set_business_categories('${biz}','${crypto.randomUUID()}','general_local_business',array[]::text[],null)`, /CR40[34]|not_a_member|member/i);
  expectRaise("R3", "a fourth secondary is refused",
    `select public.couranr_set_business_categories('${biz}','${owner}','general_local_business',
       array['printing_signage_promotional','repair_and_electronics','furniture_and_home_goods','books_cards_collectibles_hobby'],null)`, /CR400|too_many/);
  expectRaise("R4", "a secondary repeating the primary is refused",
    `select public.couranr_set_business_categories('${biz}','${owner}','repair_and_electronics',array['repair_and_electronics'],null)`, /CR400|repeats_primary/);
  sql(`select public.couranr_set_business_categories('${biz}','${owner}',null,array['event_rentals_and_supplies'],null)`);
  check("C5", "a NULL primary keeps the stored one — a partial edit is not a revert",
    sql(`select business_category||','||array_to_string(secondary_categories,'|')
           from public.couranr_merchant_workspaces where business_account_id='${biz}'`)
    === "repair_and_electronics,event_rentals_and_supplies");

  expectRaise("R5", "an EXPLICITLY blank primary is refused, unlike a null one",
    `select public.couranr_set_business_categories('${biz}','${owner}','   ',array[]::text[],null)`, /CR400|primary_category_required/);
  expectRaise("R6", "an unknown category is refused by the table CHECK",
    `select public.couranr_set_business_categories('${biz}','${owner}','general_local_business',array['not_a_category'],null)`, /couranr_mw_secondary_values_chk/);

  console.log("\nThe CHECKs still fire on a DIRECT write (the command is not the only guard)");
  expectRaise("K1", "count",
    `update public.couranr_merchant_workspaces set secondary_categories =
       array['printing_signage_promotional','repair_and_electronics','furniture_and_home_goods','books_cards_collectibles_hobby']
     where business_account_id='${biz}'`, /couranr_mw_secondary_count_chk/);
  expectRaise("K2", "distinctness — proving the revoked helper is still evaluated",
    `update public.couranr_merchant_workspaces set secondary_categories =
       array['printing_signage_promotional','printing_signage_promotional'] where business_account_id='${biz}'`,
    /couranr_mw_secondary_distinct_chk/);
  expectRaise("K3", "secondary equal to primary",
    `update public.couranr_merchant_workspaces set business_category='repair_and_electronics',
       secondary_categories=array['repair_and_electronics'] where business_account_id='${biz}'`,
    /couranr_mw_secondary_not_primary_chk/);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
} finally { down({ quiet: true }); }
