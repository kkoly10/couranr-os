/**
 * EXECUTION VERIFICATION for launch batch 3 §A/§B:
 *   20260903010000_couranr_payment_authorization_evidence
 *   20260903020000_couranr_payment_recovery
 *
 * Same doctrine as releaseAuthorization.mjs: a migration applying proves it
 * parses; only CALLING the commands against real rows proves they run. Every
 * §35 PAYMENT matrix item that lives at the database layer is executed here.
 *
 *   EVIDENCE (§A)
 *   PR-01  a provider-timed authorization stamps authorized_at = the provider
 *          instant, source provider_event, with a SEPARATE processing time
 *   PR-02  the 10:00/10:14/10:20 regression: authorization != processing
 *   PR-03  no provider instant -> processing_fallback, honestly marked
 *   PR-04  a later verified event UPGRADES a fallback row to provider truth
 *          (audited, state unchanged)
 *   PR-05  the duplicate of that event is 'duplicate' — applied once
 *   PR-06  provider-sourced evidence is never overwritten
 *   PR-07  anon/authenticated cannot execute the apply command at all
 *
 *   STALE-HOLD RELEASE (§B)
 *   PR-08  an out-of-window authorization is refused (quote_expired) and the
 *          obligation keeps its pre-authorization state — the stale hold
 *   PR-09  Operations releases that stale hold: begin accepts requires_action
 *   PR-10  ... complete records provider 'canceled' -> cancelled
 *   PR-11  ... replayed release is 'ignored', not an error
 *   PR-12  captured money may NOT be released (refund territory)     CR409
 *   PR-13  a mismatched intent id is rejected and changes nothing
 *
 *   REFUND (§B)
 *   PR-14  full refund: server-derived amount, attempt persisted BEFORE any
 *          provider call, complete(succeeded) -> obligation refunded
 *   PR-15  duplicate completion converges — money moves exactly once
 *   PR-16  begin replay returns the SAME live attempt, never a second row
 *   PR-17  the schema forbids a second live attempt outright (23505)
 *   PR-18  governed cancellation refund retains exactly $8
 *   PR-19  failed pickup retains exactly $15
 *   PR-20  Couranr-caused failure retains $0
 *   PR-21  retention >= captured -> settled_no_refund_due: a REAL settled
 *          outcome, actual retained = captured, ZERO provider refunds, and
 *          no later standalone full refund can ever exist (final closure §3)
 *   PR-22  completion amount mismatch is refused, nothing written
 *   PR-23  refund beyond captured is unwritable (23514 bounds CHECK)
 *   PR-24  an uncaptured obligation cannot be refunded               CR409
 *   PR-25  unknown-outcome discipline: requested -> pending_unknown -> a later
 *          verified completion still converges on the SAME attempt
 *   PR-26  a non-Operations actor cannot begin a refund              CR403
 *   PR-27  the refund commands take NO amount parameter (proved from the
 *          catalog) and anon/authenticated hold no EXECUTE on any of them
 *   PR-28  the seeded fixtures leave couranr_foundation_integrity() clean
 *   PR-29  §4 receivable: $8 owed on confirmed-before-delivery cancellation,
 *          recorded once, idempotent, governed figures only, Operations only
 */
import crypto from "node:crypto";
import { up, psql } from "./up.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalDeliveryChain,
  seedCanonicalPaymentObligation,
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

