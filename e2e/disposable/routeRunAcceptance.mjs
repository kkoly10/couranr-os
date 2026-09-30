/**
 * RR-002 accepted Route Run contract.
 *
 * Provider-free disposable PostgreSQL evidence for:
 * - exact accepted-version freeze + atomic child claims
 * - draft abandonment
 * - quote approval persistence
 * - aggregate risk / package / recipient / service restrictions
 * - cross-route and standalone-submit races
 * - no payment, booking, dispatch or custody side effects
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const migration = readFileSync(resolve(ROOT, "supabase/migrations/20260926043000_couranr_route_run_acceptance.sql"), "utf8");
const rollback = readFileSync(resolve(ROOT, "supabase/rollbacks/20260926043000_couranr_route_run_acceptance.rollback.sql"), "utf8");
const cancelMigration = readFileSync(resolve(ROOT, "supabase/migrations/20260930023308_couranr_route_run_preexecution_cancellation.sql"), "utf8");
const cancelRollback = readFileSync(resolve(ROOT, "supabase/rollbacks/20260930023308_couranr_route_run_preexecution_cancellation.rollback.sql"), "utf8");
const indexMigration = readFileSync(resolve(ROOT, "supabase/migrations/20260930023313_couranr_route_run_claim_fk_index.sql"), "utf8");
const indexRollback = readFileSync(resolve(ROOT, "supabase/rollbacks/20260930023313_couranr_route_run_claim_fk_index.rollback.sql"), "utf8");
const one = (sql) => psql(sql).trim();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
let checks = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log(`PASS ${label}`);
}
function refuses(label, sql, marker) {
  let failure;
  try { one(sql); } catch (error) { failure = String(error.stderr || error.message); }
  assert.ok(failure?.includes(marker), `${label}: expected ${marker}; ${failure || "unexpected success"}`);
  checks++;
  console.log(`PASS ${label}`);
}
function routeSave({ business, actor, route, version = 0, key = randomUUID(), title = "Route fixture", children }) {
  return `select public.couranr_save_route_run_draft('${business}','${actor}','${route}',${version},'${key}',${q(title)},array[${children.map(q).join(",")}]::uuid[])`;
}
function routeAccept({ business, actor, route, version = 1, key }) {
  return `select public.couranr_accept_route_run('${business}','${actor}','${route}',${version},'${key}')`;
}
function routeAbandon({ business, actor, route, version = 1, key }) {
  return `select public.couranr_abandon_route_run_draft('${business}','${actor}','${route}',${version},'${key}')`;
}
function routeCancel({ business, actor, route, version = 1, key }) {
  return `select public.couranr_cancel_accepted_route_run('${business}','${actor}','${route}',${version},'${key}')`;
}
function obligationInsert(requestId, marker) {
  return `insert into public.couranr_payment_obligations
    (request_id,business_account_id,payer_type,request_version,pricing_policy_version,
      amount_cents,idempotency_key,quote_version_id)
    select r.id,r.business_account_id,r.payer_type,r.version,q.pricing_policy_version,
      q.subtotal_cents,${q(marker)},q.id
    from public.couranr_delivery_requests r join public.couranr_quote_versions q
      on q.id=r.current_quote_version_id where r.id='${requestId}'`;
}
function parallel(sql) {
  return new Promise((resolveResult) => {
    const proc = spawn(`${process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin"}/psql`, [
      "-h", "127.0.0.1",
      "-p", process.env.COURANR_DISPOSABLE_PORT || "55432",
      "-U", "postgres", "-d", "couranr_disposable",
      "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
    ]);
    let out = "", error = "";
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { error += c; });
    proc.on("error", (err) => resolveResult({ code: -1, out, error: String(err) }));
    proc.on("close", (code) => resolveResult({ code, out, error }));
  });
}
try {
  const info = up({ quiet: true });
  console.log(`RR-002 acceptance: ${info.migrationsApplied} migrations applied`);

  // Paired rollback must actually restore RR-001 when RR-002 has no semantic use.
  one(indexRollback);
  one(cancelRollback);
  one(rollback);
  check("empty RR-002 rollback removes claim table", one("select to_regclass('public.couranr_route_run_claims') is null"), "t");
  check("empty RR-002 rollback restores draft-only state check",
    one("select pg_get_constraintdef(oid) like '%route_state = ''draft''%' from pg_constraint where conname='couranr_route_runs_route_state_check'"), "t");
  one(migration);
  one(cancelMigration);
  one(indexMigration);
  check("RR-002 forward replay restores claims", one("select to_regclass('public.couranr_route_run_claims') is not null"), "t");
  check("claim FK has covering composite index", one(`select count(*) from pg_indexes where schemaname='public' and indexname='couranr_rrc_route_version_idx' and indexdef like '%(route_run_id, route_version_id)%'`), "1");

  const biz = one("insert into public.business_accounts(name,status) values('RR002 business','active') returning id");
  const owner = one("insert into auth.users(email) values('rr002-owner@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values('${biz}','${owner}','owner','active')`);
  const viewer = one("insert into auth.users(email) values('rr002-viewer@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values('${biz}','${viewer}','viewer','active')`);
  const transport = psqlTransport(psql);

  async function child({
    marker = `rr002-${randomUUID()}`,
    value = 10000,
    manifest = true,
    declared = true,
    serviceLevel = "standard",
    recipientEmail = "rr002-recipient@example.test",
    weightLb = 20,
  } = {}) {
    const seeded = await seedCanonicalQuotedRequest(transport, {
      businessId: biz,
      actorUserId: owner,
      marker,
      upTo: "draft",
      serviceLevel,
      recipientEmail,
      weightLb,
    });
    if (manifest) {
      one(`select id from public.couranr_set_business_pickup_manifest(
        '${seeded.requestId}','${biz}','${owner}',0,
        ${q("Package " + marker)},1,${q(marker)},null
      )`);
    }
    let version = seeded.version;
    if (declared) {
      const first = JSON.parse(one(`select public.couranr_record_business_declared_value(
        '${biz}','${owner}','${seeded.requestId}',${version},${value}
      )`));
      version = first.version;
      // Exact replay with the stale original generation must be safe.
      const replay = JSON.parse(one(`select public.couranr_record_business_declared_value(
        '${biz}','${owner}','${seeded.requestId}',${seeded.version},${value}
      )`));
      check(`${marker} declared-value replay returns current generation`, replay.version, version);
      check(`${marker} declared-value replay creates one event`,
        one(`select count(*) from public.couranr_delivery_request_events where request_id='${seeded.requestId}' and command='record_business_declared_value'`), "1");
    }
    return { ...seeded, version };
  }
  // Happy path: accepted is a frozen stop set, not a booking.
  const a = await child({ marker: "accepted-a", value: 12000 });
  const b = await child({ marker: "accepted-b", value: 18000 });
  const acceptedRoute = randomUUID();
  const acceptKey = randomUUID();
  const draft = JSON.parse(one(routeSave({
    business: biz, actor: owner, route: acceptedRoute, children: [a.requestId, b.requestId],
  })));
  check("saved route is draft", draft.state, "draft");
  check("saved route is not bookable", [draft.bookingAvailable, draft.executionAvailable], [false, false]);

  check("unaccepted child quote would expire in the future",
    one(`select private.couranr_quote_version_is_expired(q,now()+interval '16 minutes')
      from public.couranr_quote_versions q where q.id='${a.quoteVersionId}'`), "t");

  const accepted = JSON.parse(one(routeAccept({
    business: biz, actor: owner, route: acceptedRoute, key: acceptKey,
  })));
  check("acceptance freezes state", accepted.state, "accepted");
  check("accepted version is exact draft version", accepted.acceptedVersion, 1);
  check("all accepted stops are claimed", accepted.stops.map((s) => s.claimed), [true, true]);
  check("accepted route remains unbooked and unexecutable",
    [accepted.bookingAvailable, accepted.executionAvailable], [false, false]);
  check("accepted child quotes stay approved after the original 15 minute window",
    one(`select private.couranr_quote_version_is_expired(q,now()+interval '1 day')
      from public.couranr_quote_versions q where q.id='${a.quoteVersionId}'`), "f");
  check("accept adds a second event against the same immutable route version",
    one(`select count(*) from public.couranr_route_run_events where route_run_id='${acceptedRoute}'`), "2");
  check("acceptance leaves child request states draft",
    one(`select count(*) from public.couranr_delivery_requests where id in ('${a.requestId}','${b.requestId}') and request_state='draft'`), "2");
  check("acceptance creates no payment obligations",
    one("select count(*) from public.couranr_payment_obligations"), "0");
  check("acceptance creates no canonical deliveries",
    one("select count(*) from public.couranr_deliveries"), "0");
  check("acceptance creates no service plans",
    one("select count(*) from public.couranr_service_plans"), "0");
  check("acceptance creates no assignments",
    one("select count(*) from public.couranr_delivery_assignments"), "0");

  const replayAccepted = JSON.parse(one(routeAccept({
    business: biz, actor: owner, route: acceptedRoute, key: acceptKey,
  })));
  check("accept replay is idempotent", replayAccepted.state, "accepted");
  refuses("different accept key cannot reinterpret accepted route",
    routeAccept({ business: biz, actor: owner, route: acceptedRoute, key: randomUUID() }),
    "route_already_accepted");
  refuses("accepted route cannot be revised",
    routeSave({ business: biz, actor: owner, route: acceptedRoute, version: 1, children: [b.requestId, a.requestId] }),
    "route_not_editable");
  refuses("accepted child cannot be submitted standalone",
    `select id from public.couranr_submit_delivery_request_v2(
      '${a.requestId}','${biz}',${a.version},'${owner}',true
    )`, "route_child_claimed");
  refuses("accepted child cannot be directly changed",
    `update public.couranr_delivery_requests set readiness_state='ready' where id='${a.requestId}'`,
    "route_child_claimed");

  // A save replay may return its historical version alongside a newer current
  // generation. The acceptance CAS must use the version the merchant actually
  // saw, never the newer currentVersion attached to that historical view.
  const replayA = await child({ marker: "replay-a" });
  const replayB = await child({ marker: "replay-b" });
  const replayRoute = randomUUID();
  const firstSaveKey = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: replayRoute,
    key: firstSaveKey, children: [replayA.requestId, replayB.requestId] }));
  one(routeSave({ business: biz, actor: owner, route: replayRoute,
    version: 1, children: [replayB.requestId, replayA.requestId] }));
  const historicalReplay = JSON.parse(one(routeSave({ business: biz, actor: owner,
    route: replayRoute, key: firstSaveKey, children: [replayA.requestId, replayB.requestId] })));
  check("historical save replay exposes displayed and current generations separately",
    [historicalReplay.version, historicalReplay.currentVersion], [1, 2]);
  refuses("historical displayed generation cannot approve a newer stop set",
    routeAccept({ business: biz, actor: owner, route: replayRoute, version: historicalReplay.version, key: randomUUID() }),
    "route_version_conflict");
  check("current reviewed generation can be accepted",
    JSON.parse(one(routeAccept({ business: biz, actor: owner, route: replayRoute, version: 2, key: randomUUID() }))).acceptedVersion, 2);

  // Archive is separate from accepted cancellation and leaves children unclaimed.
  const c = await child({ marker: "archive-c", value: 5000 });
  const d = await child({ marker: "archive-d", value: 5000 });
  const archiveRoute = randomUUID();
  const archiveKey = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: archiveRoute, children: [c.requestId, d.requestId] }));
  const archived = JSON.parse(one(routeAbandon({
    business: biz, actor: owner, route: archiveRoute, key: archiveKey,
  })));
  check("draft can be archived", archived.state, "abandoned");
  check("archive leaves children unclaimed",
    one(`select count(*) from public.couranr_route_run_claims where route_run_id='${archiveRoute}'`), "0");
  check("archive replay is idempotent",
    JSON.parse(one(routeAbandon({ business: biz, actor: owner, route: archiveRoute, key: archiveKey }))).state,
    "abandoned");
  refuses("archive cannot be repeated under a different command key",
    routeAbandon({ business: biz, actor: owner, route: archiveRoute, key: randomUUID() }),
    "route_already_abandoned");

  // Fail-closed acceptance requirements.
  const noManifestA = await child({ marker: "no-manifest-a", manifest: false, value: 5000 });
  const noManifestB = await child({ marker: "no-manifest-b", value: 5000 });
  const noManifestRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: noManifestRoute, children: [noManifestA.requestId, noManifestB.requestId] }));
  refuses("accept refuses a stop with no pickup manifest",
    routeAccept({ business: biz, actor: owner, route: noManifestRoute, key: randomUUID() }),
    "route_child_pickup_manifest_required");

  const noValueA = await child({ marker: "no-value-a", declared: false });
  const noValueB = await child({ marker: "no-value-b", value: 5000 });
  const noValueRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: noValueRoute, children: [noValueA.requestId, noValueB.requestId] }));
  refuses("accept refuses a stop with no declared value",
    routeAccept({ business: biz, actor: owner, route: noValueRoute, key: randomUUID() }),
    "route_child_declared_value_required");

  const highA = await child({ marker: "high-a", value: 30000 });
  const highB = await child({ marker: "high-b", value: 25001 });
  const highRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: highRoute, children: [highA.requestId, highB.requestId] }));
  refuses("accept refuses aggregate declared value above $500",
    routeAccept({ business: biz, actor: owner, route: highRoute, key: randomUUID() }),
    "route_declared_value_exceeded");
  check("failed aggregate acceptance claims nothing",
    one(`select count(*) from public.couranr_route_run_claims where route_run_id='${highRoute}'`), "0");

  const priorityA = await child({ marker: "priority-a", value: 5000, serviceLevel: "priority" });
  const priorityB = await child({ marker: "priority-b", value: 5000 });
  const priorityRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: priorityRoute, children: [priorityA.requestId, priorityB.requestId] }));
  refuses("V1 acceptance refuses non-standard service",
    routeAccept({ business: biz, actor: owner, route: priorityRoute, key: randomUUID() }),
    "route_child_service_level_not_supported");

  const heavyA = await child({ marker: "heavy-a", value: 5000, weightLb: 60 });
  const heavyB = await child({ marker: "heavy-b", value: 5000 });
  const heavyRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: heavyRoute, children: [heavyA.requestId, heavyB.requestId] }));
  refuses("V1 acceptance refuses a child above 50 lb",
    routeAccept({ business: biz, actor: owner, route: heavyRoute, key: randomUUID() }),
    "route_child_weight_not_supported");

  const timingA = await child({ marker: "timing-a", value: 5000 });
  const timingB = await child({ marker: "timing-b", value: 5000 });
  one(`update public.couranr_delivery_requests set timing_intent='asap' where id='${timingB.requestId}'`);
  const timingRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: timingRoute, children: [timingA.requestId, timingB.requestId] }));
  refuses("V1 acceptance refuses mixed pickup timing",
    routeAccept({ business: biz, actor: owner, route: timingRoute, key: randomUUID() }),
    "route_common_timing_required");

  const noEmailA = await child({ marker: "no-email-a", value: 5000, recipientEmail: null });
  const noEmailB = await child({ marker: "no-email-b", value: 5000 });
  const noEmailRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: noEmailRoute, children: [noEmailA.requestId, noEmailB.requestId] }));
  refuses("V1 acceptance requires recipient email for every stop",
    routeAccept({ business: biz, actor: owner, route: noEmailRoute, key: randomUUID() }),
    "route_child_recipient_email_required");
  // Two Route Runs may reference the same drafts, but only one can atomically claim.
  const raceA = await child({ marker: "claim-race-a", value: 5000 });
  const raceB = await child({ marker: "claim-race-b", value: 5000 });
  const raceChildren = [raceA.requestId, raceB.requestId];
  const routeOne = randomUUID(), routeTwo = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: routeOne, children: raceChildren, title: "Claim race one" }));
  one(routeSave({ business: biz, actor: owner, route: routeTwo, children: raceChildren, title: "Claim race two" }));
  const claimRace = await Promise.all([
    parallel(routeAccept({ business: biz, actor: owner, route: routeOne, key: randomUUID() })),
    parallel(routeAccept({ business: biz, actor: owner, route: routeTwo, key: randomUUID() })),
  ]);
  check("exactly one overlapping Route Run acceptance wins", claimRace.filter((x) => x.code === 0).length, 1);
  check("losing overlapping acceptance is a claim conflict",
    claimRace.some((x) => x.error.includes("route_child_already_claimed")), true);
  check("overlapping acceptance creates exactly two claims total",
    one(`select count(*) from public.couranr_route_run_claims where request_id in ('${raceA.requestId}','${raceB.requestId}')`), "2");
  check("one overlapping route remains draft and one is accepted",
    one(`select string_agg(route_state,',' order by route_state) from public.couranr_route_runs where id in ('${routeOne}','${routeTwo}')`),
    "accepted,draft");

  // Acceptance vs ordinary submit: whichever takes the child row lock first
  // wins; a partial claim state is never committed.
  const srA = await child({ marker: "submit-race-a", value: 5000 });
  const srB = await child({ marker: "submit-race-b", value: 5000 });
  const submitRaceRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: submitRaceRoute, children: [srA.requestId, srB.requestId] }));
  const submitRace = await Promise.all([
    parallel(routeAccept({ business: biz, actor: owner, route: submitRaceRoute, key: randomUUID() })),
    parallel(`select id from public.couranr_submit_delivery_request_v2(
      '${srA.requestId}','${biz}',${srA.version},'${owner}',true
    )`),
  ]);
  check("route acceptance and standalone submit cannot both win",
    submitRace.filter((x) => x.code === 0).length, 1);
  const submitRaceState = one(`select route_state from public.couranr_route_runs where id='${submitRaceRoute}'`);
  const submitRaceClaims = one(`select count(*) from public.couranr_route_run_claims where route_run_id='${submitRaceRoute}'`);
  if (submitRaceState === "accepted") {
    check("accepted side of submit race owns both children", submitRaceClaims, "2");
    check("submit side lost to route claim", submitRace.some((x) => x.error.includes("route_child_claimed")), true);
  } else {
    check("submit-winning race leaves route completely unclaimed", submitRaceClaims, "0");
    check("accept side lost because child was no longer the frozen draft",
      submitRace.some((x) => x.error.includes("route_child_stale")), true);
  }

  const cancelA = await child({ marker: "cancel-a" });
  const cancelB = await child({ marker: "cancel-b" });
  const cancelRoute = randomUUID(), cancelKey = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: cancelRoute, children: [cancelA.requestId, cancelB.requestId] }));
  one(routeAccept({ business: biz, actor: owner, route: cancelRoute, key: randomUUID() }));
  check("Route acceptance explicitly approves the exact child quote",
    one(`select private.couranr_quote_payer_approved(q) from public.couranr_quote_versions q where q.id='${cancelA.quoteVersionId}'`), "t");
  const cancelled = JSON.parse(one(routeCancel({ business: biz, actor: owner, route: cancelRoute, key: cancelKey })));
  check("clean accepted Route cancels", [cancelled.state, cancelled.acceptedVersion, cancelled.stops.map((s) => s.claimed)],
    ["cancelled", 1, [false, false]]);
  check("cancellation releases exactly the accepted claims",
    one(`select count(*) from public.couranr_route_run_claims where route_run_id='${cancelRoute}'`), "0");
  check("cancellation preserves accepted and cancelled timestamps",
    one(`select accepted_at is not null and cancelled_at is not null from public.couranr_route_runs where id='${cancelRoute}'`), "t");
  check("cancellation appends history without changing accepted version",
    one(`select string_agg(command,',' order by created_at,id) from public.couranr_route_run_events where route_run_id='${cancelRoute}'`),
    "create_route_draft,accept_route_run,cancel_accepted_route");
  check("cancellation removes Route-derived payer approval",
    one(`select private.couranr_quote_payer_approved(q) from public.couranr_quote_versions q where q.id='${cancelA.quoteVersionId}'`), "f");
  check("old child quote can expire after cancelled Route",
    one(`select private.couranr_quote_version_is_expired(q,now()+interval '1 day') from public.couranr_quote_versions q where q.id='${cancelA.quoteVersionId}'`), "t");
  check("cancel replay returns the same result",
    JSON.parse(one(routeCancel({ business: biz, actor: owner, route: cancelRoute, key: cancelKey }))).state, "cancelled");
  refuses("second cancellation key conflicts",
    routeCancel({ business: biz, actor: owner, route: cancelRoute, key: randomUUID() }), "route_already_cancelled");
  refuses("cancelled Route cannot be accepted again",
    routeAccept({ business: biz, actor: owner, route: cancelRoute, key: randomUUID() }), "route_not_editable");
  check("cancelled child can be edited independently",
    one(`update public.couranr_delivery_requests set readiness_state='ready' where id='${cancelA.requestId}' returning readiness_state`), "ready");
  check("cancelled child remains a canonical draft",
    one(`select request_state from public.couranr_delivery_requests where id='${cancelA.requestId}'`), "draft");
  refuses("released Route quote cannot seed a draft payment obligation",
    obligationInsert(cancelB.requestId, "cancelled-route-illicit-obligation"), "route_child_quote_approval_released");
  check("cancellation creates no obligations, plans, deliveries or assignments",
    one(`select (select count(*) from public.couranr_payment_obligations)::text||','||
      (select count(*) from public.couranr_service_plans)::text||','||
      (select count(*) from public.couranr_deliveries)::text||','||
      (select count(*) from public.couranr_delivery_assignments)::text`), "0,0,0,0");

  const payA = await child({ marker: "payment-block-a" });
  const payB = await child({ marker: "payment-block-b" });
  const payRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: payRoute, children: [payA.requestId, payB.requestId] }));
  one(routeAccept({ business: biz, actor: owner, route: payRoute, key: randomUUID() }));
  one(obligationInsert(payA.requestId, "rr002-downstream-fixture"));
  refuses("payment obligation refuses pre-execution release",
    routeCancel({ business: biz, actor: owner, route: payRoute, key: randomUUID() }), "route_cancel_downstream_started");
  check("refused release is atomic and retains both claims",
    one(`select count(*) from public.couranr_route_run_claims where route_run_id='${payRoute}'`), "2");
  check("refused release appends no cancellation event",
    one(`select count(*) from public.couranr_route_run_events where route_run_id='${payRoute}' and command='cancel_accepted_route'`), "0");
  refuses("viewer cannot cancel accepted Route",
    routeCancel({ business: biz, actor: viewer, route: payRoute, key: randomUUID() }), "route_business_access_denied");
  refuses("authenticated cannot execute cancellation directly",
    `set role authenticated; ${routeCancel({ business: biz, actor: owner, route: payRoute, key: randomUUID() })}`,
    "permission denied");
  refuses("semantic cancellation rollback preserves historical Route",
    cancelRollback, "route_cancellation_rollback_refuses_semantic_history");

  const raceCancelA = await child({ marker: "cancel-race-a" });
  const raceCancelB = await child({ marker: "cancel-race-b" });
  const raceCancelRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: raceCancelRoute,
    children: [raceCancelA.requestId, raceCancelB.requestId] }));
  one(routeAccept({ business: biz, actor: owner, route: raceCancelRoute, key: randomUUID() }));
  const cancellationRace = await Promise.all([
    parallel(routeCancel({ business: biz, actor: owner, route: raceCancelRoute, key: randomUUID() })),
    parallel(routeCancel({ business: biz, actor: owner, route: raceCancelRoute, key: randomUUID() })),
  ]);
  check("two concurrent different-key cancellations have one winner",
    cancellationRace.filter((x) => x.code === 0).length, 1);
  check("losing concurrent cancellation is a stable conflict",
    cancellationRace.some((x) => x.error.includes("route_already_cancelled")), true);
  check("concurrent cancellation releases all claims once",
    one(`select count(*) from public.couranr_route_run_claims where route_run_id='${raceCancelRoute}'`), "0");
  check("concurrent cancellation appends exactly one event",
    one(`select count(*) from public.couranr_route_run_events where route_run_id='${raceCancelRoute}' and command='cancel_accepted_route'`), "1");

  const expiredA = await child({ marker: "expired-approval-a" });
  const expiredB = await child({ marker: "expired-approval-b" });
  const expiredRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: expiredRoute,
    children: [expiredA.requestId, expiredB.requestId] }));
  // Fixture-only clock shift: no production or runtime role can rewrite an
  // immutable quote. Replica mode is scoped to this single psql connection.
  one(`set session_replication_role=replica;
    update public.couranr_quote_versions set created_at=now()-interval '16 minutes'
      where id='${expiredA.quoteVersionId}';
    set session_replication_role=origin;`);
  refuses("expired unaccepted Route quote cannot become payer approval",
    routeAccept({ business: biz, actor: owner, route: expiredRoute, key: randomUUID() }),
    "route_child_quote_expired");
  check("expired refusal creates no obligation or child claim",
    one(`select (select count(*) from public.couranr_route_run_claims where route_run_id='${expiredRoute}')::text||','||
      (select count(*) from public.couranr_payment_obligations where request_id='${expiredA.requestId}')::text`),
    "0,0");

  const artifactRaceA = await child({ marker: "artifact-race-a" });
  const artifactRaceB = await child({ marker: "artifact-race-b" });
  const artifactRaceRoute = randomUUID();
  one(routeSave({ business: biz, actor: owner, route: artifactRaceRoute,
    children: [artifactRaceA.requestId, artifactRaceB.requestId] }));
  one(routeAccept({ business: biz, actor: owner, route: artifactRaceRoute, key: randomUUID() }));
  const artifactRace = await Promise.all([
    parallel(routeCancel({ business: biz, actor: owner, route: artifactRaceRoute, key: randomUUID() })),
    parallel(obligationInsert(artifactRaceA.requestId, "cancel-artifact-race")),
  ]);
  check("cancellation and first Route payment artifact cannot both win",
    artifactRace.filter((x) => x.code === 0).length, 1);
  const artifactRaceState = one(`select route_state from public.couranr_route_runs where id='${artifactRaceRoute}'`);
  if (artifactRaceState === "cancelled") {
    check("cancel-winning race leaves no payment artifact",
      one(`select count(*) from public.couranr_payment_obligations where request_id='${artifactRaceA.requestId}'`), "0");
    check("late payment entry observes released approval",
      artifactRace.some((x) => x.error.includes("route_child_quote_approval_released")), true);
  } else {
    check("payment-winning race keeps both claims",
      one(`select count(*) from public.couranr_route_run_claims where route_run_id='${artifactRaceRoute}'`), "2");
    check("late cancellation observes downstream authority",
      artifactRace.some((x) => x.error.includes("route_cancel_downstream_started")), true);
  }

  check("claim table has RLS enabled",
    one("select relrowsecurity from pg_class where oid='public.couranr_route_run_claims'::regclass"), "t");
  refuses("anon cannot read accepted Route claims",
    "set role anon; select * from public.couranr_route_run_claims", "permission denied");
  refuses("authenticated cannot execute acceptance directly",
    `set role authenticated; ${routeAccept({ business: biz, actor: owner, route: acceptedRoute, key: acceptKey })}`,
    "permission denied");

  const listed = JSON.parse(one(`select public.couranr_list_route_runs('${biz}','${owner}')`));
  check("Route list includes accepted route", listed.some((x) => x.routeRunId === acceptedRoute && x.state === "accepted"), true);
  check("Route list includes archived route", listed.some((x) => x.routeRunId === archiveRoute && x.state === "abandoned"), true);
  check("Route list distinguishes cancelled from archived",
    listed.some((x) => x.routeRunId === cancelRoute && x.state === "cancelled"), true);

  refuses("RR-002 rollback refuses after accepted/archive/value semantic history",
    rollback, "route_run_acceptance_rollback_refuses_semantic_use");
  check("failed RR-002 rollback preserves accepted route",
    one(`select route_state from public.couranr_route_runs where id='${acceptedRoute}'`), "accepted");

  console.log(`Route Run Acceptance: ${checks} checks PASS (disposable PostgreSQL; no providers).`);
} catch (error) {
  try {
    const log = readFileSync(resolve(process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable", "log/pg.log"), "utf8");
    console.error(log.slice(-6000));
  } catch {}
  throw error;
} finally {
  down({ quiet: true });
}
