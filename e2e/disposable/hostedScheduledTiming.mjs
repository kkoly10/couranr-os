/**
 * EXECUTION VERIFICATION — hosted scheduled timing (TMZ-001 parity for
 * the merchant-hosted customer flow, /request/[merchantSlug]).
 *
 * 20260908220000 gives the two hosted SQL commands the four timing parameters
 * and the SAME private.couranr_assert_requested_timing the business and
 * consumer commands call, and freezes the customer's own words on the intake
 * row. A text scan cannot prove any of that runs; only CALLING it can. On a
 * real Postgres (full migration sequence, fence included = POSTDEPLOY):
 *
 *   HT-1  scheduled customer submit: two-sided instant accepted; the request
 *         row AND the intake evidence carry the statement; the event says so
 *   HT-2  a canonical instant that does not match the local words -> CR422
 *   HT-3  scheduled with no local words -> CR422 scheduled_timing_incomplete
 *   HT-4  an intent outside the vocabulary -> CR422 timing_intent_invalid
 *   HT-5  a DST-gap claim is accepted as an unresolved instant; a FALSE such
 *         claim is rejected
 *   HT-6  ASAP persists with no instant, and the intake says asap
 *   HT-7  the customer's timing statement on the intake is IMMUTABLE once the
 *         request exists (trigger), and the strict create is idempotent per
 *         intake (a second submit returns the same request)
 *   HT-8  merchant validation that CONFIRMS the customer's schedule keeps it
 *         on the row and mints the immutable quote against it
 *   HT-9  merchant validation may ADJUST the time: the row carries the
 *         confirmed words + instant, the intake keeps the customer's words
 *   HT-10 merchant validation with a mismatched instant -> CR422
 *   HT-11 merchant validation may switch a scheduled request to ASAP; the
 *         customer's original statement survives on the intake
 *   HT-12 POSTDEPLOY: only the strict arities exist; the old 13/26-argument
 *         shapes are 42883, not a policy refusal
 *   HT-13 PREDEPLOY (fence rolled back): both arities live; the OLD shape
 *         still creates an ASAP request exactly as production does today;
 *         re-applying the fence closes the window again
 *   HT-14 the forward rollback HARD-REFUSES while scheduled evidence exists
 *   HT-15 on a fresh database (no evidence) the forward rollback runs, runs AGAIN
 *         (re-runnable: the evidence guard tolerates absent columns), restores
 *         the v1 arities, and the forward migration + fence re-apply cleanly
 *
 * Postgres only — no PostgREST. The PostgREST resolution proof for the same
 * arities is e2e/disposable/hostedDeployCutover.mjs.
 */
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { up, psql } from "./up.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FENCE = path.join(ROOT, "supabase/migrations/20260908230000_couranr_hosted_legacy_arity_fence.sql");
const FENCE_RB = path.join(ROOT, "supabase/rollbacks/20260908230000_couranr_hosted_legacy_arity_fence.rollback.sql");
const FORWARD_RB = path.join(ROOT, "supabase/rollbacks/20260908220000_couranr_hosted_scheduled_timing.rollback.sql");
const FORWARD = path.join(ROOT, "supabase/migrations/20260908220000_couranr_hosted_scheduled_timing.sql");
const GUARD = path.join(ROOT, "supabase/migrations/20260908220500_couranr_hosted_legacy_validate_guard.sql");