function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`,
  );
  return id;
}

/** Named apply call with the metadata the SQL cross-checks. */
function applySql(f, { eventId, authorizedAt = null, amountCapturable = null }) {
  const cap = amountCapturable ?? f.amountCents;
  const at = authorizedAt ? `'${authorizedAt}'::timestamptz` : "null";
  return `select (public.couranr_apply_payment_intent_state(
    '${eventId}', 'payment_intent.amount_capturable_updated', '${f.intentId}',
    'requires_capture', ${f.amountCents}, ${cap}, 'usd',
    jsonb_build_object('paymentObligationId','${f.obligationId}',
      'couranrRequestId','${f.requestId}','businessAccountId','${f.bizId}',
      'quoteVersionId','${f.quoteVersionId}'),
    ${at})).outcome`;
}

const obCol = (id, col) =>
  one(`select coalesce(${col}::text,'-') from public.couranr_payment_obligations where id='${id}'`);

async function main() {
  up();
  const t = psqlTransport(psql);
  try {
    console.log("\n  payment authorization evidence + recovery — execution verification\n");

    const bizId = one(
      `insert into public.business_accounts (name, slug, status)
       values ('Recovery Co', 'recovery-co-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`,
    );
    const ops = seedActor(`ops+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
    const merchant = seedActor(`mer+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "merchant");
    psql(`insert into public.business_members (business_account_id, user_id, role, status)
          values ('${bizId}', '${merchant}', 'owner', 'active')`);

    /** A request + not_started obligation + attached intent (requires_action). */
    async function seedAttached(marker, { payerType = "merchant", upTo = "confirmed" } = {}) {
      const request = await seedCanonicalQuotedRequest(t, {
        businessId: bizId, actorUserId: merchant, marker, upTo, payerType,
      });
      const ob = await seedCanonicalPaymentObligation(t, request, { paymentState: "not_started", withIntent: false });
      const intentId = syntheticIntentId();
      await t.rpc("couranr_attach_payment_intent", {
        p_obligation_id: ob.obligationId, p_expected_version: 1, p_payment_intent_id: intentId,
      });
      return {
        requestId: request.requestId, quoteVersionId: request.quoteVersionId,
        obligationId: ob.obligationId, amountCents: ob.amountCents, intentId, bizId,
      };
    }

    /* ═════════ §A — authorization evidence ═════════ */

    const T14 = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // "10:14"
    const a = await seedAttached(`pra-${crypto.randomUUID().slice(0, 6)}`);
    eq("PR-01a", "a provider-timed authorization applies",
       one(applySql(a, { eventId: `evt-${a.obligationId}-1`, authorizedAt: T14 })), "applied");
    eq("PR-01b", "... authorized_at IS the provider instant",
       one(`select (authorized_at = '${T14}'::timestamptz)::text from public.couranr_payment_obligations where id='${a.obligationId}'`),
       "true");
    eq("PR-01c", "... source says provider_event", obCol(a.obligationId, "authorized_at_source"), "provider_event");
    eq("PR-02", "the 10:00/10:14/10:20 regression: processing time recorded SEPARATELY, after the provider instant",
       one(`select (authorization_processed_at > authorized_at)::text
              from public.couranr_payment_obligations where id='${a.obligationId}'`),
       "true");

    const b = await seedAttached(`prb-${crypto.randomUUID().slice(0, 6)}`);
    eq("PR-03a", "no provider instant -> still authorizes (conservative processing time)",
       one(applySql(b, { eventId: `evt-${b.obligationId}-1` })), "applied");
    eq("PR-03b", "... and says so: processing_fallback, not a fabricated provider time",
       obCol(b.obligationId, "authorized_at_source"), "processing_fallback");

    const T14b = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    eq("PR-04a", "a later verified event upgrades the fallback row to provider truth",
       one(applySql(b, { eventId: `evt-${b.obligationId}-2`, authorizedAt: T14b })), "applied");
    eq("PR-04b", "... authorized_at is now the provider instant",
       one(`select (authorized_at = '${T14b}'::timestamptz)::text || '|' || authorized_at_source
              from public.couranr_payment_obligations where id='${b.obligationId}'`),
       "true|provider_event");
    eq("PR-04c", "... the upgrade is an audited payment event",
       one(`select count(*) from public.couranr_payment_events
             where obligation_id='${b.obligationId}'
               and detail->>'reason' = 'authorization_time_reconciled'
               and provider_event_id='evt-${b.obligationId}-2'`),
       "1");
    eq("PR-04d", "... and the payment state never moved",
       obCol(b.obligationId, "payment_state"), "authorized");
    eq("PR-05", "the duplicate of that event is 'duplicate' — applied exactly once",
       one(applySql(b, { eventId: `evt-${b.obligationId}-2`, authorizedAt: T14b })), "duplicate");
    eq("PR-06", "provider-sourced evidence is never overwritten by a third event",
       one(applySql(b, { eventId: `evt-${b.obligationId}-3`, authorizedAt: new Date().toISOString() })) + "|" +
         one(`select (authorized_at = '${T14b}'::timestamptz)::text from public.couranr_payment_obligations where id='${b.obligationId}'`),
       "ignored|true");
    eq("PR-07", "anon/authenticated cannot execute the apply command",
       one(`select has_function_privilege('anon',
              'public.couranr_apply_payment_intent_state(text,text,text,text,integer,integer,text,jsonb,timestamptz)','EXECUTE')::text
            || ',' || has_function_privilege('authenticated',
              'public.couranr_apply_payment_intent_state(text,text,text,text,integer,integer,text,jsonb,timestamptz)','EXECUTE')::text`),
       "false,false");

    /* ═════════ §B — stale-hold release ═════════ */

    // Customer payer, stopped at submit: no merchant acknowledgment counts as
    // payer approval, so the quote CAN expire — the stale-quote scenario.
    const c = await seedAttached(`prc-${crypto.randomUUID().slice(0, 6)}`, { payerType: "customer", upTo: "confirmed" });
    const T35 = new Date(Date.now() + 20 * 60 * 1000).toISOString(); // beyond the 15-min window
    eq("PR-08a", "an out-of-window authorization is refused as quote_expired",
       one(`select outcome || '|' || coalesce(rejected_reason,'-') from public.couranr_apply_payment_intent_state(
              'evt-${c.obligationId}-stale', 'payment_intent.amount_capturable_updated', '${c.intentId}',
              'requires_capture', ${c.amountCents}, ${c.amountCents}, 'usd',
              jsonb_build_object('paymentObligationId','${c.obligationId}',
                'couranrRequestId','${c.requestId}','businessAccountId','${c.bizId}',
                'quoteVersionId','${c.quoteVersionId}'),
              '${T35}'::timestamptz)`),
       "rejected|quote_expired");
    eq("PR-08b", "... leaving the STALE HOLD: provider money held, Couranr never authorized",
       obCol(c.obligationId, "payment_state"), "requires_action");
    const cVer = obCol(c.obligationId, "version");
    eq("PR-09", "Operations begins release of the stale hold (pre-§B this was refused)",
       one(`select (public.couranr_begin_payment_release('${c.obligationId}','${ops}',${cVer},'stale quote hold')).outcome`),
       "applied");
    eq("PR-10a", "complete records the provider cancellation",
       one(`select (public.couranr_complete_payment_release('${c.obligationId}','${c.intentId}','canceled')).outcome`),
       "applied");
    eq("PR-10b", "... requires_action -> cancelled, stamped",
       one(`select payment_state || '|' || (cancelled_at is not null)::text
              from public.couranr_payment_obligations where id='${c.obligationId}'`),
       "cancelled|true");
    eq("PR-11", "a replayed release is 'ignored', not an error",
       one(`select (public.couranr_begin_payment_release('${c.obligationId}','${ops}',${Number(cVer) + 1},'again')).outcome`),
       "ignored");

    const dOb = await seedCaptured(`prd-${crypto.randomUUID().slice(0, 6)}`);
    eq("PR-12", "captured money may NOT be released — that is a refund",
       raises(`select public.couranr_begin_payment_release('${dOb.obligationId}','${ops}',${dOb.version},'no')`).split("|")[1],
       "only_an_authorized_hold_may_be_released");
    const e2 = await seedAttached(`pre-${crypto.randomUUID().slice(0, 6)}`);
    one(applySql(e2, { eventId: `evt-${e2.obligationId}-1` }));
    const e2Ver = obCol(e2.obligationId, "version");
    one(`select public.couranr_begin_payment_release('${e2.obligationId}','${ops}',${e2Ver},'mismatch probe')`);
    eq("PR-13", "a mismatched intent id is rejected by complete and changes nothing",
       one(`select (public.couranr_complete_payment_release('${e2.obligationId}','pi_wrong_intent','canceled')).outcome`) +
         "|" + obCol(e2.obligationId, "payment_state"),
       "rejected|authorized");

    /* ═════════ §B — refunds ═════════ */

    /** A CAPTURED obligation the way the product produces one: capture is
        followed by the converted delivery, so couranr_foundation_integrity()
        has nothing to report (captured_without_delivery — measured). */
    async function seedCaptured(marker, opts = {}) {
      const chain = await seedCanonicalDeliveryChain(t, {
        businessId: bizId, actorUserId: merchant, marker, stopAfter: "delivery", ...opts,
      });
      const amountCents = Number(
        one(`select captured_amount_cents from public.couranr_payment_obligations where id='${chain.obligationId}'`)
      );
      const intentId = one(
        `select provider_payment_intent_id from public.couranr_payment_obligations where id='${chain.obligationId}'`
      );
      const version = Number(obCol(chain.obligationId, "version"));
      return { requestId: chain.requestId, obligationId: chain.obligationId, amountCents, intentId, version };
    }

    const refundBegin = (obId, actor, ver, reason) =>
      `select attempt_state || '|' || amount_cents || '|' || retained_cents
         from public.couranr_begin_payment_refund('${obId}','${actor}',${ver},'${reason}')`;
    const refundRow = (obId) =>
      one(`select id || '|' || amount_cents || '|' || attempt_state from public.couranr_payment_refunds
            where obligation_id='${obId}' order by created_at desc limit 1`);

    const fOb = await seedCaptured(`prf-${crypto.randomUUID().slice(0, 6)}`);
    eq("PR-14a", "full refund: the attempt is persisted with the SERVER-derived amount",
       one(refundBegin(fOb.obligationId, ops, fOb.version, "full_refund")),
       `requested|${fOb.amountCents}|0`);
    const [fRefId] = refundRow(fOb.obligationId).split("|");
    eq("PR-14b", "complete(succeeded) settles the attempt and the obligation",
       one(`select attempt_state from public.couranr_complete_payment_refund(
              '${fRefId}','re_${crypto.randomUUID().slice(0, 12)}','succeeded',${fOb.amountCents})`),
       "succeeded");
    eq("PR-14c", "... obligation refunded, amount and stamp recorded",
       one(`select payment_state || '|' || refunded_amount_cents || '|' || (refunded_at is not null)::text
              from public.couranr_payment_obligations where id='${fOb.obligationId}'`),
       `refunded|${fOb.amountCents}|true`);
    eq("PR-15", "a duplicate completion converges — money moves exactly once",
       one(`select attempt_state from public.couranr_complete_payment_refund(
              '${fRefId}','re_other','succeeded',${fOb.amountCents})`),
       "succeeded");
    eq("PR-15b", "... and exactly ONE refund-completed event exists",
       one(`select count(*) from public.couranr_payment_events
             where provider_event_id = 'couranr:refund_done:${fRefId}'`),
       "1");

    const gOb = await seedCaptured(`prg-${crypto.randomUUID().slice(0, 6)}`);
    one(refundBegin(gOb.obligationId, ops, gOb.version, "full_refund"));
    const [gRefId] = refundRow(gOb.obligationId).split("|");
    eq("PR-16", "begin replay returns the SAME live attempt, never a second row",
       one(`select (id = '${gRefId}')::text from public.couranr_begin_payment_refund(
              '${gOb.obligationId}','${ops}',${gOb.version + 1},'full_refund')`),
       "true");
    eq("PR-17", "the schema forbids a second live attempt outright",
       raises(`insert into public.couranr_payment_refunds
                (obligation_id, request_id, provider_payment_intent_id, amount_cents, reason, refund_key, actor_user_id)
               values ('${gOb.obligationId}','${gOb.requestId}','${gOb.intentId}',100,'full_refund','k-${crypto.randomUUID()}','${ops}')`).split("|")[0],
       "23505");

    /* Governed retentions. Fixture amounts come off the quote; assert the
       arithmetic against whatever the captured amount actually is. */
    async function governed(id, reason, retained) {
      const ob = await seedCaptured(`prr-${crypto.randomUUID().slice(0, 6)}`);
      const expect = ob.amountCents - retained;
      if (expect <= 0) {
        eq(id, `${reason}: retention >= captured refuses (no negative refund)`,
           raises(refundBegin(ob.obligationId, ops, ob.version, reason)).split("|")[1], "nothing_to_refund_after_retention");
        return;
      }
      eq(id, `${reason} retains exactly ${retained} cents`,
         one(refundBegin(ob.obligationId, ops, ob.version, reason)), `requested|${expect}|${retained}`);
      const [refId] = refundRow(ob.obligationId).split("|");
      one(`select attempt_state from public.couranr_complete_payment_refund(
             '${refId}','re_${crypto.randomUUID().slice(0, 12)}','succeeded',${expect})`);
      // A retention leaves the obligation captured holding the fee; a $0
      // retention refunds everything and the state says so.
      const wantState = retained > 0 ? "captured" : "refunded";
      eq(`${id}b`, `... obligation ${wantState} with ${expect} cents refunded`,
         one(`select payment_state || '|' || refunded_amount_cents from public.couranr_payment_obligations where id='${ob.obligationId}'`),
         `${wantState}|${expect}`);
    }
    await governed("PR-18", "cancel_after_confirmation_before_arrival", 800);
    await governed("PR-19", "failed_pickup_after_arrival", 1500);
    await governed("PR-20", "couranr_caused_failure", 0);

    /* §3 — THE RETENTION CONSUMES THE CAPTURE. A $7.99 Pricing V2 capture
       against the $8 cancellation retention: refund due max(7.99-8, 0)=0,
       Stripe is called zero times (there is no provider id to even record),
       and the settlement is REAL and durable — retained = the ACTUAL capture,
       never the nominal $8. */
    const hOb = await seedCaptured(`prh-${crypto.randomUUID().slice(0, 6)}`, { subtotalCents: 799 });
    eq("PR-21a", "$7.99 capture + $8 cancellation -> settled_no_refund_due, retained 799, refund 0",
       one(refundBegin(hOb.obligationId, ops, hOb.version, "cancel_after_confirmation_before_arrival")),
       "settled_no_refund_due|0|799");
    eq("PR-21b", "... durable: the settlement row and its audited event both exist, with NO provider refund id",
       one(`select r.attempt_state || '|' || coalesce(r.provider_refund_id,'-') || '|' ||
                   (select count(*) from public.couranr_payment_events e
                     where e.obligation_id='${hOb.obligationId}'
                       and e.event_type='couranr.refund.settled_no_refund_due')
              from public.couranr_payment_refunds r
             where r.obligation_id='${hOb.obligationId}'`),
       "settled_no_refund_due|-|1");
    eq("PR-21c", "... the obligation keeps its captured money (retained, not refunded)",
       one(`select payment_state || '|' || coalesce(refunded_amount_cents,0)
              from public.couranr_payment_obligations where id='${hOb.obligationId}'`),
       "captured|0");
    eq("PR-21d", "... a retried cancellation begin converges on the SAME settled row",
       one(refundBegin(hOb.obligationId, ops, hOb.version + 1, "cancel_after_confirmation_before_arrival")),
       "settled_no_refund_due|0|799");
    eq("PR-21e", "... and a later STANDALONE full_refund can never mint a second refund — it replays the settlement",
       one(refundBegin(hOb.obligationId, ops, hOb.version + 1, "full_refund")),
       "settled_no_refund_due|0|799");
    eq("PR-21f", "... schema-enforced too: a second live attempt row is impossible (23505)",
       raises(`insert into public.couranr_payment_refunds
                 (obligation_id, request_id, provider_payment_intent_id, amount_cents,
                  retained_cents, reason, refund_key, attempt_state, actor_user_id)
               select obligation_id, request_id, provider_payment_intent_id, 100,
                      0, 'full_refund', 'couranr:refund:probe-' || gen_random_uuid()::text,
                      'requested', actor_user_id
                 from public.couranr_payment_refunds where obligation_id='${hOb.obligationId}'`),
       "23505|duplicate key value violates unique constraint \"couranr_pr_one_live_attempt_uniq\"");

    /* The same invariant under the $15 failed-pickup fee. */
    const h2Ob = await seedCaptured(`ph2-${crypto.randomUUID().slice(0, 6)}`, { subtotalCents: 1250 });
    eq("PR-21g", "a $12.50 capture under the $15 failed-pickup fee settles zero-due with retained 1250",
       one(refundBegin(h2Ob.obligationId, ops, h2Ob.version, "failed_pickup_after_arrival")),
       "settled_no_refund_due|0|1250");

    const iOb = await seedCaptured(`pri-${crypto.randomUUID().slice(0, 6)}`);
    one(refundBegin(iOb.obligationId, ops, iOb.version, "full_refund"));
    const [iRefId, iAmount] = refundRow(iOb.obligationId).split("|");
    eq("PR-22", "a completion amount that is not the attempt amount is refused",
       raises(`select public.couranr_complete_payment_refund('${iRefId}','re_x','succeeded',${Number(iAmount) + 1})`).split("|")[1],
       "refund_amount_mismatch");
    eq("PR-23", "refund beyond captured is unwritable at the schema",
       raises(`update public.couranr_payment_obligations
                 set refunded_amount_cents = captured_amount_cents + 1 where id='${iOb.obligationId}'`).split("|")[0],
       "23514");
    eq("PR-25a", "unknown-outcome discipline: the attempt parks at pending_unknown",
       one(`select attempt_state from public.couranr_mark_payment_refund_unknown('${iRefId}', '{"reason":"timeout"}'::jsonb)`),
       "pending_unknown");
    eq("PR-25b", "... and a later verified completion converges on the SAME attempt",
       one(`select attempt_state from public.couranr_complete_payment_refund(
              '${iRefId}','re_${crypto.randomUUID().slice(0, 12)}','succeeded',${iAmount})`),
       "succeeded");

    const j = await seedAttached(`prj-${crypto.randomUUID().slice(0, 6)}`);
    one(applySql(j, { eventId: `evt-${j.obligationId}-1` }));
    eq("PR-24", "an uncaptured (authorized) obligation cannot be refunded",
       raises(`select public.couranr_begin_payment_refund('${j.obligationId}','${ops}',2,'full_refund')`).split("|")[1],
       "only_captured_money_may_be_refunded");
    eq("PR-26", "a non-Operations actor cannot begin a refund",
       raises(`select public.couranr_begin_payment_refund('${j.obligationId}','${merchant}',2,'full_refund')`).split("|")[1],
       "operations_access_required");

    eq("PR-27a", "the refund commands take NO amount parameter anywhere",
       one(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname in
               ('couranr_begin_payment_refund','couranr_mark_payment_refund_unknown')
               and array_to_string(p.proargnames,',') like '%amount%'`),
       "0");
    eq("PR-27b", "anon/authenticated hold no EXECUTE on any refund command",
       one(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')
                        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname in
               ('couranr_begin_payment_refund','couranr_mark_payment_refund_unknown',
                'couranr_complete_payment_refund')`),
       "false");

    /* §4 — the confirmed-before-delivery receivable: released hold + $8 owed,
       recorded as ONE immutable payment event, converging on retries. */
    const rOb = await seedAttached(`prr-${crypto.randomUUID().slice(0, 6)}`);
    eq("PR-29a", "the $8 receivable records once with collected:false",
       one(`select event_type || '|' || (detail->>'retainedDueCents') || '|' || (detail->>'collected')
              from public.couranr_record_cancellation_settlement(
                '${rOb.obligationId}', '${ops}', 800, 'cancellation:merchant_request — e2e')`),
       "couranr.cancellation.receivable|800|false");
    eq("PR-29b", "... a retry converges on the SAME event, never a second receivable",
       one(`select (select (detail->>'reason') from public.couranr_record_cancellation_settlement(
                      '${rOb.obligationId}', '${ops}', 800, 'retry'))
                   || '|' ||
                   (select count(*) from public.couranr_payment_events
                     where provider_event_id = 'couranr:cancellation_receivable:${rOb.obligationId}')`),
       "cancellation:merchant_request — e2e|1");
    eq("PR-29c", "... only CAN-001's own figures are recordable",
       raises(`select public.couranr_record_cancellation_settlement(
                 '${rOb.obligationId}', '${ops}', 999, 'x')`).split("|")[1],
       "settlement_amount_not_governed");
    eq("PR-29d", "... and a non-Operations actor is refused",
       raises(`select public.couranr_record_cancellation_settlement(
                 '${rOb.obligationId}', '${merchant}', 800, 'x')`).split("|")[1],
       "operations_access_required");

    const integrity = await gateAIntegrityIssues(psqlTransport(psql));
    eq("PR-28", "the seeded fixtures leave couranr_foundation_integrity() clean",
       integrity.join(",") || "clean", "clean");

    console.log(`\n  Payment recovery: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    // up() at the top recreated the cluster; leave teardown to the next suite's up().
  }
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exitCode = 1;
});
