/** RR-003a provider-free SQL gate. Real Stripe behavior is NOT asserted here. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import { POSTGREST_PORT, SERVICE_ROLE_JWT, startPostgrest, waitForPostgrest } from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const migration = readFileSync(resolve(ROOT, "supabase/migrations/20260930124500_couranr_business_payment_method_foundation.sql"), "utf8");
const rollback = readFileSync(resolve(ROOT, "supabase/rollbacks/20260930124500_couranr_business_payment_method_foundation.rollback.sql"), "utf8");
const one = (sql) => psql(sql).trim();
const consent = "Save this card for future Couranr for Business delivery charges. Saving it does not book or charge a Route Run. Before Route checkout confirmation, Couranr shows the separate delivery quotes; an authorized Business member must confirm that checkout. Couranr may then authorize and capture those delivery charges under the displayed terms. You can replace the saved card. Couranr does not store the card number.";
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
let checks = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log(`PASS ${label}`);
}
function refuses(label, sql, marker) {
  let error;
  try { one(sql); } catch (failure) { error = String(failure.stderr || failure.message); }
  assert.ok(error?.includes(marker), `${label}: expected ${marker}, got ${error || "success"}`);
  checks++;
  console.log(`PASS ${label}`);
}
function psqlAsync(sql) {
  return new Promise((resolveResult, reject) => {
    const bin = resolve(process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin", "psql");
    const child = spawn(bin, ["-qAt", "-v", "ON_ERROR_STOP=1", "-d", dbUrl(), "-c", sql],
      { env: { ...process.env, LC_ALL: process.env.LC_ALL || "C" } });
    let output = ""; let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveResult(output.trim()) : reject(new Error(error)));
  });
}

let postgrest;
try {
  const { migrationsApplied } = up({ quiet: true });
  console.log(`RR-003a SQL: ${migrationsApplied} migrations applied`);
  one(rollback);
  check("empty rollback removes profile", one("select to_regclass('public.couranr_business_payment_profiles') is null"), "t");
  check("empty rollback removes attempts", one("select to_regclass('public.couranr_business_payment_setup_attempts') is null"), "t");
  one(migration);
  check("forward replay restores profile", one("select to_regclass('public.couranr_business_payment_profiles') is not null"), "t");
  check("both tables have RLS", one(`select count(*) from pg_class where oid in (
    'public.couranr_business_payment_profiles'::regclass,
    'public.couranr_business_payment_setup_attempts'::regclass) and relrowsecurity`), "2");
  check("browser roles have no table access", one(`select
    has_table_privilege('anon','public.couranr_business_payment_profiles','SELECT,INSERT,UPDATE,DELETE')::text||','||
    has_table_privilege('authenticated','public.couranr_business_payment_profiles','SELECT,INSERT,UPDATE,DELETE')::text||','||
    has_table_privilege('anon','public.couranr_business_payment_setup_attempts','SELECT,INSERT,UPDATE,DELETE')::text||','||
    has_table_privilege('authenticated','public.couranr_business_payment_setup_attempts','SELECT,INSERT,UPDATE,DELETE')::text`), "false,false,false,false");
  check("service role reads but cannot write tables directly", one(`select
    has_table_privilege('service_role','public.couranr_business_payment_profiles','SELECT')::text||','||
    has_table_privilege('service_role','public.couranr_business_payment_profiles','UPDATE')::text||','||
    has_table_privilege('service_role','public.couranr_business_payment_setup_attempts','INSERT')::text`), "true,false,false");
  for (const [signature, nullArgs] of [
    ["couranr_begin_business_payment_customer(uuid,uuid)", "null::uuid,null::uuid"],
    ["couranr_attach_business_payment_customer(uuid,uuid,text,boolean)", "null::uuid,null::uuid,null::text,null::boolean"],
    ["couranr_begin_business_payment_setup(uuid,uuid,text,text)", "null::uuid,null::uuid,null::text,null::text"],
    ["couranr_rotate_business_payment_setup(uuid,uuid,uuid,text,text,text)", "null::uuid,null::uuid,null::uuid,null::text,null::text,null::text"],
    ["couranr_attach_business_payment_setup(uuid,uuid,uuid,text)", "null::uuid,null::uuid,null::uuid,null::text"],
    ["couranr_complete_business_payment_setup(uuid,uuid,uuid,text,text,text,text)", "null::uuid,null::uuid,null::uuid,null::text,null::text,null::text,null::text"],
  ]) {
    check(`only service role executes ${signature}`, one(`select
      has_function_privilege('service_role','public.${signature}','EXECUTE')::text||','||
      has_function_privilege('anon','public.${signature}','EXECUTE')::text||','||
      has_function_privilege('authenticated','public.${signature}','EXECUTE')::text`), "true,false,false");
    for (const role of ["anon", "authenticated"]) {
      refuses(`${role} cannot invoke ${signature}`, `set role ${role};
        select public.${signature.slice(0, signature.indexOf("("))}(${nullArgs})`, "permission denied");
    }
    refuses(`service_role reaches ${signature} membership gate`, `set role service_role;
      select public.${signature.slice(0, signature.indexOf("("))}(${nullArgs})`, "business_payment_access_denied");
  }

  const business = one("insert into public.business_accounts(name,status) values('RR003 test','active') returning id");
  const owner = one("insert into auth.users(email) values('rr003-owner@example.test') returning id");
  const manager = one("insert into auth.users(email) values('rr003-manager@example.test') returning id");
  const dispatcher = one("insert into auth.users(email) values('rr003-dispatcher@example.test') returning id");
  const billing = one("insert into auth.users(email) values('rr003-billing@example.test') returning id");
  const foreign = one("insert into auth.users(email) values('rr003-foreign@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status)
    values('${business}','${owner}','owner','active'),('${business}','${manager}','manager','active'),
    ('${business}','${dispatcher}','dispatcher','active'),('${business}','${billing}','billing','active')`);
  const begin = (actor) => `select row_to_json(t) from public.couranr_begin_business_payment_customer('${business}','${actor}') t`;
  refuses("foreign user cannot begin Customer", begin(foreign), "business_payment_access_denied");
  refuses("dispatcher cannot begin Customer", begin(dispatcher), "business_payment_access_denied");
  refuses("billing contact cannot mutate card", begin(billing), "business_payment_access_denied");
  const p1 = JSON.parse(one(begin(owner)));
  const p2 = JSON.parse(one(begin(manager)));
  postgrest = await startPostgrest({ dbUrl: dbUrl(), binary: postgrestTarget(),
    workDir: resolve(process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable", "rr003-pgrst") });
  assert.ok(await waitForPostgrest(), "RR-003 PostgREST did not start");
  const rpcResponse = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/rpc/couranr_begin_business_payment_customer`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_ROLE_JWT}` },
    body: JSON.stringify({ p_business_account_id: business, p_actor_user_id: owner }),
  });
  const rpcText = await rpcResponse.text();
  assert.equal(rpcResponse.status, 200, `PostgREST composite RPC: ${rpcText}`);
  const rpcBody = JSON.parse(rpcText);
  check("PostgREST composite RPC returns one object for Supabase client", Array.isArray(rpcBody), false);
  check("PostgREST composite RPC preserves Customer key", rpcBody.customer_create_key, p1.customer_create_key);
  check("service_role actually invokes named command", one(`set role service_role;
    select business_account_id from public.couranr_begin_business_payment_customer('${business}','${owner}')`), business);
  check("Customer creation retry has one durable key", p2.customer_create_key, p1.customer_create_key);
  check("Customer creation retry has one profile", one(`select count(*) from public.couranr_business_payment_profiles where business_account_id='${business}'`), "1");
  one(`select public.couranr_attach_business_payment_customer('${business}','${owner}','cus_RR003Test',false)`);
  check("Customer mode evidence is stored", one(`select stripe_customer_livemode from public.couranr_business_payment_profiles
    where business_account_id='${business}'`), "f");
  refuses("Customer identity cannot switch", `select public.couranr_attach_business_payment_customer('${business}','${owner}','cus_Other',false)`, "business_payment_customer_conflict");
  refuses("Customer mode cannot switch", `select public.couranr_attach_business_payment_customer('${business}','${owner}','cus_RR003Test',true)`, "business_payment_customer_conflict");
  refuses("setup needs explicit policy consent", `select public.couranr_begin_business_payment_setup('${business}','${owner}','wrong-policy',${quote(consent)})`, "business_payment_consent_required");
  const start = (actor) => `select row_to_json(t) from public.couranr_begin_business_payment_setup('${business}','${actor}','business-saved-card-v1-2026-09-29',${quote(consent)}) t`;
  const a1 = JSON.parse(one(start(owner)));
  const a2 = JSON.parse(one(start(owner)));
  check("same actor retry reuses one SetupIntent key", a2.id, a1.id);
  refuses("altered consent text is refused", `select public.couranr_begin_business_payment_setup('${business}','${owner}','business-saved-card-v1-2026-09-29',${quote(`${consent} changed`)})`, "business_payment_consent_required");
  const blocked = JSON.parse(one(start(manager)));
  check("second actor cannot silently supersede unfinished setup", blocked.id, a1.id);
  one(`select public.couranr_attach_business_payment_setup('${business}','${owner}','${a1.id}','seti_Old')`);
  const stillBlocked = JSON.parse(one(start(manager)));
  check("issued Stripe intent remains current until canceled", stillBlocked.id, a1.id);
  refuses("rotation requires exact prior intent", `select public.couranr_rotate_business_payment_setup(
    '${business}','${manager}','${a1.id}','seti_Forged','business-saved-card-v1-2026-09-29',${quote(consent)})`, "business_payment_setup_stale");
  // The real server verifies Stripe status=canceled before issuing rotation.
  // The disposable SQL gate tests its CAS contract without calling Stripe.
  const a3 = JSON.parse(one(`select row_to_json(t) from public.couranr_rotate_business_payment_setup(
    '${business}','${manager}','${a1.id}','seti_Old','business-saved-card-v1-2026-09-29',${quote(consent)}) t`));
  check("verified cancellation advances generation", a3.generation, 2);
  check("new consent is attributed to new actor", a3.actor_user_id, manager);
  check("consent text is durable", one(`select consent_text from public.couranr_business_payment_setup_attempts where id='${a3.id}'`), consent);
  refuses("superseded actor cannot attach old attempt", `select public.couranr_attach_business_payment_setup('${business}','${owner}','${a1.id}','seti_Old')`, "business_payment_setup_stale");
  one(`select public.couranr_attach_business_payment_setup('${business}','${manager}','${a3.id}','seti_RR003First')`);
  check("attach retry preserves provider identity", one(`select stripe_setup_intent_id from public.couranr_attach_business_payment_setup('${business}','${manager}','${a3.id}','seti_RR003First')`), "seti_RR003First");
  refuses("SetupIntent identity cannot switch", `select public.couranr_attach_business_payment_setup('${business}','${manager}','${a3.id}','seti_RR003Other')`, "business_payment_setup_conflict");
  refuses("malformed card evidence refused", `select public.couranr_complete_business_payment_setup('${business}','${manager}','${a3.id}','seti_RR003First','pm_RR003First','visa','123')`, "business_payment_setup_invalid");
  one(`update public.business_members set status='disabled' where business_account_id='${business}' and user_id='${manager}'`);
  refuses("former consenting manager cannot finalize after membership revocation", `select public.couranr_complete_business_payment_setup('${business}','${manager}','${a3.id}','seti_RR003First','pm_RR003First','visa','4242')`, "business_payment_access_denied");
  one(`select public.couranr_complete_business_payment_setup('${business}','${owner}','${a3.id}','seti_RR003First','pm_RR003First','visa','4242')`);
  check("consent actor and recovery actor remain distinct", one(`select actor_user_id::text||':'||completed_by_user_id::text
    from public.couranr_business_payment_setup_attempts where id='${a3.id}'`), `${manager}:${owner}`);
  check("verified method is current", one(`select default_payment_method_id||':'||card_last4 from public.couranr_business_payment_profiles where business_account_id='${business}'`), "pm_RR003First:4242");
  check("completion replay is idempotent", one(`select default_payment_method_id from public.couranr_complete_business_payment_setup('${business}','${owner}','${a3.id}','seti_RR003First','pm_RR003First','visa','4242')`), "pm_RR003First");
  const replacement = JSON.parse(one(start(owner)));
  check("replacement advances generation", replacement.generation, 3);
  refuses("old successful attempt cannot overwrite replacement", `select public.couranr_complete_business_payment_setup('${business}','${owner}','${a3.id}','seti_RR003First','pm_RR003First','visa','4242')`, "business_payment_setup_stale");
  check("old verified card remains until replacement succeeds", one(`select default_payment_method_id from public.couranr_business_payment_profiles where business_account_id='${business}'`), "pm_RR003First");
  const raceBusiness = one("insert into public.business_accounts(name,status) values('RR003 race','active') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status)
    values('${raceBusiness}','${owner}','owner','active'),('${raceBusiness}','${manager}','manager','active')`);
  one(`select public.couranr_begin_business_payment_customer('${raceBusiness}','${owner}')`);
  one(`select public.couranr_attach_business_payment_customer('${raceBusiness}','${owner}','cus_RR003Race',false)`);
  const raceStart = (actor) => `select row_to_json(t) from public.couranr_begin_business_payment_setup(
    '${raceBusiness}','${actor}','business-saved-card-v1-2026-09-29',${quote(consent)}) t`;
  const lock = psqlAsync(`begin; select 1 from public.couranr_business_payment_profiles
    where business_account_id='${raceBusiness}' for update; select pg_sleep(0.5); commit`);
  await new Promise((done) => setTimeout(done, 80));
  const [r1, r2] = await Promise.all([psqlAsync(raceStart(owner)), psqlAsync(raceStart(manager))]);
  await lock;
  check("concurrent managers see the same current attempt", JSON.parse(r1).id, JSON.parse(r2).id);
  check("concurrent begin creates one attempt", one(`select count(*) from public.couranr_business_payment_setup_attempts
    where business_account_id='${raceBusiness}'`), "1");
  check("concurrent begin increments generation once", one(`select current_generation
    from public.couranr_business_payment_profiles where business_account_id='${raceBusiness}'`), "1");
  refuses("semantic rollback refuses real profile", rollback, "business_payment_rollback_refuses_semantic_history");
  check("failed rollback preserved history", one(`select count(*) from public.couranr_business_payment_setup_attempts where business_account_id='${business}'`), "3");
  console.log(`RR-003a SQL ${checks}/${checks} PASS`);
} finally {
  if (postgrest) {
    const exited = new Promise((resolveExit) => postgrest.once("exit", resolveExit));
    postgrest.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolveExit) => setTimeout(resolveExit, 5000))]);
    if (postgrest.exitCode === null) postgrest.kill("SIGKILL");
  }
  down({ quiet: true });
}
