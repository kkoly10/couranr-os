/**
 * Couranr Pricing Authority V2 — DATABASE EXECUTION.
 *
 * The engine tests prove the arithmetic. These prove the things that only
 * exist at execution time and that a text scan cannot see: a CHECK that
 * re-derives the traffic delay, a command that refuses the superseded policy
 * version, a rollback that refuses to destroy commercial evidence, and the
 * fact that applying this migration does not touch one historical amount.
 */
import { up, down, psql } from "./up.mjs";
import { readFileSync } from "node:fs";

const KEEP = process.argv.includes("--keep");
let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const raw = (q) => psql(q);
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};
/** Runs SQL expecting a raise, and returns SQLSTATE|message. */
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _p(code text, msg text);
     do $probe$ begin ${stmt} insert into _p values ('NO_ERROR',''); 
     exception when others then insert into _p values (SQLSTATE, SQLERRM); end $probe$;
     select code || '|' || msg from _p;`
  ).trim();
}

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
/* A separate Operations identity, because couranr_begin_payment_release gates
   on profiles.role = 'admin' and the merchant fixture user must not hold it. */
const OPS = "44444444-4444-4444-8444-444444444444";
const addr = (pid, line1) =>
  `jsonb_build_object('googlePlaceId','${pid}','formattedAddress','${line1}, Stafford, VA 22554, USA',
   'line1','${line1}','line2',null,'city','Stafford','region','VA','postalCode','22554',
   'countryCode','US','latitude',38.422,'longitude',-77.408,'addressSource','google_places_new','instructions',null)`;
const items = (a) =>
  `jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base','quantity',1,
   'unitAmountCents',${a},'amountCents',${a}))`;

/** One draft through the canonical routed command. */
function draft(key, { duration = 600, staticDuration = 600, delay = 0, policy = "couranr-pricing-v2-2026-09-01", amount = 799 } = {}) {
  return `select id from public.couranr_create_routed_delivery_request_draft(
    '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','r@example.test',10,0,'standard',false,'photo_or_pin',
    ${addr("place-pickup","10 Market St")},${addr("place-drop","20 Main St")},false,
    3219,${duration},${staticDuration},${delay},'google_routes_v2','available_for_request',null,
    'estimated','${policy}',${amount},2,0,${items(amount)},'[]'::jsonb)`;
}

function main() {
  up({ quiet: true });
  try {
    raw(`insert into auth.users(id,email) values ('${USER}','pricing@example.test');
         insert into public.business_accounts(id,name,slug,created_by)
           values ('${BUSINESS}','Pricing Fixture','pricing-fixture','${USER}');
         insert into public.business_members(business_account_id,user_id,role,status)
           values ('${BUSINESS}','${USER}','owner','active');
         insert into auth.users(id,email) values ('${OPS}','ops@example.test');
         insert into public.profiles(id,email,role) values ('${OPS}','ops@example.test','admin');`);

    console.log("\n  Pricing V2 authority — database execution\n");

    /* ---------------------------------------------- traffic evidence ---- */

    const okId = one(draft("v2-ok", { duration: 900, staticDuration: 600, delay: 300 }));
    check("PV2-01", "a correctly derived delay is accepted", /^[0-9a-f-]{36}$/.test(okId), true);
    check("PV2-02", "both durations and the delay are persisted on the immutable quote",
      one(`select route_duration_seconds||'|'||route_static_duration_seconds||'|'||route_traffic_delay_seconds
             from public.couranr_quote_versions where request_id='${okId}'`), "900|600|300");

    check("PV2-03", "a FLATTERING delay is refused, not stored",
      raises(draft("v2-lie", { duration: 900, staticDuration: 600, delay: 0 })),
      "CR422|traffic_delay_must_equal_route_evidence");

    check("PV2-04", "an INFLATED delay is refused too",
      raises(draft("v2-inflate", { duration: 900, staticDuration: 600, delay: 9999 })),
      "CR422|traffic_delay_must_equal_route_evidence");

    check("PV2-05", "a missing baseline duration is refused rather than read as zero delay",
      raises(draft("v2-nobase", { duration: 900, staticDuration: "null", delay: 300 })),
      "CR422|complete_traffic_evidence_required");

    check("PV2-06", "a negative delay is refused",
      raises(draft("v2-neg", { duration: 600, staticDuration: 900, delay: -300 })),
      "CR422|complete_traffic_evidence_required");

    /* ------------------------------------------------ policy cutover ---- */

    /* PRC-007. The boundary is an EXACT match, not a blacklist. The blacklist
       shape refused exactly one string and waved through every typo, invented
       identifier and ungoverned future version - and a stored quote whose
       policy nobody recognises cannot be explained later. */
    check("PV2-07", "the superseded policy version cannot be MINTED",
      raises(draft("v2-old-policy", { policy: "couranr-pricing-2026-07-31" })),
      "CR422|unsupported_pricing_policy_version");

    check("PV2-19", "a TYPO in the current policy version cannot be minted",
      raises(draft("v2-typo", { policy: "couranr-pricing-v2-2026-09-1" })),
      "CR422|unsupported_pricing_policy_version");

    check("PV2-20", "an invented FUTURE policy version cannot be minted",
      raises(draft("v2-future", { policy: "couranr-pricing-v3-2027-01-01" })),
      "CR422|unsupported_pricing_policy_version");

    check("PV2-21", "an empty policy string cannot be minted",
      raises(draft("v2-empty", { policy: "" })),
      "CR422|unsupported_pricing_policy_version");

    /* The nullable rules for an unpriced quote are UNCHANGED by the pin: a
       manual-review quote still carries no policy and no amount. */
    const reviewId = one(`select id from public.couranr_create_routed_delivery_request_draft(
      '${BUSINESS}','${USER}','v2-review','merchant_portal','not_confirmed','merchant',
      'Recipient','555-0100','r@example.test',10,0,'standard',false,'photo_or_pin',
      ${addr("place-pickup","10 Market St")},${addr("place-drop","20 Main St")},false,
      null,null,null,null,'google_routes_v2','needs_review','outside_service_area',
      'manual_review_required',null,null,null,null,'[]'::jsonb,
      jsonb_build_array('route_needs_review'))`);
    check("PV2-22", "an unpriced manual-review quote still mints with a null policy",
      one(`select (pricing_policy_version is null)::text || '|' || quote_status
             from public.couranr_quote_versions where request_id='${reviewId}'`),
      "true|manual_review_required");

    /* ------------------------------- historical quotes are untouched ---- */

    // A historical row, written directly as the pre-V2 world would have left
    // it: old policy version, old amount, and NO traffic columns.
    raw(`insert into public.couranr_delivery_requests
           (id,business_account_id,created_by,idempotency_key,recipient_name,quote_status)
         values ('33333333-3333-4333-8333-333333333333','${BUSINESS}','${USER}','hist-1','Historical','not_quoted');
         insert into public.couranr_quote_versions
           (request_id,quote_number,request_version_at_creation,quote_status,
            pricing_policy_version,payer_type,currency,subtotal_cents,
            quote_line_items,provenance_state,record_origin)
         values ('33333333-3333-4333-8333-333333333333',1,1,'estimated',
                 'couranr-pricing-2026-07-31','merchant','usd',2299,
                 jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base delivery (first 3 loaded miles)',
                   'quantity',1,'unitAmountCents',2299,'amountCents',2299)),
                 'verified','legacy_backfill');`);

    check("PV2-08", "a historical quote keeps its own amount and policy version",
      one(`select subtotal_cents||'|'||pricing_policy_version from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`),
      "2299|couranr-pricing-2026-07-31");

    check("PV2-09", "a historical quote's stored line items are readable verbatim",
      one(`select quote_line_items->0->>'label' from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`),
      "Base delivery (first 3 loaded miles)");

    check("PV2-10", "the traffic columns are NULL on a historical row, not backfilled with a guess",
      one(`select coalesce(route_static_duration_seconds::text,'null')||'|'||
                  coalesce(route_traffic_delay_seconds::text,'null')
             from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`), "null|null");

    check("PV2-11", "V2 and historical policy versions coexist — a future V3 could too",
      one(`select count(distinct pricing_policy_version) from public.couranr_quote_versions
            where pricing_policy_version is not null`), "2");

    /* ------------------------------------------- structural guarantees -- */

    check("PV2-12", "no routed command exposes a browser mileage or duration parameter",
      one(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname in ('public','private') and p.proname like '%routed%'
              and array_to_string(p.proargnames,',') ~ '(p_loaded_miles|p_client_|p_browser_)'`), "0");

    check("PV2-13", "each routed function exists at exactly one arity — no pre-traffic overload survives",
      one(`select count(*) from (
             select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname in ('public','private') and p.proname like '%routed%'
              group by p.proname having count(*) > 1) x`), "0");

    check("PV2-14", "anon and authenticated cannot execute the routed create command",
      one(`select bool_or(has_function_privilege(r,
             'public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb)',
             'EXECUTE')) from unnest(array['anon','authenticated']) r`), "f");

    check("PV2-55", "the QVL predicates are not executable by anon or authenticated",
      one(`select bool_or(has_function_privilege(r, p.oid, 'EXECUTE'))::text
             from pg_proc p, unnest(array['anon','authenticated']) r
            where p.proname in ('couranr_quote_payer_approved','couranr_quote_version_is_expired',
                                'couranr_obligation_quote_expired')`), "false");

    check("PV2-15", "Foundation integrity remains zero",
      one(`select count(*) from public.couranr_foundation_integrity()`), "0");

    /* ------------------------------------------- QVL-001 quote validity --- */
    /* The window gates the ACT OF OBTAINING payer approval and nothing
       downstream of an approval already obtained. A predicate that is correct
       but uncalled proves nothing, so every boundary is exercised through the
       real command. */

    /* couranr_quote_versions is append-only - the first version of this helper
       was refused by `quote_versions_are_append_only`, which is the
       immutability guarantee doing its job. session_replication_role suspends
       the trigger for this session only, on a disposable database, purely to
       move the clock. Nothing in the product can take this path. */
    const age = (rid, iv) =>
      raw(`set session_replication_role='replica';
           update public.couranr_quote_versions set created_at = now() - interval '${iv}'
            where request_id = '${rid}';
           set session_replication_role='origin';`);
    const ver = (rid) => one(`select version from public.couranr_delivery_requests where id='${rid}'`);
    const state = (rid) => one(`select request_state from public.couranr_delivery_requests where id='${rid}'`);
    const quotes = (rid) => one(`select count(*) from public.couranr_quote_versions where request_id='${rid}'`);
    const custDraft = (key) => draft(key).replace("'merchant',\n    'Recipient'", "'customer',\n    'Recipient'");

    /* ---- 1. merchant approved at 14:59 is price-locked forever ---------- */
    const m1 = one(draft("qvl-m-ok", { duration: 900, staticDuration: 600, delay: 300 }));
    age(m1, "14 minutes 59 seconds");
    check("PV2-23", "merchant may acknowledge at 14:59",
      raises(`select public.couranr_submit_delivery_request_v2('${m1}','${BUSINESS}',${ver(m1)},'${USER}',true)`),
      "NO_ERROR|");
    age(m1, "30 minutes");
    check("PV2-24", "an APPROVED quote is no longer expirable",
      one(`select private.couranr_quote_version_is_expired(q.*) from public.couranr_quote_versions q
            where q.request_id='${m1}'`), "f");
    check("PV2-25", "Operations may accept that SAME quote 30 minutes later",
      raises(`select public.couranr_accept_delivery_request_as_quoted('${m1}','${BUSINESS}',${ver(m1)},'${USER}')`),
      "NO_ERROR|");
    check("PV2-26", "... with no Quote N+1 minted", quotes(m1), "1");
    check("PV2-27", "... and the same subtotal and policy on Quote N",
      one(`select subtotal_cents||'|'||pricing_policy_version from public.couranr_quote_versions
            where request_id='${m1}'`), "799|couranr-pricing-v2-2026-09-01");
    check("PV2-28", "... and the merchant obligation can still be created afterwards",
      raises(`select public.couranr_create_payment_obligation('${m1}','${BUSINESS}','qvl-m-ok-key')`),
      "NO_ERROR|");

    /* ---- 2. merchant acknowledgment at exactly 15:00 is refused --------- */
    const m2 = one(draft("qvl-m-late", { duration: 900, staticDuration: 600, delay: 300 }));
    age(m2, "15 minutes");
    check("PV2-29", "merchant acknowledgment at exactly 15:00 is refused",
      raises(`select public.couranr_submit_delivery_request_v2('${m2}','${BUSINESS}',${ver(m2)},'${USER}',true)`),
      "CR410|quote_expired");
    check("PV2-31", "... no acknowledgment event was recorded",
      one(`select count(*) from public.couranr_delivery_request_events
            where request_id='${m2}' and command='submit_delivery_request'`), "0");
    check("PV2-32", "... and the request did not move state", state(m2), "draft");

    /* ---- 3. unacknowledged stale submit enters review but cannot confirm  */
    const m3 = one(draft("qvl-m-noack", { duration: 900, staticDuration: 600, delay: 300 }));
    age(m3, "40 minutes");
    check("PV2-33", "an UNACKNOWLEDGED stale request may still enter review",
      raises(`select public.couranr_submit_delivery_request_v2('${m3}','${BUSINESS}',${ver(m3)},'${USER}',false)`),
      "NO_ERROR|");
    check("PV2-34", "... submitting without acknowledgment is not payer approval",
      one(`select private.couranr_quote_payer_approved(q.*) from public.couranr_quote_versions q
            where q.request_id='${m3}'`), "f");
    /* Still refused, and refused FIRST on the acknowledgment it never got:
       the expiry guard runs only on the branch that CONFIRMS, after the
       merchant identity checks. Either answer blocks the stale price; this one
       is the more precise account of why. The merchant window is really
       enforced at SUBMIT (PV2-29, exactly 15:00 refused), and an in-window
       acknowledgment is price-locked thereafter (PV2-25/26/27, accepted at 30
       minutes at the same subtotal). The guard on the confirming branch is
       defence in depth: every merchant path that reaches it has either
       acknowledged the current quote - which the predicate reads as approval -
       or been refused by CR412 first. */
    check("PV2-35", "... so it cannot be confirmed at that stale price",
      raises(`select public.couranr_accept_delivery_request_as_quoted('${m3}','${BUSINESS}',${ver(m3)},'${USER}')`),
      "CR412|merchant_acknowledgment_missing");

    const m4 = one(draft("qvl-m-fresh-noack", { duration: 900, staticDuration: 600, delay: 300 }));
    raw(`select public.couranr_submit_delivery_request_v2('${m4}','${BUSINESS}',${ver(m4)},'${USER}',false)`);
    check("PV2-36", "the exact-quote acknowledgment identity check is preserved",
      raises(`select public.couranr_accept_delivery_request_as_quoted('${m4}','${BUSINESS}',${ver(m4)},'${USER}')`),
      "CR412|merchant_acknowledgment_missing");

    /* ---- 4-8. CUSTOMER-PAID: approval is the Stripe authorization ------ */
    /* Nothing before requires_capture is payer approval, so nothing before it
       may make the price immortal - and nothing after a real authorization may
       be undone by the clock. */

    const custIntent = (n) => `pi_qvl_${n}`;
    function authorizeEvent(obId, reqId, biz, quoteId, amount, evId, authorizedAt, intentKey) {
      return `select outcome||'|'||coalesce(rejected_reason,'-')||'|'||coalesce(payment_state,'-')
              from public.couranr_apply_payment_intent_state(
                '${evId}','payment_intent.amount_capturable_updated','${custIntent(intentKey ?? evId)}',
                'requires_capture',${amount},${amount},'usd',
                jsonb_build_object('paymentObligationId','${obId}','couranrRequestId','${reqId}',
                  'businessAccountId','${biz}','quoteVersionId','${quoteId}'),
                ${authorizedAt ? `'${authorizedAt}'::timestamptz` : "null"})`;
    }
    /* One customer-paid request, driven the way the product drives it. */
    function customerChain(key, ageBeforeAuth) {
      const rid = one(draft(key, { duration: 900, staticDuration: 600, delay: 300 }));
      raw(`update public.couranr_delivery_requests set payer_type='customer' where id='${rid}'`);
      raw(`set session_replication_role='replica';
           update public.couranr_quote_versions set payer_type='customer' where request_id='${rid}';
           set session_replication_role='origin';`);
      raw(`select public.couranr_submit_delivery_request_v2('${rid}','${BUSINESS}',${ver(rid)},'${USER}',false)`);
      raw(`select public.couranr_accept_delivery_request_as_quoted('${rid}','${BUSINESS}',${ver(rid)},'${USER}')`);
      const obId = one(`select id from public.couranr_create_payment_obligation('${rid}','${BUSINESS}','${key}-key')`);
      const qId = one(`select current_quote_version_id from public.couranr_delivery_requests where id='${rid}'`);
      return { rid, obId, qId };
    }

    const c1 = customerChain("qvl-c-stale");
    check("PV2-37", "Ops accept moved the customer request to awaiting_quote_acceptance",
      state(c1.rid), "awaiting_quote_acceptance");
    check("PV2-38", "a freshly created obligation is not_started — NOT authorized",
      one(`select payment_state from public.couranr_payment_obligations where id='${c1.obId}'`), "not_started");
    check("PV2-39", "... and creating it is not payer approval",
      one(`select private.couranr_quote_payer_approved(q.*) from public.couranr_quote_versions q
            where q.id='${c1.qId}'`), "f");
    raw(`select public.couranr_issue_payment_access_token('${c1.rid}','${c1.obId}',
          repeat('a',64), 7)`);
    raw(`select public.couranr_attach_payment_intent('${c1.obId}',
          (select version from public.couranr_payment_obligations where id='${c1.obId}'),
          '${custIntent("e-stale")}')`);
    check("PV2-40", "attaching an intent only reaches requires_action, not authorized",
      one(`select payment_state from public.couranr_payment_obligations where id='${c1.obId}'`), "requires_action");

    age(c1.rid, "20 minutes");
    check("PV2-41", "a valid requires_capture event on an EXPIRED quote is refused",
      one(authorizeEvent(c1.obId, c1.rid, BUSINESS, c1.qId, 799, "e-stale")),
      "rejected|quote_expired|requires_action");
    check("PV2-42", "... the obligation was NOT authorized",
      one(`select payment_state from public.couranr_payment_obligations where id='${c1.obId}'`), "requires_action");
    check("PV2-43", "... the request stayed at awaiting_quote_acceptance", state(c1.rid), "awaiting_quote_acceptance");
    check("PV2-44", "... no payer-approval event was recorded",
      one(`select count(*) from public.couranr_delivery_request_events
            where request_id='${c1.rid}' and command='record_payer_quote_approval'`), "0");
    check("PV2-45", "... Quote N is unchanged and no Quote N+1 was minted",
      one(`select count(*)||'|'||max(subtotal_cents) from public.couranr_quote_versions where request_id='${c1.rid}'`),
      "1|799");
    check("PV2-54", "... and the app-layer reuse check agrees the quote is expired",
      one(`select public.couranr_obligation_quote_expired('${c1.obId}')`), "t");
    check("PV2-46", "... a token with 7 days of TTL left still cannot open it",
      one(`select valid||'|'||reason from public.couranr_redeem_payment_access_token(repeat('a',64))`),
      "false|quote_expired");

    /* The two enforcement points that were only covered in the ALLOW
       direction. Seven commands carry the guard; a suite that proves six of
       them is a suite that has not enumerated them. */
    const c6 = customerChain("qvl-c-issue");
    age(c6.rid, "20 minutes");
    check("PV2-78", "issuing a payment link for a stale unapproved quote is refused",
      raises(`select public.couranr_issue_payment_access_token('${c6.rid}','${c6.obId}',
              repeat('b',64), 7)`),
      "CR410|quote_expired");

    const c7rid = one(draft("qvl-c-ob", { duration: 900, staticDuration: 600, delay: 300 }));
    raw(`update public.couranr_delivery_requests set payer_type='customer' where id='${c7rid}'`);
    raw(`set session_replication_role='replica';
         update public.couranr_quote_versions set payer_type='customer' where request_id='${c7rid}';
         set session_replication_role='origin';`);
    raw(`select public.couranr_submit_delivery_request_v2('${c7rid}','${BUSINESS}',${ver(c7rid)},'${USER}',false)`);
    raw(`select public.couranr_accept_delivery_request_as_quoted('${c7rid}','${BUSINESS}',${ver(c7rid)},'${USER}')`);
    age(c7rid, "20 minutes");
    check("PV2-80", "attaching a PaymentIntent to a stale unapproved quote is refused",
      raises(`select public.couranr_attach_payment_intent('${c6.obId}',
              (select version from public.couranr_payment_obligations where id='${c6.obId}'),
              '${custIntent("e-issue")}')`),
      "CR410|quote_expired");

    check("PV2-79", "creating a payment obligation for a stale unapproved quote is refused",
      raises(`select public.couranr_create_payment_obligation('${c7rid}','${BUSINESS}','qvl-c-ob-key')`),
      "CR410|quote_expired");

    /* ---- 5. customer authorization at 14:59 succeeds --------------------- */
    const c2 = customerChain("qvl-c-1459");
    raw(`select public.couranr_attach_payment_intent('${c2.obId}',
          (select version from public.couranr_payment_obligations where id='${c2.obId}'),
          '${custIntent("e-1459")}')`);
    age(c2.rid, "14 minutes 59 seconds");
    check("PV2-47", "customer authorization at 14:59 is applied",
      one(authorizeEvent(c2.obId, c2.rid, BUSINESS, c2.qId, 799, "e-1459")),
      "applied|-|authorized");
    check("PV2-48", "... which moves the request to confirmed", state(c2.rid), "confirmed");
    check("PV2-49", "... and records the payer approval",
      one(`select count(*) from public.couranr_delivery_request_events
            where request_id='${c2.rid}' and command='record_payer_quote_approval'`), "1");

    /* ---- 6. customer authorization at exactly 15:00 is refused ----------- */
    const c3 = customerChain("qvl-c-1500");
    raw(`select public.couranr_attach_payment_intent('${c3.obId}',
          (select version from public.couranr_payment_obligations where id='${c3.obId}'),
          '${custIntent("e-1500")}')`);
    age(c3.rid, "15 minutes");
    check("PV2-50", "customer authorization at exactly 15:00 is refused",
      one(authorizeEvent(c3.obId, c3.rid, BUSINESS, c3.qId, 799, "e-1500")),
      "rejected|quote_expired|requires_action");

    /* An approval obtained IN the window is not undone by a late webhook: the
       payer confirmed at 14:00, 3DS and delivery took until well past 15:00,
       and the event still applies because expiry is judged at the moment the
       payer approved, not the moment we processed it. */
    const c4 = customerChain("qvl-c-late-hook");
    raw(`select public.couranr_attach_payment_intent('${c4.obId}',
          (select version from public.couranr_payment_obligations where id='${c4.obId}'),
          '${custIntent("e-late")}')`);
    age(c4.rid, "40 minutes");
    /* 14 minutes after the quote was minted, i.e. INSIDE the window - measured
       against the aged quote's own created_at, not against wall clock. */
    const approvedAt = one(`select (created_at + interval '14 minutes')::text
      from public.couranr_quote_versions where request_id='${c4.rid}'`);
    check("PV2-56", "a late webhook for an IN-WINDOW approval still applies",
      one(authorizeEvent(c4.obId, c4.rid, BUSINESS, c4.qId, 799, "e-late", approvedAt)),
      "applied|-|authorized");
    check("PV2-57", "... and an out-of-window approval delivered late is still refused",
      one(`select outcome||'|'||coalesce(rejected_reason,'-') from public.couranr_apply_payment_intent_state(
            'e-late-2','payment_intent.amount_capturable_updated','${custIntent("e-stale")}',
            'requires_capture',799,799,'usd',
            jsonb_build_object('paymentObligationId','${c1.obId}','couranrRequestId','${c1.rid}',
              'businessAccountId','${BUSINESS}','quoteVersionId','${c1.qId}'),
            now()::timestamptz)`),
      "rejected|quote_expired");

    /* A refusal at the authorize boundary leaves a REAL Stripe hold on the
       customer's card while Couranr's ledger still says requires_action, and
       OPS-010 cannot release it - couranr_begin_payment_release raises CR409
       unless the obligation is already 'authorized'. The convergence path is
       the provider's own cancellation (an operator in Stripe, or the automatic
       expiry of an uncaptured authorization), which this proves still applies
       from requires_action. Executed, because reading the CASE arm does not
       prove the transition guard lets it through. */
    check("PV2-58", "an expired-quote refusal cannot be released through OPS-010",
      raises(`select public.couranr_begin_payment_release('${c1.obId}'::uuid,'${OPS}'::uuid,
              (select version from public.couranr_payment_obligations where id='${c1.obId}'),
              'quote expired before authorization')`),
      "CR409|only_an_authorized_hold_may_be_released");
    check("PV2-59", "... but the provider's own cancellation still converges the ledger",
      one(`select outcome||'|'||coalesce(payment_state,'-')
           from public.couranr_apply_payment_intent_state(
             'e-stale-cancel','payment_intent.canceled','${custIntent("e-stale")}',
             'canceled',799,0,'usd',
             jsonb_build_object('paymentObligationId','${c1.obId}','couranrRequestId','${c1.rid}',
               'businessAccountId','${BUSINESS}','quoteVersionId','${c1.qId}'))`),
      "applied|cancelled");

    /* reconcilePaymentIntent supplies NO authorization moment, because a
       PaymentIntent retrieve does not carry one - PaymentIntent.created is
       when the intent was minted, not when the payer authorized. So that path
       is judged at now() and refuses conservatively. What must remain true is
       that its refusal does not become the final answer for an approval that
       really was in window: the signature-verified webhook arrives under its
       OWN event id carrying event.created, and still authorizes. */
    const c5 = customerChain("qvl-c-reconcile");
    raw(`select public.couranr_attach_payment_intent('${c5.obId}',
          (select version from public.couranr_payment_obligations where id='${c5.obId}'),
          '${custIntent("e-recon")}')`);
    age(c5.rid, "20 minutes");
    const inWindow = one(`select (created_at + interval '10 minutes')::text
      from public.couranr_quote_versions where request_id='${c5.rid}'`);
    check("PV2-60", "a reconcile with no authorization moment is judged at now() and refuses",
      one(authorizeEvent(c5.obId, c5.rid, BUSINESS, c5.qId, 799, "e-recon")),
      "rejected|quote_expired|requires_action");
    check("PV2-61", "... and the webhook carrying the REAL moment still authorizes it",
      one(authorizeEvent(c5.obId, c5.rid, BUSINESS, c5.qId, 799, "e-recon-hook", inWindow, "e-recon")),
      "applied|-|authorized");

    /* PRC-007 is a boundary only if the pinned appender is the ONLY reachable
       way to mint a quote. private.couranr_append_quote_version is unpinned
       and still live, so what closes the hole is that all four commands
       reaching it are executable by nobody: EXECUTE is revoked from anon,
       authenticated AND service_role, which are the only identities the
       application has. Asserted with has_function_privilege rather than
       grantee rows, because a privilege inherited through PUBLIC does not
       appear as a grantee row. Confirmed the same way against production. */
    for (const [id, fn] of [
      ["PV2-62", "couranr_calculate_delivery_request_estimate"],
      ["PV2-63", "couranr_create_delivery_request_draft"],
      ["PV2-64", "couranr_create_quote_version"],
      ["PV2-65", "couranr_requote_delivery_request"],
    ]) {
      check(id, `the unpinned pre-routing minting path ${fn} is executable by nobody`,
        one(`select coalesce(bool_or(
               has_function_privilege('anon',p.oid,'EXECUTE') or
               has_function_privilege('authenticated',p.oid,'EXECUTE') or
               has_function_privilege('service_role',p.oid,'EXECUTE')), false)
             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='${fn}'`),
        "f");
    }

    /* ---- 7. a real authorization survives the clock ---------------------- */
    age(c2.rid, "45 minutes");
    check("PV2-51", "an obligation authorized in time stays authorized at 45 minutes",
      one(`select payment_state from public.couranr_payment_obligations where id='${c2.obId}'`), "authorized");
    check("PV2-52", "... the approved quote is not expirable",
      one(`select private.couranr_quote_version_is_expired(q.*) from public.couranr_quote_versions q
            where q.id='${c2.qId}'`), "f");
    /* The later lifecycle is gated by its OWN preconditions and not by the
       quote window: capture refuses here because the delivery has not reached
       pickup, which this fixture never drives it to. `pickup_not_ready` rather
       than `quote_expired` is exactly the point - a 45-minute-old APPROVED
       quote puts nothing in the way. */
    check("PV2-53", "... and the later lifecycle is blocked by its own rules, not by expiry",
      raises(`select public.couranr_begin_payment_capture('${c2.rid}'::uuid,'${USER}'::uuid)`),
      "CR409|pickup_not_ready");

    /* ------------------------------------ QVL rollback round trip ------- */
    /* The forward migration is executed by up.mjs on every run of this suite.
       Its ROLLBACK had never been executed by anything - foundationRollbacks
       covers M1..M6 only - so it was a file nobody had ever run. Applied as a
       SCRIPT rather than inside a DO block, because that is how a migration
       actually reaches a database. */
    const applyScript = (file) => {
      try {
        raw(readFileSync(file, "utf8")
          .replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, ""));
        return "NO_ERROR|";
      } catch (e) {
        return `ERROR|${String(e.message).split("\n").find((l) => /ERROR:/.test(l)) ?? "unknown"}`;
      }
    };
    const QVL_FWD = "supabase/migrations/20260902161642_couranr_quote_validity_and_policy_pin.sql";
    const QVL_BACK =
      "supabase/rollbacks/20260902161642_couranr_quote_validity_and_policy_pin.rollback.sql";
    const fnCount = (schema, name) =>
      one(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='${schema}' and p.proname='${name}'`);

    check("PV2-66", "the QVL rollback applies cleanly", applyScript(QVL_BACK), "NO_ERROR|");
    check("PV2-67", "... the private validity predicate is gone",
      fnCount("private", "couranr_quote_version_is_expired"), "0");
    check("PV2-68", "... the private payer-approval predicate is gone",
      fnCount("private", "couranr_quote_payer_approved"), "0");
    check("PV2-69", "... the app-layer reuse helper is gone",
      fnCount("public", "couranr_obligation_quote_expired"), "0");
    /* The arity trap: rolling back a function that GAINED a parameter has to
       drop the new form, or both survive and every call is ambiguous. */
    check("PV2-70", "... apply_payment_intent_state is back to exactly one 8-argument form",
      one(`select count(*)||'|'||coalesce(max(pronargs),0) from pg_proc p
             join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='couranr_apply_payment_intent_state'`),
      "1|8");
    const r1 = one(draft("qvl-rb-stale"));
    age(r1, "40 minutes");
    check("PV2-71", "... and a 40-minute-old quote can be acknowledged again",
      raises(`select public.couranr_submit_delivery_request_v2('${r1}','${BUSINESS}',${ver(r1)},'${USER}',true)`),
      "NO_ERROR|");
    /* An UNKNOWN policy identifier, not the V1 one. The pre-QVL boundary is a
       blacklist of the superseded string, so V1 is refused on both sides of
       this rollback and would prove nothing. PRC-007 asked for an allow-list,
       and this is the difference between the two: a fabricated version passes
       a blacklist and must not pass a pin. */
    check("PV2-72", "... and the pre-QVL boundary is only a blacklist, which a made-up version passes",
      raises(draft("qvl-rb-policy", { policy: "couranr-pricing-v9-2099-01-01" })), "NO_ERROR|");

    check("PV2-73", "the forward migration re-applies over its own rollback",
      applyScript(QVL_FWD), "NO_ERROR|");
    const r2 = one(draft("qvl-fw-stale"));
    age(r2, "40 minutes");
    check("PV2-74", "... and the 15-minute refusal is back",
      raises(`select public.couranr_submit_delivery_request_v2('${r2}','${BUSINESS}',${ver(r2)},'${USER}',true)`),
      "CR410|quote_expired");
    check("PV2-75", "... and the pin refuses that same made-up version an allow-list must reject",
      raises(draft("qvl-fw-policy", { policy: "couranr-pricing-v9-2099-01-01" })),
      "CR422|unsupported_pricing_policy_version");
    check("PV2-77", "... and refuses the superseded V1 identifier under the same rule",
      raises(draft("qvl-fw-v1", { policy: "couranr-pricing-2026-07-31" })),
      "CR422|unsupported_pricing_policy_version");
    /* The recovery path. If the SQL commits but the migration ledger row does
       not get written - the Supabase apply path writes it in a separate round
       trip - the only fix is to run the migration again. The guard used to
       name ONLY the 8-argument apply command, which this migration itself
       drops, so a second run aborted claiming the Gate A cutover was missing:
       false, and the most alarming possible way to be wrong. */
    check("PV2-81", "the forward migration is re-runnable over itself",
      applyScript(QVL_FWD), "NO_ERROR|");
    const r3 = one(draft("qvl-rerun-stale"));
    age(r3, "40 minutes");
    check("PV2-82", "... and a second run leaves the guards behaving identically",
      raises(`select public.couranr_submit_delivery_request_v2('${r3}','${BUSINESS}',${ver(r3)},'${USER}',true)`),
      "CR410|quote_expired");

    check("PV2-76", "... with still exactly one 9-argument apply command",
      one(`select count(*)||'|'||coalesce(max(pronargs),0) from pg_proc p
             join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='couranr_apply_payment_intent_state'`),
      "1|9");

    /* ------------------------------------------------------- rollback --- */

    const rollback = readFileSync(
      "supabase/rollbacks/20260902042602_couranr_pricing_v2_traffic_authority.rollback.sql", "utf8");
    const attempted = raises(rollback.replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, ""));
    check("PV2-16", "the rollback HARD-REFUSES once V2 quote evidence exists",
      attempted.split("|")[1], "pricing_v2_rollback_would_destroy_commercial_evidence");
    check("PV2-17", "... and the traffic evidence survives the refused rollback",
      one(`select route_traffic_delay_seconds from public.couranr_quote_versions where request_id='${okId}'`), "300");
    check("PV2-18", "... and the historical amount survives it too",
      one(`select subtotal_cents from public.couranr_quote_versions
            where request_id='33333333-3333-4333-8333-333333333333'`), "2299");

    console.log(`\n  Pricing V2 authority: ${pass} passed, ${fail} failed\n`);
  } finally {
    if (!KEEP) down({ quiet: true });
  }
  process.exit(fail === 0 ? 0 : 1);
}
main();
