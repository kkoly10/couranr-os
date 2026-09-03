/**
 * EXECUTION VERIFICATION for launch batch 3 §D:
 *   20260903030000_couranr_consumer_send
 *
 * Same doctrine as paymentRecovery.mjs: a migration applying proves it
 * parses; only CALLING the commands against real rows proves they run. The
 * §35 CONSUMER matrix items that live at the database layer are executed
 * here. (The pricing/policy ENGINE is TypeScript and shared with the
 * business path by construction — tests/couranr-consumer-send.test.ts and
 * the existing pricing/policy unit suites hold that side.)
 *
 *   GUEST SESSIONS
 *   CS-01..03  TTL default 1440 min, clamped to [5, 4320]
 *   CS-04      a non-SHA-256 hash is refused at mint                  CR422
 *   CS-05      redemption stamps last_used_at
 *   CS-06..08  unknown, revoked and expired all refuse with the ONE
 *              uniform reason guest_session_not_available             CR404
 *
 *   CREATE + SCOPE
 *   CS-09..12  a consumer draft: requester_kind consumer, business NULL,
 *              source consumer_send, payer customer, server-derived scope
 *              consumer:<session>, contact snapshot stored, session bound
 *   CS-13      idempotent replay converges on the SAME request, ONE quote
 *   CS-14      a second draft on the same session is refused           CR409
 *   CS-15      a raw UUID with no session row can create nothing       CR404
 *   CS-16      a forged consumer scope is refused by the Gate A trigger
 *   CS-17      the contact snapshot is IMMUTABLE (CR409 on UPDATE)
 *   CS-18..21  mirrored strict guards: weight 0, weight-or-band, missing
 *              safety declaration, prohibited class vs estimated quote
 *   CS-22      a prohibited class is storable ONLY as an invalid quote
 *   CS-23      the creation event: actor_type customer, NULL actor id
 *
 *   ISOLATION
 *   CS-24      re-estimate appends quote #2 and bumps the version
 *   CS-25      guest B cannot estimate guest A's request              CR404
 *   CS-26      an unknown session cannot estimate anything            CR404
 *   CS-27      bind: idempotent for the same request, CR409 on re-point
 *
 *   PRICING PARITY (PRC-005)
 *   CS-28      the SAME physical job through the business strict command
 *              and the consumer command stores IDENTICAL subtotals and
 *              identical couranr_quote_line_items_total — no consumer
 *              surcharge exists anywhere in the stored record
 *
 *   SUBMIT -> REVIEW -> PAYMENT (customer-paid spine, no shortcut)
 *   CS-29      submit without phone/email is refused                  CR422
 *   CS-30      submit with phone -> pending_couranr_review (NO auto-accept)
 *   CS-31      Operations accept -> awaiting_quote_acceptance: payment
 *              unlocks only AFTER Couranr review, per the existing spine
 *   CS-32      obligation created with business NULL, amount off the quote
 *   CS-33      intent attaches (requires_action)
 *   CS-34      metadata carrying a businessAccountId for a null-business
 *              obligation is REJECTED (metadata_business_mismatch)
 *   CS-35      QVL-001: an out-of-window consumer authorization is refused
 *              quote_expired
 *   CS-36      the in-window verified authorization applies: obligation
 *              authorized, request confirmed
 *
 *   TRACKING (null-business links)
 *   CS-37      issuance from confirmed works with business NULL
 *   CS-38      redemption resolves the request and reports NULL business
 *   CS-39      a random token refuses uniformly with NO identifiers
 *   CS-40      a non-confirmed request cannot be issued a link         CR409
 *
 *   HONEST STORAGE + POSTURE
 *   CS-41      a >50 lb consumer job is storable only without a payable
 *              subtotal (review; engine authority is unit-tested)
 *   CS-42      no business_accounts row was created by ANY consumer flow
 *   CS-43      anon/authenticated hold EXECUTE on NONE of the six commands
 *   CS-44      guest sessions: RLS enabled, anon/authenticated no privilege
 *   CS-45      couranr_foundation_integrity() stays clean
 */
import crypto from "node:crypto";
import { up, psql } from "./up.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalQuotedRequest,
  syntheticIntentId,
} from "./gateAFixtures.mjs";

