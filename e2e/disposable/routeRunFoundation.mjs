/** RR-001 acceptance on an empty disposable PostgreSQL cluster. No providers,
 * production project or physical evidence. Reuses the canonical quote fixture. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const one = (sql) => psql(sql).trim();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
let checks = 0;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };
function refuses(label, sql, marker) {
  let failure;
  try { one(sql); } catch (error) { failure = String(error.stderr || error.message); }
  assert.ok(failure?.includes(marker), `${label}: expected ${marker}; ${failure || "unexpected success"}`);
  checks++; console.log(`PASS ${label}`);
}
const migration = readFileSync(resolve(ROOT, "supabase/migrations/20260923200000_couranr_route_run_draft_foundation.sql"), "utf8");
const rollback = readFileSync(resolve(ROOT, "supabase/rollbacks/20260923200000_couranr_route_run_draft_foundation.rollback.sql"), "utf8");
try {
  up({ quiet: true });
  check("all migrations replay with the route foundation", one("select to_regclass('public.couranr_route_runs') is not null"), "t");
  check(
    "Route Run foreign-key hardening indexes are present",
    one(`select count(*) from pg_indexes where schemaname='public' and indexname in (
      'couranr_rr_created_by_idx','couranr_rr_current_version_idx','couranr_rrv_created_by_idx',
      'couranr_rrs_request_idx','couranr_rrs_quote_idx','couranr_rre_route_idx','couranr_rre_actor_idx'
    )`),
    "7"
  );
  one(rollback);
  check("empty rollback removes only the route substrate", one("select to_regclass('public.couranr_route_runs') is null and to_regclass('public.couranr_deliveries') is not null"), "t");
  one(migration);
  check("forward replay after rollback", one("select to_regclass('public.couranr_route_run_stops') is not null"), "t");

  const biz = one("insert into public.business_accounts(name,status) values('Route fixture','active') returning id");
  const foreignBiz = one("insert into public.business_accounts(name,status) values('Foreign fixture','active') returning id");
  const user = (role) => {
    const id = one(`insert into auth.users(email) values(${q(`route-${role}-${randomUUID()}@example.test`)}) returning id`);
    one(`insert into public.business_members(business_account_id,user_id,role,status) values('${biz}','${id}','${role}','active')`);
    return id;
  };
  const owner = user("owner"), viewer = user("viewer"), manager = user("manager");
  const outsider = one("insert into auth.users(email) values('route-outsider@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values('${foreignBiz}','${outsider}','owner','active')`);
  const make = (opts = {}) => seedCanonicalQuotedRequest(psqlTransport(psql), {
    businessId: biz, actorUserId: owner, marker: `route-${randomUUID()}`, upTo: "draft", ...opts,
  });
  const a = await make(), b = await make(), c = await make();
  const foreign = await make({ businessId: foreignBiz, actorUserId: outsider });
  const differentPickup = await make({ pickupAddress: { line1: "Different fixture pickup", city: "Stafford", region: "VA", postalCode: "22554" } });
  const customerPaid = await make({ payerType: "customer" });
  const ids = [a.requestId, b.requestId];
  const routeId = randomUUID(), key = randomUUID();
  function save({ route = routeId, actor = owner, business = biz, version = 0, token = key, title = "Fixture route", children = ids } = {}) {
    return `select public.couranr_save_route_run_draft('${business}','${actor}','${route}',${version},'${token}',${q(title)},array[${children.map(q).join(",")}]::uuid[])`;
  }
  const read = (actor = owner, business = biz, route = routeId) => `select public.couranr_read_route_run_draft('${business}','${actor}','${route}')`;
  const canonical = () => one(`select jsonb_agg(to_jsonb(r) order by id) from public.couranr_delivery_requests r where id=any(array[${ids.map(q).join(",")}]::uuid[])`);
  const before = canonical();
  const result = JSON.parse(one(save()));
  check("create is a draft, never booking", [result.state, result.draftOnly, result.bookingAvailable], ["draft", true, false]);
  check("exact caller stop order", result.stops.map((s) => s.requestId), ids);
  check("reference total is the sum of immutable child quotes", result.referenceQuoteTotalCents, a.subtotalCents + b.subtotalCents);
  check("save does not mutate canonical requests", canonical(), before);
  check("idempotent save reuses version", JSON.parse(one(save())).version, 1);
  check("replay does not duplicate events", one(`select count(*) from public.couranr_route_run_events where route_run_id='${routeId}'`), "1");
  refuses("idempotency key cannot be reused for different order", save({ children: [...ids].reverse() }), "route_idempotency_conflict");
  refuses("stale save refused", save({ token: randomUUID() }), "route_version_conflict");
  refuses("foreign actor cannot read", read(outsider), "route_business_access_denied");
  refuses("foreign route id hidden", read(outsider, foreignBiz), "route_draft_not_found");
  refuses("foreign route id cannot be overwritten", save({ actor: outsider, business: foreignBiz, token: randomUUID() }), "route_draft_not_found");
  check("viewer has read-only access", JSON.parse(one(read(viewer))).routeRunId, routeId);
  refuses("viewer cannot save", save({ actor: viewer, version: 1, token: randomUUID() }), "route_business_access_denied");
  refuses("foreign child is hidden", save({ route: randomUUID(), token: randomUUID(), children: [a.requestId, foreign.requestId] }), "route_child_not_available");
  refuses("customer-paid child cannot join", save({ route: randomUUID(), token: randomUUID(), children: [a.requestId, customerPaid.requestId] }), "route_child_not_eligible");
  refuses("multiple pickups refused", save({ route: randomUUID(), token: randomUUID(), children: [a.requestId, differentPickup.requestId] }), "route_common_pickup_required");
  refuses("duplicate child refused", save({ route: randomUUID(), token: randomUUID(), children: [a.requestId, a.requestId] }), "route_draft_stops_invalid");
  refuses("one stop refused", save({ route: randomUUID(), token: randomUUID(), children: [a.requestId] }), "route_draft_stops_invalid");
  const revised = JSON.parse(one(save({ version: 1, token: randomUUID(), actor: manager, children: [b.requestId, a.requestId, c.requestId] })));
  check("manager can create immutable next revision", revised.version, 2);
  check("prior revision still has its original two stops", one(`select stop_count from public.couranr_route_run_versions where route_run_id='${routeId}' and version=1`), "2");

  for (const role of ["anon", "authenticated"]) {
    refuses(`${role} cannot execute draft read directly`, `set role ${role}; ${read()}`, "permission denied");
    refuses(`${role} cannot execute draft save directly`, `set role ${role}; ${save({ version: 2, token: randomUUID() })}`, "permission denied");
    refuses(`${role} cannot read route tables`, `set role ${role}; select * from public.couranr_route_runs`, "permission denied");
  }
  check("service role can call the actor-gated read", JSON.parse(one(`set role service_role; ${read()}`)).routeRunId, routeId);
  refuses("service role cannot rewrite history directly", `set role service_role; update public.couranr_route_run_versions set title='overwritten'`, "permission denied");
  refuses("service role cannot delete route evidence", "set role service_role; delete from public.couranr_route_run_events", "permission denied");
  check("all four route tables have RLS enabled", one("select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('couranr_route_runs','couranr_route_run_versions','couranr_route_run_stops','couranr_route_run_events') and relrowsecurity"), "4");

  // Actual two-connection CAS race. The business advisory lock serializes both.
  const parallel = (sql) => new Promise((resolveResult) => {
    const proc = spawn(`${process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin"}/psql`, [
      "-h", "127.0.0.1", "-p", process.env.COURANR_DISPOSABLE_PORT || "55432", "-U", "postgres",
      "-d", "couranr_disposable", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
    ]);
    let error = ""; proc.stderr.on("data", (chunk) => { error += chunk; });
    proc.on("error", (err) => resolveResult({ code: -1, error: String(err) }));
    proc.on("close", (code) => resolveResult({ code, error }));
  });
  const race = await Promise.all([
    parallel(save({ version: 2, token: randomUUID(), title: "Race A" })),
    parallel(save({ version: 2, token: randomUUID(), title: "Race B" })),
  ]);
  check("only one concurrent revision wins", race.filter((r) => r.code === 0).length, 1);
  check("the losing revision is a CAS refusal", race.some((r) => r.error.includes("route_version_conflict")), true);
  check("race creates exactly one next version", JSON.parse(one(read())).version, 3);
  check("race creates exactly one additional audit event", one(`select count(*) from public.couranr_route_run_events where route_run_id='${routeId}'`), "3");
  check("canonical children still unchanged", canonical(), before);

  // Readiness-only mutation in the disposable fixture must not rewrite a draft.
  one(`update public.couranr_delivery_requests set version=version+1 where id='${a.requestId}'`);
  check("changed child is marked stale", JSON.parse(one(read())).stops.find((s) => s.requestId === a.requestId).stale, true);
  check("stored child version is immutable", one(`select request_version from public.couranr_route_run_stops s join public.couranr_route_run_versions v on v.id=s.route_version_id where v.route_run_id='${routeId}' and v.version=1 and s.request_id='${a.requestId}'`), String(a.version));
  one(`update public.business_members set status='disabled' where business_account_id='${biz}' and user_id='${manager}'`);
  refuses("membership revocation enforced on the next read", read(manager), "route_business_access_denied");
  refuses("rollback preserves merchant semantic data", rollback, "route_draft_rollback_refuses_semantic_use");
  check("failed rollback leaves draft readable", JSON.parse(one(read())).version, 3);
  check("draft saving never creates payments", one("select count(*) from public.couranr_payment_obligations"), "0");
  check("draft saving never creates deliveries", one("select count(*) from public.couranr_deliveries"), "0");
  check("single-destination doctrine remains intact", one("select count(*) from public.couranr_delivery_requests where additional_stops<>0 or not single_destination_contract"), "0");
  console.log(`Route Run Foundation: ${checks} checks PASS (disposable PostgreSQL; no providers).`);
} catch (error) {
  // The disposable cluster is deleted by finally. Preserve its startup
  // diagnostic before teardown so a runner failure is not confused with SQL.
  try {
    const log = readFileSync(resolve(process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable", "log/pg.log"), "utf8");
    console.error(log.slice(-6000));
  } catch { /* startup may have failed before a log existed */ }
  throw error;
} finally { down({ quiet: true }); }
