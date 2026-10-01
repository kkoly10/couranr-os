/** RR-003 billing/operational read separation, executed against disposable PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const filename = "20261001123351_couranr_route_settlement_read_authority";
const forward = readFileSync(resolve(ROOT, `supabase/migrations/${filename}.sql`), "utf8");
const rollback = readFileSync(resolve(ROOT, `supabase/rollbacks/${filename}.rollback.sql`), "utf8");
const one = (query) => psql(query).trim();
const esc = (value) => String(value).replaceAll("'", "''");
let checks = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log("PASS", name);
}
function refuses(name, query, marker) {
  let error = "";
  try { one(query); } catch (failure) { error = String(failure.stderr || failure.message); }
  assert.ok(error.includes(marker), `${name}: expected ${marker}; ${error || "success"}`);
  checks++;
  console.log("PASS", name);
}
const full = (business, actor, route) =>
  `select public.couranr_read_route_run_settlement('${business}','${actor}','${route}')`;
const operational = (business, actor, route) =>
  `select public.couranr_read_route_run_operational_settlement('${business}','${actor}','${route}')`;

try {
  const info = up({ quiet: true });
  console.log(`RR-003 read authority: ${info.migrationsApplied} migrations applied`);
  check("empty forward installs operational read", one(`select to_regprocedure(
    'public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)') is not null`), "t");
  one(rollback);
  check("empty rollback removes operational read", one(`select to_regprocedure(
    'public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)') is null`), "t");
  one(forward);
  check("forward reapplies after empty rollback", one(`select to_regprocedure(
    'public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)') is not null`), "t");

  const signature = "public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)";
  const fullSignature = "public.couranr_read_route_run_settlement(uuid,uuid,uuid)";
  for (const role of ["anon", "authenticated"]) {
    for (const fn of [signature, fullSignature]) {
      check(`${role} has no ${fn} execute`, one(`select has_function_privilege(
        '${role}','${fn}','EXECUTE')`), "f");
      refuses(`${role} direct ${fn} call is denied`,
        `set role ${role}; select ${fn.split("(")[0]}(null,null,null)`, "permission denied");
    }
  }
  check("service_role can call operational read", one(`select has_function_privilege(
    'service_role','${signature}','EXECUTE')`), "t");
  check("service_role can call billing read", one(`select has_function_privilege(
    'service_role','${fullSignature}','EXECUTE')`), "t");

  const business = one("insert into public.business_accounts(name,status) values('RR003 read shop','active') returning id");
  const otherBusiness = one("insert into public.business_accounts(name,status) values('RR003 other shop','active') returning id");
  const users = {};
  for (const role of ["owner", "manager", "billing", "dispatcher", "viewer", "former", "other"]) {
    users[role] = one(`insert into auth.users(email) values('rr003-read-${role}@example.test') returning id`);
    one(`insert into public.business_members(business_account_id,user_id,role,status) values(
      '${role === "other" ? otherBusiness : business}','${users[role]}',
      '${role === "former" ? "owner" : role === "other" ? "owner" : role}',
      '${role === "former" ? "disabled" : "active"}')`);
  }
  const transport = psqlTransport(psql);
  async function child(marker, subtotal) {
    const seeded = await seedCanonicalQuotedRequest(transport, {
      businessId: business, actorUserId: users.owner, marker, upTo: "draft",
      weightLb: 20, subtotalCents: subtotal,
    });
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${seeded.requestId}','${business}','${users.owner}',0,
      'Package ${esc(marker)}',1,'${esc(marker)}',null)`);
    const value = JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${business}','${users.owner}','${seeded.requestId}',${seeded.version},10000)`));
    return { ...seeded, version: value.version };
  }
  const first = await child("rr003-read-1", 1900);
  const second = await child("rr003-read-2", 2100);
  const route = randomUUID();
  one(`select public.couranr_save_route_run_draft('${business}','${users.owner}',
    '${route}',0,'${randomUUID()}','Read authority route',
    array['${first.requestId}','${second.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${business}','${users.owner}',
    '${route}',1,'${randomUUID()}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4)
    values('${business}','cus_rr003read',false,1,'pm_rr003read','seti_rr003read','visa','4242')`);
  const checkout = JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${business}','${users.owner}','${route}',1,'${randomUUID()}')`));
  check("fixture is a real two-child post-checkout settlement", checkout.items.length, 2);
  check("fixture has exact child charge total", checkout.referenceTotalCents, 4000);

  for (const role of ["owner", "manager", "billing"]) {
    const response = JSON.parse(one(full(business, users[role], route)));
    check(`${role} can read saved card after checkout`, response.card.last4, "4242");
    check(`${role} can read child amount after checkout`, response.items[0].amountCents, 1900);
  }
  refuses("billing reader cannot authorize Route", `select public.couranr_begin_route_child_authorization(
    '${business}','${users.billing}','${route}','${checkout.items[0].obligationId}')`,
    "route_checkout_access_denied");
  for (const role of ["dispatcher", "viewer"]) {
    refuses(`${role} cannot read full settlement through service_role RPC`,
      full(business, users[role], route), "route_billing_read_access_denied");
    const response = one(operational(business, users[role], route));
    check(`${role} receives only coarse status`, JSON.parse(response), { status: "payment_pending" });
    for (const forbidden of ["4242", "visa", "obligationId", "amountCents", "provider",
      "pm_rr003read", "cus_rr003read", checkout.settlementId]) {
      check(`${role} response excludes ${forbidden}`, response.includes(forbidden), false);
    }
  }
  for (const role of ["former", "other"]) {
    refuses(`${role} cannot read billing`, full(business, users[role], route),
      "route_billing_read_access_denied");
    refuses(`${role} cannot read operational status`, operational(business, users[role], route),
      "route_business_access_denied");
  }
  one(`update public.business_members set role='viewer' where business_account_id='${business}'
    and user_id='${users.owner}'`);
  refuses("role downgrade immediately removes full SQL read",
    full(business, users.owner, route), "route_billing_read_access_denied");
  check("downgraded owner retains only coarse read", JSON.parse(one(operational(business, users.owner, route))),
    { status: "payment_pending" });
  refuses("semantic rollback refuses to reopen billing exposure", rollback,
    "route_settlement_read_authority_rollback_refuses_semantic_history");
  check("failed rollback leaves guard installed", one(`select has_function_privilege(
    'authenticated','${signature}','EXECUTE')`), "f");
  console.log(`RR-003 Read Authority ${checks}/${checks} PASS (disposable PostgreSQL).`);
} finally { down({ quiet: true }); }