let pass = 0;
let fail = 0;
const one = (sql) => psql(sql).trim();
const esc = (s) => String(s).replace(/'/g, "''");
function ok(id, label, got) {
  pass += 1;
  console.log(`  PASS  ${id}  ${label}${got === undefined ? "" : `  [${got}]`}`);
}
function bad(id, label, got) {
  fail += 1;
  console.log(`  FAIL  ${id}  ${label}  [${got}]`);
}
function eq(id, label, got, want) {
  String(got) === String(want) ? ok(id, label, got) : bad(id, label, `got ${got}, want ${want}`);
}
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _probe(code text, msg text);
     do $probe$ begin
       ${stmt}
       insert into _probe values ('NO_ERROR', '');
     exception when others then
       insert into _probe values (SQLSTATE, SQLERRM);
     end $probe$;
     select code || '|' || msg from _probe;`,
  ).trim();
}

const sha256 = (raw) => crypto.createHash("sha256").update(raw, "utf8").digest("hex");
const jsonLit = (v) => `'${esc(JSON.stringify(v))}'::jsonb`;

function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`,
  );
  return id;
}

/** A Places-shaped address the appender's identity CHECK accepts. */
function place(line1, city, postalCode, placeId) {
  return {
    googlePlaceId: placeId,
    formattedAddress: `${line1}, ${city}, VA ${postalCode}, USA`,
    line1,
    line2: null,
    city,
    region: "VA",
    postalCode,
    countryCode: "US",
    latitude: 38.422,
    longitude: -77.408,
    addressSource: "google_places_new",
    instructions: null,
  };
}

const PICKUP = place("12 Send St", "Stafford", "22554", "place-consumer-pickup");
const DROPOFF = place("9 Receive Ct", "Woodbridge", "22191", "place-consumer-dropoff");
const POLICY = "couranr-pricing-v2-2026-09-01";
const METERS_5MI = Math.round(5 * 1609.344);
const LINE_ITEMS = [{ code: "delivery_base", label: "Delivery", amountCents: 2299 }];

/** Named-notation args for the consumer CREATE command, fully cast. */
function createArgs(sessionId, over = {}) {
  const o = {
    key: `cs-${crypto.randomUUID()}`,
    contact: { phone: "+15715550188" },
    description: "a small box of books",
    weightLb: 20,
    weightBand: null,
    restrictedClass: "'none'",
    quoteStatus: "'estimated'",
    policy: `'${POLICY}'`,
    subtotal: "2299",
    lineItems: jsonLit(LINE_ITEMS),
    reviewReasons: "'[]'::jsonb",
    ...over,
  };
  return `
    p_guest_session_id := '${sessionId}'::uuid,
    p_idempotency_key := '${esc(o.key)}',
    p_contact := ${jsonLit(o.contact)},
    p_shipment_description := ${o.description === null ? "null::text" : `'${esc(o.description)}'`},
    p_recipient_name := null::text, p_recipient_phone := null::text, p_recipient_email := null::text,
    p_weight_lb := ${o.weightLb === null ? "null::numeric" : `(${o.weightLb})::numeric`},
    p_additional_stops := 0,
    p_service_level := 'standard', p_signature_required := false, p_proof_method := 'photo_or_pin',
    p_pickup_address := ${jsonLit(PICKUP)}, p_dropoff_address := ${jsonLit(DROPOFF)},
    p_overnight_requested := false,
    p_route_distance_meters := ${METERS_5MI}, p_route_duration_seconds := 600,
    p_route_static_duration_seconds := 600, p_route_traffic_delay_seconds := 0,
    p_distance_source := 'google_routes_v2', p_serviceability_outcome := 'available_for_request',
    p_route_review_reason := null::text,
    p_quote_status := ${o.quoteStatus},
    p_pricing_policy_version := ${o.policy},
    p_delivery_subtotal_cents := ${o.subtotal},
    p_included_loaded_miles := 3, p_billable_loaded_miles := (5)::numeric,
    p_quote_line_items := ${o.lineItems},
    p_review_reasons := ${o.reviewReasons},
    p_weight_band := ${o.weightBand === null ? "null::text" : `'${o.weightBand}'`},
    p_timing_intent := null::text, p_requested_pickup_local := null::text,
    p_requested_departure_at := null::timestamptz, p_timing_review_reasons := '[]'::jsonb,
    p_restricted_class := ${o.restrictedClass}`;
}

