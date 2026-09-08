/**
 * EXECUTION VERIFICATION — consumer scheduled timing (TMZ-001 parity).
 *
 * The consumer create/estimate commands already accept the four timing
 * parameters and call the SAME private.couranr_assert_requested_timing the
 * business command calls. A text scan cannot prove that path runs for a
 * consumer row; only CALLING it can. These exercise, on a real Postgres:
 *
 *   ST-1  scheduled create: two-sided instant accepted, timing columns persisted
 *   ST-2  scheduled re-estimate preserves the timing statement
 *   ST-3  a canonical instant that does not match the local words -> CR422
 *   ST-4  scheduled with no local words -> CR422 scheduled_timing_incomplete
 *   ST-5  a DST-gap claim (nonexistent wall clock, null instant, reason) is
 *         accepted as an unresolved instant; a FALSE such claim is rejected
 *   ST-6  ASAP still persists with no instant
 *   ST-7  a scheduled request can carry an AUTOMATIC price (the DB does not
 *         force review; the app's doctrine decides)
 */
import crypto from "node:crypto";
import { up, psql } from "./up.mjs";

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

const place = (line1, city, postal, pid) => ({
  googlePlaceId: pid, formattedAddress: `${line1}, ${city}, VA ${postal}, USA`,
  line1, line2: null, city, region: "VA", postalCode: postal, countryCode: "US",
  latitude: 38.422, longitude: -77.408, addressSource: "google_places_new", instructions: null,
});
const PICKUP = place("12 Send St", "Stafford", "22554", "place-sched-pickup");
const DROPOFF = place("9 Receive Ct", "Woodbridge", "22191", "place-sched-dropoff");
const POLICY = "couranr-pricing-v2-2026-09-01";
const METERS_5MI = Math.round(5 * 1609.344);
const LINE_ITEMS = [{ code: "delivery_base", label: "Delivery", amountCents: 2299 }];

/** The DB's own America/New_York derivation of local words — the two-sided partner. */
const instantOf = (local) => `('${esc(local.replace("T", " "))}'::timestamp at time zone 'America/New_York')`;

function newSession() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return one(`select id from public.couranr_create_consumer_guest_session(
    p_token_hash := '${sha256(raw)}', p_ttl_minutes := 1440)`);
}

/** Named-notation args shared by create and estimate. */
function shipmentArgs() {
  return `
    p_shipment_description := 'a small box of books',
    p_recipient_name := null::text, p_recipient_phone := null::text, p_recipient_email := null::text,
    p_weight_lb := (20)::numeric, p_additional_stops := 0,
    p_service_level := 'standard', p_signature_required := false, p_proof_method := 'photo_or_pin',
    p_pickup_address := ${jsonLit(PICKUP)}, p_dropoff_address := ${jsonLit(DROPOFF)},
    p_overnight_requested := false,
    p_route_distance_meters := ${METERS_5MI}, p_route_duration_seconds := 600,
    p_route_static_duration_seconds := 600, p_route_traffic_delay_seconds := 0,
    p_distance_source := 'mapbox_directions_v5', p_serviceability_outcome := 'available_for_request',
    p_route_review_reason := null::text,
    p_quote_status := 'estimated', p_pricing_policy_version := '${POLICY}',
    p_delivery_subtotal_cents := 2299, p_included_loaded_miles := 2, p_billable_loaded_miles := (3)::numeric,
    p_quote_line_items := ${jsonLit(LINE_ITEMS)}, p_review_reasons := '[]'::jsonb,
    p_weight_band := null::text, p_restricted_class := 'none'`;
}
/** Timing args: intent, local words, canonical instant (SQL expr or null), reasons. */
function timingArgs({ intent = "asap", local = null, instantSql = "null::timestamptz", reasons = [] } = {}) {
  return `
    p_timing_intent := ${intent === null ? "null::text" : `'${intent}'`},
    p_requested_pickup_local := ${local === null ? "null::text" : `'${esc(local)}'`},
    p_requested_departure_at := ${instantSql},
    p_timing_review_reasons := ${jsonLit(reasons)}`;
}
function create(sessionId, timing) {
  return `select id from public.couranr_create_consumer_delivery_request_draft(
    p_guest_session_id := '${sessionId}'::uuid,
    p_idempotency_key := 'st-${crypto.randomUUID()}',
    p_contact := ${jsonLit({ phone: "+15715550188" })},
    ${shipmentArgs()},
    ${timingArgs(timing)})`;
}
function estimate(requestId, sessionId, version, timing) {
  return `select version from public.couranr_calculate_consumer_delivery_request_estimate(
    p_request_id := '${requestId}'::uuid, p_guest_session_id := '${sessionId}'::uuid,
    p_expected_version := ${version}, p_update_shipment := true,
    ${shipmentArgs()},
    ${timingArgs(timing)})`;
}
const col = (id, c) => one(`select coalesce(${c}::text,'NULL') from public.couranr_delivery_requests where id='${id}'`);

