/**
 * EXECUTION VERIFICATION for the CUS-004 resolve_report bookkeeping fix:
 *   20260908160000_couranr_customer_problem_resolve_bookkeeping
 *
 * couranr_transition_customer_problem_report only updated the Delivery Help
 * conversation on request_evidence, so resolving a report left it with
 * waiting_on='couranr', awaiting_reply_kind='customer' and
 * first_couranr_response_at IS NULL — and refreshDueStates (which ages every
 * open thread whose first Couranr response is unrecorded) kept aging the closed
 * case. A migration applying proves it parses; only CALLING the command against
 * a real report + conversation proves the bookkeeping is corrected.
 *
 *   PR-1  reported -> resolve_report: stamps first_couranr_response_at, clears
 *         waiting_on and awaiting_reply_kind, and the case is no longer agable
 *         by the refreshDueStates predicate
 *   PR-2  under_review -> resolve_report behaves the same (start_review itself
 *         leaves the conversation untouched, as before)
 *   PR-3  request_evidence still transfers the turn to the customer
 *   PR-4  an already-recorded first Operations response is preserved (coalesce),
 *         and resolve still clears the customer turn
 *   PR-5  no customer authority widened — service_role only
 *   PR-6  POSITIVE CONTROL: the pre-fix (rollback) body leaves resolve's
 *         conversation still couranr-owed and agable
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { up, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const one = (sql) => psql(sql).trim();
const esc = (s) => String(s).replace(/'/g, "''");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const uniq = () => crypto.randomUUID().slice(0, 8);
function ok(id, label, got) { pass += 1; console.log(`  PASS  ${id}  ${label}${got === undefined ? "" : `  [${got}]`}`); }
function bad(id, label, got) { fail += 1; console.log(`  FAIL  ${id}  ${label}  [${got}]`); }
function eq(id, label, got, want) { String(got) === String(want) ? ok(id, label, got) : bad(id, label, `got ${got}, want ${want}`); }

const FN = "public.couranr_transition_customer_problem_report(uuid,integer,uuid,text)";
const convCol = (conv, col) =>
  one(`select coalesce(${col}::text,'NULL') from public.couranr_conversations where id='${conv}'`);
const isSet = (v) => (v !== "NULL" ? "set" : "NULL");
// Replica of the refreshDueStates eligibility filter: an open thread with a
// received_at and no recorded first Couranr response is what gets aged.
const agable = (conv) =>
  one(`select (first_couranr_response_at is null and status not in ('resolved','closed') and received_at is not null)::text
         from public.couranr_conversations where id='${conv}'`);
const reportState = (rid) => one(`select report_state from public.couranr_customer_problem_reports where id='${rid}'`);
const reportVersion = (rid) => Number(one(`select version from public.couranr_customer_problem_reports where id='${rid}'`));
const transition = (rid, ver, ops, cmd) =>
  one(`select (public.couranr_transition_customer_problem_report('${rid}',${ver},'${ops}','${cmd}')).version`);

function seedAdmin() {
  const m = uniq();
  const id = one(`insert into auth.users (email) values ('ops-${m}@couranr.invalid') returning id`);
  psql(`insert into public.profiles (id,email,role) values ('${id}','ops-${m}@couranr.invalid','admin')
        on conflict (id) do update set role='admin'`);
  return id;
}

async function main() {
  up();
  const t = psqlTransport(psql);
  try {
    console.log("\n  CUS-004 resolve_report conversation bookkeeping — execution verification\n");

    const businessId = one(
      `insert into public.business_accounts (name,status) values ('[PRBK] ${uniq()}','active') returning id`);
    const merchant = one(`insert into auth.users (email) values ('mer-${uniq()}@couranr.invalid') returning id`);
    const ops = seedAdmin();

    // Drive delivery -> help token -> redeem -> save draft -> submit == a real
    // 'reported' report on a Delivery Help conversation that Couranr owes.
    async function seedReportedCase() {
      const marker = `prbk-${uniq()}`;
      const chain = await seedCanonicalDeliveryChain(t, {
        businessId, actorUserId: merchant, marker,
        recipientName: "pr recipient", pricingPolicyVersion: "couranr-pricing-v2-2026-09-01",
        // The Mapbox cutover retired google_routes_v2 as a mint authority; state
        // the current one so the shared fixture's quote mint is accepted.
        distanceSource: "mapbox_directions_v5",
      });
      const raw = crypto.randomBytes(32).toString("base64url");
      const tokenId = one(`select public.couranr_issue_help_token('${chain.deliveryId}','${sha256(raw)}',1)`);
      const conv = one(`select out_conversation_id from public.couranr_redeem_help_token('${sha256(raw)}')`);
      const reportId = one(
        `select (public.couranr_save_customer_problem_draft('${tokenId}','damaged','${esc("package damaged in transit")}')).id`);
      const version = Number(one(
        `select (public.couranr_submit_customer_problem_report('${tokenId}','${reportId}','idem-${marker}')).version`));
      return { conv, reportId, version };
    }

    /* ── PR-1: reported -> resolve ── */
    const c1 = await seedReportedCase();
    eq("PR-1 setup", "after submit: couranr-owed, no first response, agable",
       `${convCol(c1.conv, "waiting_on")}|${isSet(convCol(c1.conv, "first_couranr_response_at"))}|${agable(c1.conv)}`,
       "couranr|NULL|true");
    transition(c1.reportId, c1.version, ops, "resolve_report");
    eq("PR-1a", "resolve stamps first_couranr_response_at", isSet(convCol(c1.conv, "first_couranr_response_at")), "set");
    eq("PR-1b", "resolve clears waiting_on", convCol(c1.conv, "waiting_on"), "NULL");
    eq("PR-1c", "resolve clears awaiting_reply_kind", convCol(c1.conv, "awaiting_reply_kind"), "NULL");
    eq("PR-1d", "resolved case is no longer agable by refreshDueStates", agable(c1.conv), "false");
    eq("PR-1e", "report is resolved", reportState(c1.reportId), "resolved");
    eq("PR-1f", "conversation status is NOT closed (other topics may remain)",
       convCol(c1.conv, "status"), "open");

    /* ── PR-2: under_review -> resolve ── */
    const c2 = await seedReportedCase();
    const v2 = Number(transition(c2.reportId, c2.version, ops, "start_review")); // reported -> under_review
    eq("PR-2 setup", "start_review leaves the conversation couranr-owed & agable",
       `${convCol(c2.conv, "waiting_on")}|${agable(c2.conv)}`, "couranr|true");
    transition(c2.reportId, v2, ops, "resolve_report");
    eq("PR-2a", "under_review -> resolve clears the turn and stops aging",
       `${convCol(c2.conv, "waiting_on")}|${convCol(c2.conv, "awaiting_reply_kind")}|${agable(c2.conv)}`, "NULL|NULL|false");

    /* ── PR-3: request_evidence still transfers to the customer ── */
    const c3 = await seedReportedCase();
    transition(c3.reportId, c3.version, ops, "request_evidence"); // reported -> awaiting_evidence
    eq("PR-3a", "request_evidence transfers the turn to the customer", convCol(c3.conv, "waiting_on"), "customer");
    eq("PR-3b", "request_evidence stamps the first response", isSet(convCol(c3.conv, "first_couranr_response_at")), "set");
    eq("PR-3c", "request_evidence clears awaiting_reply_kind", convCol(c3.conv, "awaiting_reply_kind"), "NULL");

    /* ── PR-4: first response preserved across resolve ── */
    const c4 = await seedReportedCase();
    const v4a = Number(transition(c4.reportId, c4.version, ops, "request_evidence")); // stamps T1, waiting_on=customer
    const t1 = convCol(c4.conv, "first_couranr_response_at");
    one(`select pg_sleep(0.05)`); // ensure a later now() so an overwrite would be visible
    transition(c4.reportId, v4a, ops, "resolve_report"); // awaiting_evidence -> resolved
    eq("PR-4a", "first response is preserved across resolve (coalesce, not overwritten)",
       convCol(c4.conv, "first_couranr_response_at"), t1);
    eq("PR-4b", "resolve from awaiting_evidence clears the customer turn", convCol(c4.conv, "waiting_on"), "NULL");

    /* ── PR-5: authority unchanged ── */
    eq("PR-5", "anon/authenticated hold no EXECUTE; service_role only",
       one(`select has_function_privilege('anon','${FN}','EXECUTE')||','||has_function_privilege('authenticated','${FN}','EXECUTE')||','||has_function_privilege('service_role','${FN}','EXECUTE')`),
       "false,false,true");

    /* ── PR-6: POSITIVE CONTROL — the pre-fix body leaves resolve aging ── */
    psql(readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260908160000_couranr_customer_problem_resolve_bookkeeping.rollback.sql"),
      "utf8"));
    const c6 = await seedReportedCase();
    transition(c6.reportId, c6.version, ops, "resolve_report");
    eq("PR-6", "pre-fix body leaves the resolved conversation couranr-owed & agable",
       `${convCol(c6.conv, "waiting_on")}|${agable(c6.conv)}`, "couranr|true");

    console.log(`\n  resolve_report bookkeeping: ${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