/** Named-notation args for the consumer ESTIMATE command. */
function estimateArgs(requestId, sessionId, version, over = {}) {
  const o = {
    weightLb: 20,
    subtotal: "2299",
    lineItems: jsonLit(LINE_ITEMS),
    ...over,
  };
  return `
    p_request_id := '${requestId}'::uuid,
    p_guest_session_id := '${sessionId}'::uuid,
    p_expected_version := ${version},
    p_update_shipment := true,
    p_shipment_description := 'a small box of books',
    p_recipient_name := null::text, p_recipient_phone := null::text, p_recipient_email := null::text,
    p_weight_lb := (${o.weightLb})::numeric, p_additional_stops := 0,
    p_service_level := 'standard', p_signature_required := false, p_proof_method := 'photo_or_pin',
    p_pickup_address := ${jsonLit(PICKUP)}, p_dropoff_address := ${jsonLit(DROPOFF)},
    p_overnight_requested := false,
    p_route_distance_meters := ${METERS_5MI}, p_route_duration_seconds := 600,
    p_route_static_duration_seconds := 600, p_route_traffic_delay_seconds := 0,
    p_distance_source := 'google_routes_v2', p_serviceability_outcome := 'available_for_request',
    p_route_review_reason := null::text,
    p_quote_status := 'estimated', p_pricing_policy_version := '${POLICY}',
    p_delivery_subtotal_cents := ${o.subtotal},
    p_included_loaded_miles := 3, p_billable_loaded_miles := (5)::numeric,
    p_quote_line_items := ${o.lineItems}, p_review_reasons := '[]'::jsonb,
    p_weight_band := null::text, p_timing_intent := null::text,
    p_requested_pickup_local := null::text, p_requested_departure_at := null::timestamptz,
    p_timing_review_reasons := '[]'::jsonb, p_restricted_class := 'none'`;
}

function newSession(ttl = "null::integer") {
  const raw = crypto.randomBytes(32).toString("base64url");
  const row = one(
    `select id || '|' || token_hash from public.couranr_create_consumer_guest_session(
       p_token_hash := '${sha256(raw)}', p_ttl_minutes := ${ttl})`,
  );
  const [id, hash] = row.split("|");
  return { id, raw, hash };
}

const reqCol = (id, col) =>
  one(`select coalesce(${col}::text,'-') from public.couranr_delivery_requests where id='${id}'`);