function main() {
  up();
  console.log("\n  consumer scheduled timing — execution verification (TMZ-001 parity)\n");

  const LOCAL = "2027-03-10T10:30"; // an ordinary Wednesday inside the operating window

  /* ── ST-1: scheduled create, two-sided instant ── */
  const s1 = newSession();
  const r1 = one(create(s1, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) }));
  eq("ST-1a", "timing_intent persisted as scheduled", col(r1, "timing_intent"), "scheduled");
  eq("ST-1b", "the sender's local words are preserved verbatim", col(r1, "requested_pickup_local"), LOCAL);
  eq("ST-1c", "the canonical instant equals the DB's own America/New_York derivation",
     one(`select (requested_departure_at = ${instantOf(LOCAL)})::text from public.couranr_delivery_requests where id='${r1}'`), "true");
  eq("ST-1d", "operating_timezone is America/New_York", col(r1, "operating_timezone"), "America/New_York");
  eq("ST-1e", "the request is a consumer request", col(r1, "requester_kind"), "consumer");

  /* ── ST-2: re-estimate preserves the scheduled statement ── */
  const v1 = Number(col(r1, "version"));
  const v2 = Number(one(estimate(r1, s1, v1, { intent: "scheduled", local: LOCAL, instantSql: instantOf(LOCAL) })));
  eq("ST-2a", "re-estimate bumps the version", v2 > v1, true);
  eq("ST-2b", "timing statement survives the re-estimate",
     `${col(r1, "timing_intent")}|${col(r1, "requested_pickup_local")}`, `scheduled|${LOCAL}`);

  /* ── ST-3: a mismatched instant is refused (two-sided rule) ── */
  const s3 = newSession();
  const r3 = raises(create(s3, { intent: "scheduled", local: LOCAL, instantSql: instantOf("2027-03-10T11:30") }));
  eq("ST-3", "instant that does not match the local words -> CR422 requested_departure_mismatch",
     r3, "CR422|requested_departure_mismatch");

  /* ── ST-4: scheduled with no local words ── */
  const s4 = newSession();
  eq("ST-4", "scheduled without local words -> CR422 scheduled_timing_incomplete",
     raises(create(s4, { intent: "scheduled", local: null })), "CR422|scheduled_timing_incomplete");

  /* ── ST-5: DST spring-forward gap (2027-03-14 02:00->03:00 ET): a NONEXISTENT wall clock ── */
  const s5 = newSession();
  const GAP = "2027-03-14T02:30";
  const r5 = one(create(s5, { intent: "scheduled", local: GAP, instantSql: "null::timestamptz", reasons: ["requested_time_nonexistent"] }));
  eq("ST-5a", "a genuine DST-gap claim is accepted with NO instant (unresolved, for review)",
     `${col(r5, "timing_intent")}|${col(r5, "requested_pickup_local")}|${col(r5, "requested_departure_at")}`,
     `scheduled|${GAP}|NULL`);
  eq("ST-5b", "the review reason is persisted",
     one(`select (timing_review_reasons ? 'requested_time_nonexistent')::text from public.couranr_delivery_requests where id='${r5}'`), "true");
  const s5b = newSession();
  eq("ST-5c", "a FALSE nonexistent claim for an ordinary time is rejected — the claim cannot skip the two-sided rule",
     raises(create(s5b, { intent: "scheduled", local: LOCAL, instantSql: "null::timestamptz", reasons: ["requested_time_nonexistent"] })),
     "CR422|nonexistent_time_claim_rejected");

  /* ── ST-6: ASAP unchanged ── */
  const s6 = newSession();
  const r6 = one(create(s6, { intent: "asap" }));
  eq("ST-6", "ASAP persists with no local words and no instant",
     `${col(r6, "timing_intent")}|${col(r6, "requested_pickup_local")}|${col(r6, "requested_departure_at")}`, "asap|NULL|NULL");

  /* ── ST-7: scheduled + automatic price is persistable ── */
  eq("ST-7", "the scheduled request carries an automatic 'estimated' quote (doctrine decides review, not the DB)",
     `${col(r1, "quote_status")}|${col(r1, "delivery_subtotal_cents")}`, "estimated|2299");

  console.log(`\n  consumer scheduled timing: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}
main();