let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const jsonLit = (v) => `'${esc(JSON.stringify(v))}'::jsonb`;
function ok(id, l, g) { pass += 1; console.log(`  PASS  ${id}  ${l}${g === undefined ? "" : `  [${g}]`}`); }
function bad(id, l, g) { fail += 1; console.log(`  FAIL  ${id}  ${l}  [${g}]`); }
function eq(id, l, g, w) { String(g) === String(w) ? ok(id, l, g) : bad(id, l, `got ${g}, want ${w}`); }
/** Run a statement expecting an error; return "SQLSTATE|message". */
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  return psql(
    `create temp table _p(code text, msg text);
     do $probe$ begin perform ( ${body} ); insert into _p values ('NO_ERROR','');
     exception when others then insert into _p values (SQLSTATE, SQLERRM); end $probe$;
     select code || '|' || msg from _p;`
  ).trim();
}
/** Run a DML statement (not a query) expecting an error; return "SQLSTATE|message". */
function raisesStmt(sql) {
  const body = sql.replace(/;\s*$/, "");
  return psql(
    `create temp table _p(code text, msg text);
     do $probe$ begin ${body}; insert into _p values ('NO_ERROR','');
     exception when others then insert into _p values (SQLSTATE, SQLERRM); end $probe$;
     select code || '|' || msg from _p;`
  ).trim();
}
/** Apply a migration/rollback file with the same psql -f invocation up() uses. */
function applyFile(file) {
  const pgbin = process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin";
  const pgport = process.env.COURANR_DISPOSABLE_PORT || "55432";
  return execFileSync(path.join(pgbin, "psql"), [
    "-h", "127.0.0.1", "-p", String(pgport), "-U", "postgres", "-d", "couranr_disposable",
    "-q", "-v", "ON_ERROR_STOP=1", "-f", file,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function applyFileExpectingFailure(file) {
  try { applyFile(file); return "NO_ERROR"; }
  catch (e) { return String(e.stderr ?? e.message); }
}
const arities = (fn) =>
  one(`select coalesce(string_agg(distinct pronargs::text,',' order by pronargs::text),'-')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='${fn}'`);

/** The DB's own America/New_York derivation of local words — the two-sided partner. */
const instantOf = (local) => `('${esc(local.replace("T", " "))}'::timestamp at time zone 'America/New_York')`;

const BUSINESS = "41111111-1111-4111-8111-111111111111";
const OWNER = "42222222-2222-4222-8222-222222222222";
const SLUG = "hst-disposable-shop";
const PICKUP_PLACE = "hst-pickup-place";
const PICKUP = {
  googlePlaceId: PICKUP_PLACE, formattedAddress: "1 Main St, Stafford, VA 22554, USA",
  line1: "1 Main St", line2: null, city: "Stafford", region: "VA", postalCode: "22554",
  countryCode: "US", latitude: 38.42, longitude: -77.41, addressSource: "google_places_new", instructions: null,
};
const dropoff = (pid) => ({
  googlePlaceId: pid, formattedAddress: "9 Receive Ct, Woodbridge, VA 22191, USA",
  line1: "9 Receive Ct", line2: null, city: "Woodbridge", region: "VA", postalCode: "22191",
  countryCode: "US", latitude: 38.658, longitude: -77.25, addressSource: "google_places_new", instructions: null,
});
const POLICY = "couranr-pricing-v2-2026-09-01";
const LINE_ITEMS = [{ code: "delivery_base", label: "Delivery", amountCents: 2299 }];

function seedMerchant() {
  psql(`insert into auth.users(id,email) values ('${OWNER}','hst-owner@example.test');
        insert into public.business_accounts(id,name,slug,created_by)
          values ('${BUSINESS}','[HST] disposable shop','${SLUG}','${OWNER}');
        insert into public.business_members(business_account_id,user_id,role,status)
          values ('${BUSINESS}','${OWNER}','owner','active');
        insert into public.couranr_merchant_workspaces
          (business_account_id,created_by,idempotency_key,business_category,
           pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at)
        values ('${BUSINESS}','${OWNER}','hst-ws-${crypto.randomUUID()}','general_local_business',
          ${jsonLit(PICKUP)},'540-555-0100','merchant','v1',now());
        insert into public.couranr_workspace_activations
          (business_account_id,activation_state,reviewed_at,reviewed_by)
        values ('${BUSINESS}','live',now(),'${OWNER}');
        insert into public.couranr_website_tool_configs(business_account_id,status,updated_by)
        values ('${BUSINESS}','published','${OWNER}');`);
}

function newIntake() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return one(`select id from public.couranr_create_hosted_request_intake(
    p_slug := '${SLUG}', p_token_hash := '${sha256(raw)}', p_ttl_minutes := 1440)`);
}

/** Timing args: intent, local words, canonical instant (SQL expr or null), reasons. */
function timingArgs({ intent = "asap", local = null, instantSql = "null::timestamptz", reasons = [] } = {}) {
  return `
    p_timing_intent := ${intent === null ? "null::text" : `'${esc(intent)}'`},
    p_requested_pickup_local := ${local === null ? "null::text" : `'${esc(local)}'`},
    p_requested_departure_at := ${instantSql},
    p_timing_review_reasons := ${jsonLit(reasons)}`;
}
/** The customer-side facts every create shares (13 old-arity keys). */
function customerArgs(intakeId, destinationPlace) {
  return `
    p_intake_id := '${intakeId}'::uuid,
    p_order_reference := 'ORDER-42', p_requested_payer_type := 'customer',
    p_destination_place_id := '${destinationPlace}', p_destination_label := '9 Receive Ct, Woodbridge, VA',
    p_recipient_name := 'Rae Recipient', p_recipient_phone := '+15715550188', p_recipient_email := null::text,
    p_weight_lb := null::numeric, p_weight_band := '0_25_lb',
    p_customer_restricted_class := 'none', p_signature_requested := false,
    p_shipment_description := 'one boxed lamp'`;
}
/** STRICT create (17 args). */
function create(intakeId, timing, destinationPlace = `hst-drop-${crypto.randomUUID().slice(0, 8)}`) {
  return `select id from public.couranr_create_hosted_delivery_request(
    ${customerArgs(intakeId, destinationPlace)},
    ${timingArgs(timing)})`;
}
/** OLD create (13 args) — the exact shape the deployed application sends today. */
function oldCreate(intakeId, destinationPlace = `hst-old-${crypto.randomUUID().slice(0, 8)}`) {
  return `select id from public.couranr_create_hosted_delivery_request(
    ${customerArgs(intakeId, destinationPlace)})`;
}
/** The merchant-side facts every validate shares (26 old-arity keys). */
function merchantArgs(requestId, version, destinationPlace) {
  return `
    p_request_id := '${requestId}'::uuid, p_host_business_account_id := '${BUSINESS}'::uuid,
    p_expected_version := ${version}, p_actor_user_id := '${OWNER}'::uuid,
    p_payer_type := 'customer', p_weight_lb := null::numeric, p_weight_band := '0_25_lb',
    p_restricted_class := 'none', p_signature_required := false,
    p_pickup_address := ${jsonLit(PICKUP)}, p_dropoff_address := ${jsonLit(dropoff(destinationPlace))},
    p_route_distance_meters := ${Math.round(5 * 1609.344)}, p_route_duration_seconds := 600,
    p_route_static_duration_seconds := 600, p_route_traffic_delay_seconds := 0,
    p_distance_source := 'mapbox_directions_v5', p_serviceability_outcome := 'available_for_request',
    p_route_review_reason := null::text,
    p_quote_status := 'estimated', p_pricing_policy_version := '${POLICY}',
    p_delivery_subtotal_cents := 2299, p_included_loaded_miles := 2, p_billable_loaded_miles := (3)::numeric,
    p_quote_line_items := ${jsonLit(LINE_ITEMS)}, p_review_reasons := '[]'::jsonb`;
}
/** STRICT validate (29 args). */
function validate(requestId, version, destinationPlace, timing) {
  return `select id from public.couranr_validate_hosted_delivery_request(
    ${merchantArgs(requestId, version, destinationPlace)},
    ${timingArgs(timing)})`;
}
/** OLD validate (26 args). */
function oldValidate(requestId, version, destinationPlace) {
  return `select id from public.couranr_validate_hosted_delivery_request(
    ${merchantArgs(requestId, version, destinationPlace)},
    p_timing_review_reasons := '[]'::jsonb)`;
}
const col = (id, c) => one(`select coalesce(${c}::text,'NULL') from public.couranr_delivery_requests where id='${id}'`);
const intakeCol = (intakeId, c) => one(`select coalesce(${c}::text,'NULL') from public.couranr_hosted_request_intakes where id='${intakeId}'`);
const timingOf = (id) => `${col(id, "timing_intent")}|${col(id, "requested_pickup_local")}|${col(id, "requested_departure_at")}`;
const destinationOf = (intakeId) => intakeCol(intakeId, "destination_place_id");

function main() {
  up();
  console.log("\n  hosted scheduled timing — execution verification (TMZ-001 parity)\n");
  seedMerchant();

  const LOCAL = "2027-03-10T10:30"; // an ordinary Wednesday inside the operating window
  const LATER = "2027-03-10T11:00"; // the merchant's adjustment in HT-9
  const CREATE_FN = "couranr_create_hosted_delivery_request";
  const VALIDATE_FN = "couranr_validate_hosted_delivery_request";

  /* ── HT-1: scheduled customer submit, two-sided instant ── */
  const i1 = newIntake();
  const r1 = one(create(i1, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  eq("HT-1a", "timing_intent persisted as scheduled", col(r1, "timing_intent"), "scheduled");
  eq("HT-1b", "the customer's local words are preserved verbatim on the request", col(r1, "requested_pickup_local"), LOCAL);
  eq("HT-1c", "the canonical instant equals the DB's own America/New_York derivation",
     one(`select (requested_departure_at = ${instantOf(LOCAL)})::text from public.couranr_delivery_requests where id='${r1}'`), "true");
  eq("HT-1d", "operating_timezone is America/New_York", col(r1, "operating_timezone"), "America/New_York");
  eq("HT-1e", "the request is still a hosted consumer request awaiting merchant confirmation",
     `${col(r1, "requester_kind")}|${col(r1, "source")}|${col(r1, "request_state")}|${col(r1, "quote_status")}`,
     "consumer|hosted_request|awaiting_merchant_confirmation|not_quoted");
  eq("HT-1f", "the INTAKE freezes the customer's own statement",
     `${intakeCol(i1, "customer_timing_intent")}|${intakeCol(i1, "customer_requested_pickup_local")}`, `scheduled|${LOCAL}`);
  eq("HT-1g", "the create event records the timing statement",
     one(`select (metadata->>'timingIntent') || '|' || (metadata->>'requestedPickupLocal')
            from public.couranr_delivery_request_events
           where request_id='${r1}' and command='create_hosted_delivery_request'`), `scheduled|${LOCAL}`);

  /* ── HT-2: a mismatched instant is refused (two-sided rule) ── */
  eq("HT-2", "instant that does not match the local words -> CR422 requested_departure_mismatch",
     raises(create(newIntake(), { intent: "scheduled", local: LOCAL, instantSql: instantOf("2027-03-10T11:30") })),
     "CR422|requested_departure_mismatch");

  /* ── HT-3: scheduled with no local words ── */
  eq("HT-3", "scheduled without local words -> CR422 scheduled_timing_incomplete",
     raises(create(newIntake(), { intent: "scheduled", local: null })), "CR422|scheduled_timing_incomplete");

  /* ── HT-4: intent outside the vocabulary ── */
  eq("HT-4a", "an unknown intent -> CR422 timing_intent_invalid",
     raises(create(newIntake(), { intent: "tomorrow" })), "CR422|timing_intent_invalid");
  eq("HT-4b", "a NULL intent -> CR422 timing_intent_invalid (the hosted command never defaults it)",
     raises(create(newIntake(), { intent: null })), "CR422|timing_intent_invalid");

  /* ── HT-5: DST spring-forward gap (2027-03-14 02:00->03:00 ET) ── */
  const GAP = "2027-03-14T02:30";
  const i5 = newIntake();
  const r5 = one(create(i5, { intent: "scheduled", local: GAP, instantSql: "null::timestamptz", reasons: ["requested_time_nonexistent"] }));
  eq("HT-5a", "a genuine DST-gap claim is accepted with NO instant (unresolved, for review)", timingOf(r5), `scheduled|${GAP}|NULL`);
  eq("HT-5b", "the review reason is persisted",
     one(`select (timing_review_reasons ? 'requested_time_nonexistent')::text from public.couranr_delivery_requests where id='${r5}'`), "true");
  eq("HT-5c", "a FALSE nonexistent claim for an ordinary time is rejected",
     raises(create(newIntake(), { intent: "scheduled", local: LOCAL, instantSql: "null::timestamptz", reasons: ["requested_time_nonexistent"] })),
     "CR422|nonexistent_time_claim_rejected");

  /* ── HT-6: ASAP ── */
  const i6 = newIntake();
  const r6 = one(create(i6, { intent: "asap" }));
  eq("HT-6a", "ASAP persists with no local words and no instant", timingOf(r6), "asap|NULL|NULL");
  eq("HT-6b", "the intake records the customer asked for asap",
     `${intakeCol(i6, "customer_timing_intent")}|${intakeCol(i6, "customer_requested_pickup_local")}`, "asap|NULL");

  /* ── HT-7: intake evidence is immutable; create is idempotent per intake ── */
  eq("HT-7a", "rewriting the customer's timing statement after submit -> CR409 (trigger)",
     raisesStmt(`update public.couranr_hosted_request_intakes set customer_timing_intent='asap' where id='${i1}'`),
     "CR409|hosted_intake_identity_is_immutable");
  eq("HT-7b", "rewriting the customer's local words after submit -> CR409 (trigger)",
     raisesStmt(`update public.couranr_hosted_request_intakes set customer_requested_pickup_local='${LATER}' where id='${i1}'`),
     "CR409|hosted_intake_identity_is_immutable");
  eq("HT-7c", "a second submit on the same intake returns the SAME request (idempotent), even with different timing",
     one(create(i1, { intent: "asap" })), r1);
  eq("HT-7d", "... and the stored statement is untouched by the replay", timingOf(r1), `scheduled|${LOCAL}|${col(r1, "requested_departure_at")}`);

  /* ── HT-8: merchant validation CONFIRMS the customer's schedule ── */
  const v1 = Number(col(r1, "version"));
  one(validate(r1, v1, destinationOf(i1), { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  eq("HT-8a", "validation moved the request into Couranr review with a minted quote",
     `${col(r1, "request_state")}|${col(r1, "quote_status")}|${col(r1, "delivery_subtotal_cents")}`, "pending_couranr_review|estimated|2299");
  eq("HT-8b", "the confirmed schedule is on the row", `${col(r1, "timing_intent")}|${col(r1, "requested_pickup_local")}`, `scheduled|${LOCAL}`);
  eq("HT-8c", "the immutable quote snapshot was minted AGAINST the confirmed schedule",
     one(`select (q.shipment_snapshot->'timing'->>'intent') || '|' || (q.shipment_snapshot->'timing'->>'requestedPickupLocal')
            from public.couranr_quote_versions q join public.couranr_delivery_requests r on r.current_quote_version_id=q.id
           where r.id='${r1}'`), `scheduled|${LOCAL}`);
  eq("HT-8d", "the validate event carries both the confirmed and the customer's statement",
     one(`select (metadata->>'timingIntent') || '|' || (metadata->>'requestedPickupLocal') || '|' || (metadata->>'customerTimingIntent') || '|' || (metadata->>'customerRequestedPickupLocal')
            from public.couranr_delivery_request_events
           where request_id='${r1}' and command='validate_hosted_delivery_request'`), `scheduled|${LOCAL}|scheduled|${LOCAL}`);

  /* ── HT-9: merchant validation ADJUSTS the time ── */
  const i9 = newIntake();
  const r9 = one(create(i9, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  one(validate(r9, Number(col(r9, "version")), destinationOf(i9), { intent: "scheduled", local: LATER, instantSql: instantOf(LATER) }));
  eq("HT-9a", "the row carries the merchant-confirmed words and matching instant",
     `${col(r9, "requested_pickup_local")}|${one(`select (requested_departure_at = ${instantOf(LATER)})::text from public.couranr_delivery_requests where id='${r9}'`)}`,
     `${LATER}|true`);
  eq("HT-9b", "the intake still says what the CUSTOMER asked for",
     `${intakeCol(i9, "customer_timing_intent")}|${intakeCol(i9, "customer_requested_pickup_local")}`, `scheduled|${LOCAL}`);
  eq("HT-9c", "the quote snapshot names the confirmed time, not the requested one",
     one(`select q.shipment_snapshot->'timing'->>'requestedPickupLocal'
            from public.couranr_quote_versions q join public.couranr_delivery_requests r on r.current_quote_version_id=q.id
           where r.id='${r9}'`), LATER);

  /* ── HT-10: merchant validation with a mismatched instant ── */
  const i10 = newIntake();
  const r10 = one(create(i10, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  eq("HT-10", "validation with an instant that does not match the words -> CR422, nothing minted",
     `${raises(validate(r10, Number(col(r10, "version")), destinationOf(i10), { intent: "scheduled", local: LOCAL, instantSql: instantOf(LATER) }))}|${col(r10, "quote_status")}`,
     "CR422|requested_departure_mismatch|not_quoted");

  /* ── HT-11: merchant switches a scheduled request to ASAP ── */
  const i11 = newIntake();
  const r11 = one(create(i11, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  one(validate(r11, Number(col(r11, "version")), destinationOf(i11), { intent: "asap" }));
  eq("HT-11a", "the row is asap with no words and no instant", timingOf(r11), "asap|NULL|NULL");
  eq("HT-11b", "the customer's original schedule survives on the intake",
     `${intakeCol(i11, "customer_timing_intent")}|${intakeCol(i11, "customer_requested_pickup_local")}`, `scheduled|${LOCAL}`);

  /* ── HT-12: POSTDEPLOY — strict arities only ── */
  eq("HT-12a", "postdeploy: only the strict arities exist (create 17, validate 29)", `${arities(CREATE_FN)}/${arities(VALIDATE_FN)}`, "17/29");
  eq("HT-12b", "the OLD 13-argument create shape is 42883 (function does not exist), not a policy refusal",
     raises(oldCreate(newIntake())).split("|")[0], "42883");
  eq("HT-12c", "the OLD 26-argument validate shape is 42883 too",
     raises(oldValidate(r10, Number(col(r10, "version")), destinationOf(i10))).split("|")[0], "42883");

  /* ── HT-13: PREDEPLOY — roll the fence back, both arities live ── */
  applyFile(FENCE_RB);
  eq("HT-13a", "predeploy: both arities live (create 13,17; validate 26,29)", `${arities(CREATE_FN)}/${arities(VALIDATE_FN)}`, "13,17/26,29");
  const i13 = newIntake();
  const r13 = one(oldCreate(i13));
  eq("HT-13b", "PREDEPLOY: the OLD application's exact shape still creates an ASAP request — production behaviour, zero downtime",
     `${timingOf(r13)}|${col(r13, "request_state")}`, "asap|NULL|NULL|awaiting_merchant_confirmation");
  eq("HT-13c", "... and records NO customer timing statement (the old application never states one)",
     `${intakeCol(i13, "customer_timing_intent")}|${intakeCol(i13, "customer_requested_pickup_local")}`, "NULL|NULL");
  one(oldValidate(r13, Number(col(r13, "version")), destinationOf(i13)));
  eq("HT-13d", "PREDEPLOY: the OLD validate shape still mints (asap), exactly as today", `${col(r13, "quote_status")}|${col(r13, "timing_intent")}`, "estimated|asap");
  const i13s = newIntake();
  const r13s = one(create(i13s, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  eq("HT-13e", "PREDEPLOY: the NEW shape resolves to the strict arity in the same window", timingOf(r13s).split("|").slice(0, 2).join("|"), `scheduled|${LOCAL}`);
  /* The deploy-gap guard (20260908220500): a still-serving OLD application must
     not be able to rewrite a scheduled statement to asap through the legacy
     26-argument validate. It is refused, and the row is untouched. */
  eq("HT-13h", "PREDEPLOY: the OLD validate shape on a SCHEDULED row is refused — never a fabricated ASAP",
     `${raises(oldValidate(r13s, Number(col(r13s, "version")), destinationOf(i13s)))}|${timingOf(r13s).split("|").slice(0, 2).join("|")}|${col(r13s, "quote_status")}`,
     `CR409|hosted_scheduled_timing_requires_current_application|scheduled|${LOCAL}|not_quoted`);
  applyFile(FENCE);
  eq("HT-13f", "re-applying the fence closes the window: strict arities only", `${arities(CREATE_FN)}/${arities(VALIDATE_FN)}`, "17/29");
  eq("HT-13g", "the fence is re-runnable", applyFileExpectingFailure(FENCE), "NO_ERROR");

  /* ── HT-14: the forward rollback refuses while evidence exists ── */
  const rb = applyFileExpectingFailure(FORWARD_RB);
  eq("HT-14a", "the forward rollback HARD-REFUSES with scheduled evidence present", /hosted scheduled-timing evidence exists/.test(rb), true);
  eq("HT-14b", "... and left the strict arities and evidence columns in place",
     `${arities(CREATE_FN)}/${arities(VALIDATE_FN)}|${one(`select count(*) from information_schema.columns where table_schema='public' and table_name='couranr_hosted_request_intakes' and column_name in ('customer_timing_intent','customer_requested_pickup_local')`)}`,
     "17/29|2");

  /* ── HT-15: full rollback round trip on a FRESH database (no evidence) ──
     A second up() re-initialises the disposable cluster with every migration
     applied and no hosted rows, which is the only state the forward rollback
     is allowed to run in. Nothing is deleted from the evidence-bearing DB. */
  up({ quiet: true });
  eq("HT-15a", "with no evidence the forward rollback runs: strict arities gone, v1 arities restored, columns dropped",
     `${applyFileExpectingFailure(FORWARD_RB)}|${arities(CREATE_FN)}/${arities(VALIDATE_FN)}|${one(`select count(*) from information_schema.columns where table_schema='public' and table_name='couranr_hosted_request_intakes' and column_name in ('customer_timing_intent','customer_requested_pickup_local')`)}`,
     "NO_ERROR|13/26|0");
  eq("HT-15b", "the forward rollback is RE-RUNNABLE: a second run with the columns already gone is a clean no-op",
     `${applyFileExpectingFailure(FORWARD_RB)}|${arities(CREATE_FN)}/${arities(VALIDATE_FN)}`, "NO_ERROR|13/26");
  eq("HT-15c", "the restored v1 validate is the unguarded original (the evidence guard proved no scheduled row exists)",
     one(`select (pg_get_functiondef('public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb)'::regprocedure) like '%hosted_scheduled_timing_requires_current_application%')::text`),
     "false");
  eq("HT-15d", "the forward migration re-applies on top of the restored v1 (PREDEPLOY again), and the guard migration re-guards the legacy validate",
     `${applyFileExpectingFailure(FORWARD)}|${applyFileExpectingFailure(GUARD)}|${arities(CREATE_FN)}/${arities(VALIDATE_FN)}|${one(`select (pg_get_functiondef('public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb)'::regprocedure) like '%hosted_scheduled_timing_requires_current_application%')::text`)}`,
     "NO_ERROR|NO_ERROR|13,17/26,29|true");
  eq("HT-15e", "the fence closes the window again, and the guard migration is a clean no-op once the legacy arity is gone",
     `${applyFileExpectingFailure(FENCE)}|${applyFileExpectingFailure(GUARD)}|${arities(CREATE_FN)}/${arities(VALIDATE_FN)}`, "NO_ERROR|NO_ERROR|17/29");

  console.log(`\n  hosted scheduled timing: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}
main();