async function main() {
  up();
  const t = psqlTransport(psql);
  try {
    console.log("\n  consumer /send — execution verification\n");

    const bizCountBefore = one("select count(*) from public.business_accounts");

    /* ═════════ guest sessions ═════════ */

    const s0 = newSession();
    eq("CS-01", "default TTL is 1440 minutes",
       one(`select round(extract(epoch from (expires_at - created_at))/60)
              from public.couranr_consumer_guest_sessions where id='${s0.id}'`), "1440");
    const sHigh = newSession("999999");
    eq("CS-02", "TTL clamps to 4320 minutes (3 days)",
       one(`select round(extract(epoch from (expires_at - created_at))/60)
              from public.couranr_consumer_guest_sessions where id='${sHigh.id}'`), "4320");
    const sLow = newSession("1");
    eq("CS-03", "TTL clamps up to 5 minutes",
       one(`select round(extract(epoch from (expires_at - created_at))/60)
              from public.couranr_consumer_guest_sessions where id='${sLow.id}'`), "5");
    eq("CS-04", "a non-SHA-256 hash is refused at mint",
       raises(`select public.couranr_create_consumer_guest_session('${s0.raw}', 60)`).split("|")[1],
       "token_hash_must_be_sha256_hex");
    eq("CS-05", "redemption stamps last_used_at",
       one(`select (last_used_at is not null)::text
              from public.couranr_redeem_consumer_guest_session('${s0.hash}')`), "true");
    eq("CS-06", "an unknown token refuses uniformly",
       raises(`select public.couranr_redeem_consumer_guest_session('${sha256("nope")}')`).split("|")[1],
       "guest_session_not_available");
    psql(`update public.couranr_consumer_guest_sessions
             set revoked_at = now() where id='${sLow.id}'`);
    eq("CS-07", "a revoked token refuses with the SAME reason",
       raises(`select public.couranr_redeem_consumer_guest_session('${sLow.hash}')`).split("|")[1],
       "guest_session_not_available");
    psql(`update public.couranr_consumer_guest_sessions
             set created_at = now() - interval '2 minutes',
                 expires_at = now() - interval '1 minute'
           where id='${sHigh.id}'`);
    eq("CS-08", "an expired token refuses with the SAME reason",
       raises(`select public.couranr_redeem_consumer_guest_session('${sHigh.hash}')`).split("|")[1],
       "guest_session_not_available");

    /* ═════════ create + scope ═════════ */

    const s1 = newSession();
    const s1Key = `cs-${crypto.randomUUID()}`;
    const r1 = one(`select id from public.couranr_create_consumer_delivery_request_draft(
      ${createArgs(s1.id, { key: s1Key })})`);
    eq("CS-09", "the draft is a consumer request with NO business tenant",
       reqCol(r1, "requester_kind") + "|" + reqCol(r1, "business_account_id") + "|" +
         reqCol(r1, "created_by") + "|" + reqCol(r1, "source") + "|" + reqCol(r1, "payer_type"),
       "consumer|-|-|consumer_send|customer");
    eq("CS-10", "the idempotency scope is SERVER-derived from the session",
       reqCol(r1, "idempotency_scope"), `consumer:${s1.id}`);
    eq("CS-11", "the session is bound to its one request in the same transaction",
       one(`select coalesce(request_id::text,'-') from public.couranr_consumer_guest_sessions
             where id='${s1.id}'`), r1);
    eq("CS-12", "the contact snapshot is stored on the request",
       one(`select consumer_contact_snapshot->>'phone' from public.couranr_delivery_requests
             where id='${r1}'`), "+15715550188");
    eq("CS-13", "a replay with the original key converges on the SAME request, ONE quote",
       one(`select id from public.couranr_create_consumer_delivery_request_draft(
             ${createArgs(s1.id, { key: s1Key })})`) + "|" +
         one(`select count(*) from public.couranr_quote_versions where request_id='${r1}'`),
       `${r1}|1`);
    eq("CS-14", "a SECOND draft on the same session is refused",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(s1.id)})`).split("|")[1],
       "guest_session_already_bound");
    eq("CS-15", "a raw UUID with no session row can create nothing",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(crypto.randomUUID())})`).split("|")[1],
       "guest_session_not_available");
    eq("CS-16", "a forged consumer scope is refused by the Gate A trigger",
       raises(`insert into public.couranr_delivery_requests
                 (requester_kind, business_account_id, created_by, idempotency_scope,
                  idempotency_key, request_state, review_state, service_area_review_state,
                  source, readiness_state, payer_type, service_level, signature_required,
                  proof_method, pickup_address, dropoff_address, additional_stops)
               values ('consumer', null, null, 'consumer:short', 'forged', 'draft',
                  'not_required', 'pending', 'consumer_send', 'not_confirmed', 'customer',
                  'standard', false, 'photo_or_pin', ${jsonLit(PICKUP)}, ${jsonLit(DROPOFF)}, 0)`)
         .split("|")[1],
       "server_consumer_idempotency_scope_required");
    eq("CS-17", "the contact snapshot is immutable",
       raises(`update public.couranr_delivery_requests
                 set consumer_contact_snapshot = '{"phone":"+15550000000"}'::jsonb
               where id='${r1}'`).split("|")[1],
       "requester_identity_is_immutable");
    eq("CS-18", "weight 0 is refused — never a synthetic unknown",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(newSession().id, { weightLb: 0 })})`).split("|")[1],
       "weight_must_be_positive");
    eq("CS-19", "a request that says NOTHING about weight is refused",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(newSession().id, { weightLb: null, weightBand: null })})`).split("|")[1],
       "weight_or_band_required");
    eq("CS-20", "no safety declaration -> no automatic quote",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(newSession().id, { restrictedClass: "null::text" })})`).split("|")[1],
       "safety_declaration_required");
    // The shared guard's branch order (measured, and identical for the
    // business command): an ESTIMATED quote without a trusted 'none' refuses
    // as safety_declaration_required first; the prohibited-specific refusal
    // fires on any non-invalid, non-estimated status.
    eq("CS-21", "a prohibited class cannot carry an estimated quote",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(newSession().id, { restrictedClass: "'firearms'" })})`).split("|")[1],
       "safety_declaration_required");
    eq("CS-21b", "a prohibited class cannot even carry a review quote — invalid only",
       raises(`select public.couranr_create_consumer_delivery_request_draft(
               ${createArgs(newSession().id, {
                 restrictedClass: "'firearms'", quoteStatus: "'manual_review_required'",
                 policy: "null::text", subtotal: "null::integer", lineItems: "'[]'::jsonb",
                 reviewReasons: jsonLit(["shipment_prohibited"]),
               })})`).split("|")[1],
       "prohibited_class_requires_invalid_quote");
    const s3 = newSession();
    const r3 = one(`select id from public.couranr_create_consumer_delivery_request_draft(
      ${createArgs(s3.id, {
        restrictedClass: "'firearms'", quoteStatus: "'invalid'",
        policy: "null::text", subtotal: "null::integer", lineItems: "'[]'::jsonb",
      })})`);
    eq("CS-22", "a prohibited class IS storable as an invalid, unpriced quote",
       reqCol(r3, "quote_status") + "|" + reqCol(r3, "delivery_subtotal_cents"),
       "invalid|-");
    eq("CS-23", "the creation event has a customer actor with NO user id",
       one(`select actor_type || '|' || coalesce(actor_user_id::text,'-')
              from public.couranr_delivery_request_events
             where request_id='${r1}' and command='create_delivery_request_draft'`),
       "customer|-");

    /* ═════════ isolation ═════════ */

    const r1v1 = Number(reqCol(r1, "version"));
    const r1AfterEst = one(`select version from public.couranr_calculate_consumer_delivery_request_estimate(
      ${estimateArgs(r1, s1.id, r1v1)})`);
    eq("CS-24", "re-estimate bumps the version and appends quote #2",
       r1AfterEst + "|" +
         one(`select count(*) from public.couranr_quote_versions where request_id='${r1}'`),
       `${r1v1 + 1}|2`);
    const s4 = newSession();
    eq("CS-25", "guest B cannot estimate guest A's request",
       raises(`select public.couranr_calculate_consumer_delivery_request_estimate(
               ${estimateArgs(r1, s4.id, r1v1 + 1)})`).split("|")[1],
       "request_not_found");
    eq("CS-26", "an unknown session cannot estimate anything",
       raises(`select public.couranr_calculate_consumer_delivery_request_estimate(
               ${estimateArgs(r1, crypto.randomUUID(), r1v1 + 1)})`).split("|")[1],
       "guest_session_not_available");
    eq("CS-27", "bind: idempotent for the same request, refused for a re-point",
       one(`select (request_id = '${r1}')::text
              from public.couranr_bind_consumer_guest_request('${s1.id}','${r1}')`) + "|" +
         raises(`select public.couranr_bind_consumer_guest_request('${s1.id}','${r3}')`).split("|")[1],
       "true|guest_session_already_bound");

    /* ═════════ pricing parity (PRC-005) ═════════ */

    eq("CS-42", "no business_accounts row was created by any consumer flow",
       one("select count(*) from public.business_accounts"), bizCountBefore);

    const bizId = one(
      `insert into public.business_accounts (name, slug, status)
       values ('Parity Co', 'parity-co-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`,
    );
    const merchant = seedActor(`mer+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "merchant");
    psql(`insert into public.business_members (business_account_id, user_id, role, status)
          values ('${bizId}', '${merchant}', 'owner', 'active')`);
    const parity = await seedCanonicalQuotedRequest(t, {
      businessId: bizId, actorUserId: merchant, marker: "parity", upTo: "draft",
      subtotalCents: 2299, loadedMiles: 5, weightLb: 20,
    });
    eq("CS-28", "the SAME job stores IDENTICAL commercial content for both requester kinds",
       one(`select q.subtotal_cents || '|' || public.couranr_quote_line_items_total(q.quote_line_items)
                 || '|' || q.pricing_policy_version
              from public.couranr_quote_versions q
              join public.couranr_delivery_requests r on r.current_quote_version_id = q.id
             where r.id='${parity.requestId}'`),
       one(`select q.subtotal_cents || '|' || public.couranr_quote_line_items_total(q.quote_line_items)
                 || '|' || q.pricing_policy_version
              from public.couranr_quote_versions q
              join public.couranr_delivery_requests r on r.current_quote_version_id = q.id
             where r.id='${r1}'`));

    /* ═════════ submit -> review -> payment ═════════ */

    const s5 = newSession();
    const r5 = one(`select id from public.couranr_create_consumer_delivery_request_draft(
      ${createArgs(s5.id, { contact: {} })})`);
    eq("CS-29", "submit without phone or email is refused",
       raises(`select public.couranr_submit_consumer_delivery_request(
               '${r5}','${s5.id}',${Number(reqCol(r5, "version"))})`).split("|")[1],
       "consumer_contact_required");

    const r1v2 = Number(reqCol(r1, "version"));
    eq("CS-30", "submit with phone -> pending_couranr_review, NO auto-accept",
       one(`select request_state || '|' || review_state || '|' || (submitted_at is not null)::text
              from public.couranr_submit_consumer_delivery_request('${r1}','${s1.id}',${r1v2})`),
       "pending_couranr_review|pending|true");
    eq("CS-30b", "the submit event has a customer actor with NO user id and NO acknowledgment",
       one(`select actor_type || '|' || coalesce(actor_user_id::text,'-')
                 || '|' || (metadata->>'acknowledgment')
              from public.couranr_delivery_request_events
             where request_id='${r1}' and command='submit_delivery_request'`),
       "customer|-|false");

    const ops = seedActor(`ops+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
    const r1v3 = Number(reqCol(r1, "version"));
    eq("CS-31", "Operations accept -> awaiting_quote_acceptance (payment AFTER review)",
       one(`select request_state from public.couranr_accept_delivery_request_as_quoted(
              '${r1}', null::uuid, ${r1v3}, '${ops}')`),
       "awaiting_quote_acceptance");

    const obRow = one(`select id || '|' || coalesce(business_account_id::text,'-')
             || '|' || payment_state || '|' || amount_cents
        from public.couranr_create_payment_obligation('${r1}', null::uuid, 'consumer:${s1.id}')`);
    const [obId, obBiz, obState, obAmount] = obRow.split("|");
    eq("CS-32", "obligation created with business NULL, amount off the quote",
       `${obBiz}|${obState}|${obAmount}`, "-|not_started|2299");

    const intentId = syntheticIntentId();
    eq("CS-33", "the PaymentIntent attaches (requires_action)",
       one(`select payment_state from public.couranr_attach_payment_intent('${obId}', 1, '${intentId}')`),
       "requires_action");

    const qvId = one(`select quote_version_id from public.couranr_payment_obligations where id='${obId}'`);
    const applyConsumer = ({ eventId, extraMeta = "", authorizedAt = "null" }) =>
      `select outcome || '|' || coalesce(rejected_reason,'-')
         from public.couranr_apply_payment_intent_state(
           '${eventId}', 'payment_intent.amount_capturable_updated', '${intentId}',
           'requires_capture', ${obAmount}, ${obAmount}, 'usd',
           jsonb_build_object('paymentObligationId','${obId}',
             'couranrRequestId','${r1}','quoteVersionId','${qvId}'${extraMeta}),
           ${authorizedAt})`;
    eq("CS-34", "metadata naming a business for a null-business obligation is rejected",
       one(applyConsumer({
         eventId: `evt-${obId}-biz`,
         extraMeta: `,'businessAccountId','${bizId}'`,
       })),
       "rejected|metadata_business_mismatch");
    const T20 = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    eq("CS-35", "QVL-001: an out-of-window consumer authorization is refused quote_expired",
       one(applyConsumer({ eventId: `evt-${obId}-stale`, authorizedAt: `'${T20}'::timestamptz` })),
       "rejected|quote_expired");
    eq("CS-36", "the in-window verified authorization applies",
       one(applyConsumer({ eventId: `evt-${obId}-ok` })) + "|" +
         one(`select payment_state from public.couranr_payment_obligations where id='${obId}'`) + "|" +
         reqCol(r1, "request_state"),
       "applied|-|authorized|confirmed");

    /* ═════════ tracking with business NULL ═════════ */

    const trackRaw = crypto.randomBytes(32).toString("base64url");
    eq("CS-37", "a tracking link issues from confirmed with business NULL",
       one(`select coalesce(business_account_id::text,'-') || '|' || (revoked_at is null)::text
              from public.couranr_issue_delivery_access_token('${r1}', '${sha256(trackRaw)}', 30)`),
       "-|true");
    eq("CS-38", "redemption resolves the request and reports NULL business",
       one(`select valid::text || '|' || coalesce(request_id::text,'-')
                 || '|' || coalesce(business_account_id::text,'-') || '|' || request_state
              from public.couranr_redeem_delivery_access_token('${sha256(trackRaw)}')`),
       `true|${r1}|-|confirmed`);
    eq("CS-39", "a random token refuses uniformly with NO identifiers",
       one(`select valid::text || '|' || reason || '|' || coalesce(request_id::text,'-')
              from public.couranr_redeem_delivery_access_token('${sha256("guess")}')`),
       "false|not_found|-");
    eq("CS-40", "a non-confirmed request cannot be issued a tracking link",
       raises(`select public.couranr_issue_delivery_access_token('${r5}', '${sha256("early")}', 30)`)
         .split("|")[1],
       "request_not_trackable");

    /* ═════════ honest storage + posture ═════════ */

    const s6 = newSession();
    const r6 = one(`select id from public.couranr_create_consumer_delivery_request_draft(
      ${createArgs(s6.id, {
        weightLb: 60, quoteStatus: "'manual_review_required'",
        policy: "null::text", subtotal: "null::integer", lineItems: "'[]'::jsonb",
        reviewReasons: jsonLit(["shipment_policy_review"]),
      })})`);
    eq("CS-41a", "a >50 lb job is storable as review with NO payable subtotal",
       reqCol(r6, "quote_status") + "|" + reqCol(r6, "delivery_subtotal_cents"),
       "manual_review_required|-");
    eq("CS-41b", "... and an estimated quote at 60 lb WITH a price is not being minted here",
       one(`select q.subtotal_cents is null and q.pricing_policy_version is null
              from public.couranr_quote_versions q
              join public.couranr_delivery_requests r on r.current_quote_version_id = q.id
             where r.id='${r6}'`).trim(),
       "t");

    eq("CS-43", "anon/authenticated hold EXECUTE on NONE of the six new commands",
       one(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')
                        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname in
               ('couranr_create_consumer_guest_session','couranr_redeem_consumer_guest_session',
                'couranr_bind_consumer_guest_request',
                'couranr_create_consumer_delivery_request_draft',
                'couranr_calculate_consumer_delivery_request_estimate',
                'couranr_submit_consumer_delivery_request')`),
       "false");
    eq("CS-43b", "... and all six exist (the probe is not vacuous)",
       one(`select count(distinct p.proname)
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname in
               ('couranr_create_consumer_guest_session','couranr_redeem_consumer_guest_session',
                'couranr_bind_consumer_guest_request',
                'couranr_create_consumer_delivery_request_draft',
                'couranr_calculate_consumer_delivery_request_estimate',
                'couranr_submit_consumer_delivery_request')`),
       "6");
    eq("CS-44", "guest sessions: RLS enabled, anon/authenticated hold NOTHING",
       one(`select c.relrowsecurity::text || '|' ||
              bool_or(has_table_privilege(r, 'public.couranr_consumer_guest_sessions', p))::text
              from pg_class c join pg_namespace n on n.oid=c.relnamespace,
                   unnest(array['anon','authenticated']) r,
                   unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
             where n.nspname='public' and c.relname='couranr_consumer_guest_sessions'
             group by c.relrowsecurity`),
       "true|false");

    const integrity = await gateAIntegrityIssues(psqlTransport(psql));
    eq("CS-45", "the seeded fixtures leave couranr_foundation_integrity() clean",
       integrity.join(",") || "clean", "clean");

    console.log(`\n  Consumer send: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    // up() at the top recreated the cluster; leave teardown to the next suite's up().
  }
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exitCode = 1;
});
