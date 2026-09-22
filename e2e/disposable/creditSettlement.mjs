/**
 * EXECUTION VERIFICATION for the credit settlement XOR fix:
 *   20260905080000_couranr_confirm_service_plan_credit_settlement_fix
 *
 * couranr_confirm_service_plan wrote the payment obligation id in BOTH arms of
 * its CASE, so a credit-backed plan that also had a coexisting non-cancelled
 * obligation (couranr_apply_promotional_credit does not cancel a requires_action
 * hold) was inserted with both settlement ids set — violating the live XOR
 * (CHECK couranr_sp_settlement_identity_chk / trigger couranr_sp_quote_invariant_trg).
 * A migration applying proves it parses; only CALLING it against a real fixture
 * proves it runs.
 *
 *   CS-1  a credit-backed confirm WITH a coexisting requires_action obligation
 *         does NOT raise, returns a plan, payment_obligation_id IS NULL and
 *         promotional_credit_id = the applied credit
 *   CS-2  the paid path is unchanged: no credit + one authorized obligation
 *         returns a plan with payment_obligation_id = the obligation, credit null
 *   CS-3  POSITIVE CONTROL — the pre-fix (rollback) body raises on the SAME
 *         credit fixture, proving the fixture actually exercises the XOR and the
 *         fix is what makes CS-1 pass
 *   CS-4  anon/authenticated hold no EXECUTE on the planning function
 *   CS-5  a matching applied credit lets the merchant mark pickup ready without
 *         inventing a Stripe authorization, and records the commercial authority
 *   CS-6  POSITIVE CONTROL — rolling back readiness parity makes that SAME
 *         credited-readiness transition fail with payment_not_authorized
 *   CS-7  credit-funded plan/delivery keep exact quote identity and make the
 *         permanent integrity probe clean; the original M5 probe flags them
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { up, down, psql } from "./up.mjs";
import {
  psqlTransport,
  seedCanonicalQuotedRequest,
  seedCanonicalPaymentObligation,
} from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
     select code || '|' || msg from _probe;`
  ).trim();
}
function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`
  );
  return id;
}

const uniq = () => crypto.randomUUID().slice(0, 8);
const reqVersion = (rid) => one(`select version from public.couranr_delivery_requests where id='${rid}'`);
const confirmCall = (rid, ver, ops) =>
  `public.couranr_confirm_service_plan('${rid}', ${ver}, '${ops}',
     now() + interval '1 day', now() + interval '1 day 2 hours',
     'America/New_York', null, '{"vehicleClass":"van","maxPayloadLb":2000}'::jsonb)`;

async function main() {
  up();
  const t = psqlTransport(psql);
  try {
    console.log("\n  credit settlement XOR — execution verification\n");

    const integrityRollback = readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260922134911_couranr_integrity_credit_settlement_parity.rollback.sql"), "utf8"
    );
    const integrityForward = readFileSync(
      path.join(ROOT, "supabase/migrations/20260922134911_couranr_integrity_credit_settlement_parity.sql"), "utf8"
    );
    psql(integrityRollback);
    psql(integrityForward);
    eq("CS-7f", "no-credit rollback and forward reapply preserve a clean probe",
       one(`select count(*) from public.couranr_foundation_integrity()`), "0");
    eq("CS-7h", "integrity probe remains service-role only after replacement",
       one(`select has_function_privilege('anon',
                 'public.couranr_foundation_integrity()','EXECUTE')::text || ',' ||
                   has_function_privilege('authenticated',
                 'public.couranr_foundation_integrity()','EXECUTE')::text || ',' ||
                   has_function_privilege('service_role',
                 'public.couranr_foundation_integrity()','EXECUTE')::text`),
       "false,false,true");

    const bizId = one(
      `insert into public.business_accounts (name, slug, status)
       values ('Credit Co', 'credit-co-${uniq()}', 'active') returning id`
    );
    const ops = seedActor(`ops+${uniq()}@e2e.couranr.test`, "admin");
    const merchant = seedActor(`mer+${uniq()}@e2e.couranr.test`, "merchant");
    psql(`insert into public.business_members (business_account_id, user_id, role, status)
          values ('${bizId}', '${merchant}', 'owner', 'active')`);

    // A confirmed request + a coexisting non-cancelled (requires_action) obligation
    // + an applied promotional credit that matches the current quote — the exact
    // state couranr_apply_promotional_credit leaves behind for the pilot.
    async function seedCreditScenario(marker) {
      const request = await seedCanonicalQuotedRequest(t, {
        businessId: bizId, actorUserId: merchant, marker, upTo: "confirmed", payerType: "merchant",
      });
      await seedCanonicalPaymentObligation(t, request, { paymentState: "requires_action" });
      const subtotal = request.subtotalCents;
      const creditId = one(
        `insert into public.couranr_promotional_credits
           (request_id, business_account_id, quote_version_id,
            standard_quote_cents, promotional_credit_cents, amount_paid_cents,
            reason, campaign, market, category, approved_by, status)
         values ('${request.requestId}', '${bizId}', '${request.quoteVersionId}',
            ${subtotal}, ${subtotal}, 0,
            'pilot comp', 'pilot', 'dc_va_launch_corridor', 'operations', '${ops}', 'applied')
         returning id`
      );
      return { request, creditId, subtotal };
    }

    /* ── CS-1 / CS-5: credit readiness + planning both honor the same authority ── */
    const s1 = await seedCreditScenario(`cs1-${uniq()}`);

    // CS-5: the merchant may declare a credited shipment ready without a
    // fabricated Stripe authorization. Before 20260918233000 this exact
    // fixture failed because the readiness helper only recognized an
    // authorized payment obligation.
    const readyV1 = reqVersion(s1.request.requestId);
    const ready1 = raises(
      `select public.couranr_mark_delivery_ready(
         '${s1.request.requestId}', '${bizId}', ${readyV1}, '${merchant}')`
    );
    eq("CS-5a", "credited request can be marked ready without Stripe authorization",
       ready1.split("|")[0], "NO_ERROR");
    eq("CS-5b", "credited request persisted readiness=ready",
       one(`select readiness_state from public.couranr_delivery_requests
             where id='${s1.request.requestId}'`),
       "ready");
    eq("CS-5c", "readiness event records promotional_credit as commercial authority",
       one(`select coalesce(metadata->>'commercialAuthority','NULL')
             from public.couranr_delivery_request_events
             where request_id='${s1.request.requestId}'
               and command='mark_delivery_ready'
             order by created_at desc limit 1`),
       "promotional_credit");

    const v1 = reqVersion(s1.request.requestId);
    const raised1 = raises(`select ${confirmCall(s1.request.requestId, v1, ops)}`);
    eq("CS-1a", "credit confirm with a coexisting requires_action obligation does NOT raise",
       raised1.split("|")[0], "NO_ERROR");
    // The call (inside the NO_ERROR probe) committed the plan; read it back.
    eq("CS-1b", "the confirmed credit plan has payment_obligation_id NULL",
       one(`select coalesce(payment_obligation_id::text,'NULL') from public.couranr_service_plans
             where request_id='${s1.request.requestId}' and plan_state='confirmed'`),
       "NULL");
    eq("CS-1c", "... and promotional_credit_id = the applied credit",
       one(`select promotional_credit_id from public.couranr_service_plans
             where request_id='${s1.request.requestId}' and plan_state='confirmed'`),
       s1.creditId);

    /* ── CS-7: the integrity probe must understand BOTH settlement sources ── */
    const conversion = raises(
      `select public.couranr_create_delivery_from_promotional_credit('${s1.request.requestId}')`
    );
    eq("CS-7a", "credit-backed delivery conversion succeeds", conversion.split("|")[0], "NO_ERROR");
    eq("CS-7b", "credit plan and delivery retain the identical quote UUID",
       one(`select (p.quote_version_id=c.quote_version_id
                     and d.quote_version_id=c.quote_version_id
                     and p.promotional_credit_id=d.promotional_credit_id
                     and p.payment_obligation_id is null
                     and d.payment_obligation_id is null)::text
              from public.couranr_deliveries d
              join public.couranr_service_plans p on p.id=d.service_plan_id
              join public.couranr_promotional_credits c on c.id=d.promotional_credit_id
             where d.request_id='${s1.request.requestId}'`), "true");
    eq("CS-7c", "current integrity probe reports no invented obligation mismatch",
       one(`select count(*) from public.couranr_foundation_integrity()
             where issue_code in ('plan_obligation_quote_mismatch','delivery_plan_quote_mismatch')
               and entity_id in (
                 select id from public.couranr_service_plans where request_id='${s1.request.requestId}'
                 union all
                 select id from public.couranr_deliveries where request_id='${s1.request.requestId}'
               )`), "0");
    eq("CS-7c2", "the complete read-only integrity probe stays clean for a credit delivery",
       one(`select count(*) from public.couranr_foundation_integrity()`), "0");
    eq("CS-7g", "positive control: a corrupted credit/quote amount is detected for plan and delivery",
       one(`begin;
         set local session_replication_role = replica;
         update public.couranr_promotional_credits
            set standard_quote_cents=standard_quote_cents+1,
                promotional_credit_cents=promotional_credit_cents+1
          where id='${s1.creditId}';
         select count(*) from public.couranr_foundation_integrity()
          where issue_code in ('plan_obligation_quote_mismatch','delivery_plan_quote_mismatch')
            and entity_id in (
              select id from public.couranr_service_plans where request_id='${s1.request.requestId}'
              union all
              select id from public.couranr_deliveries where request_id='${s1.request.requestId}'
            );
         rollback;`), "2");
    let rollbackOutcome = "ACCEPTED";
    try { psql(integrityRollback); }
    catch (error) { rollbackOutcome = String(error.stderr || error.message); }
    eq("CS-7e", "rollback refuses to restore the obsolete probe after credit settlement",
       rollbackOutcome.includes("credit settlement history exists"), true);
    const m5Source = readFileSync(
      path.join(ROOT, "supabase/migrations/20260901051617_fnd_a_m5_invariant_cutover.sql"), "utf8"
    );
    const m5Probe = m5Source.match(/create function public\.couranr_foundation_integrity\(\)[\s\S]*?\$fn\$;/)?.[0]
      .replace("create function", "create or replace function");
    if (!m5Probe) throw new Error("original M5 integrity probe not found");
    eq("CS-7d", "positive control: original M5 probe incorrectly flags both credit records",
       one(`begin; ${m5Probe}
         select count(*) from public.couranr_foundation_integrity()
          where issue_code in ('plan_obligation_quote_mismatch','delivery_plan_quote_mismatch')
            and entity_id in (
              select id from public.couranr_service_plans where request_id='${s1.request.requestId}'
              union all
              select id from public.couranr_deliveries where request_id='${s1.request.requestId}'
            ); rollback;`), "2");

    /* ── CS-2: the paid path is unchanged ── */
    const paidReq = await seedCanonicalQuotedRequest(t, {
      businessId: bizId, actorUserId: merchant, marker: `cs2-${uniq()}`, upTo: "confirmed", payerType: "merchant",
    });
    const paidOb = await seedCanonicalPaymentObligation(t, paidReq, { paymentState: "authorized" });
    const v2 = reqVersion(paidReq.requestId);
    const raised2 = raises(`select ${confirmCall(paidReq.requestId, v2, ops)}`);
    eq("CS-2a", "paid confirm (no credit, one authorized obligation) does NOT raise", raised2.split("|")[0], "NO_ERROR");
    eq("CS-2b", "the paid plan carries payment_obligation_id = the obligation, credit NULL",
       one(`select payment_obligation_id || '|' || coalesce(promotional_credit_id::text,'NULL')
             from public.couranr_service_plans
             where request_id='${paidReq.requestId}' and plan_state='confirmed'`),
       `${paidOb.obligationId}|NULL`);

    /* ── CS-4: EXECUTE grants (before we degrade the function for CS-3) ── */
    eq("CS-4a", "anon/authenticated hold no EXECUTE on couranr_confirm_service_plan",
       one(`select has_function_privilege('anon',
              'public.couranr_confirm_service_plan(uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb)','EXECUTE')::text
            || ',' || has_function_privilege('authenticated',
              'public.couranr_confirm_service_plan(uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb)','EXECUTE')::text`),
       "false,false");
    eq("CS-4b", "anon/authenticated hold no EXECUTE on couranr_apply_readiness",
       one(`select has_function_privilege('anon',
              'public.couranr_apply_readiness(uuid,uuid,integer,uuid,text,text,text[])','EXECUTE')::text
            || ',' || has_function_privilege('authenticated',
              'public.couranr_apply_readiness(uuid,uuid,integer,uuid,text,text,text[])','EXECUTE')::text`),
       "false,false");

    /* ── CS-3: POSITIVE CONTROL — the pre-fix body raises on the SAME fixture ── */
    const rollback = readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260905080000_couranr_confirm_service_plan_credit_settlement_fix.rollback.sql"),
      "utf8"
    );
    psql(rollback); // re-install the KNOWN-BROKEN `else v_ob.id` body
    const s3 = await seedCreditScenario(`cs3-${uniq()}`);
    const v3 = reqVersion(s3.request.requestId);
    const raised3 = raises(`select ${confirmCall(s3.request.requestId, v3, ops)}`);
    const code3 = raised3.split("|")[0];
    const msg3 = raised3.split("|").slice(1).join("|");
    (code3 === "CR409" || code3 === "23514")
      ? ok("CS-3", `pre-fix body REJECTS the credit confirm (proves the fixture exercises the XOR)`, `${code3} ${msg3}`)
      : bad("CS-3", "pre-fix body should raise CR409/23514 on the credit fixture", raised3);

    /* ── CS-6: readiness positive control — restore the known-broken rule ── */
    const readinessRollback = readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260918233000_couranr_promotional_credit_readiness_parity.rollback.sql"),
      "utf8"
    );
    psql(readinessRollback);
    const s6 = await seedCreditScenario(`cs6-${uniq()}`);
    const readyV6 = reqVersion(s6.request.requestId);
    const raised6 = raises(
      `select public.couranr_mark_delivery_ready(
         '${s6.request.requestId}', '${bizId}', ${readyV6}, '${merchant}')`
    );
    const code6 = raised6.split("|")[0];
    const msg6 = raised6.split("|").slice(1).join("|");
    code6 === "CR409" && /payment_not_authorized/.test(msg6)
      ? ok("CS-6", "pre-fix readiness body rejects the same credited request", `${code6} ${msg6}`)
      : bad("CS-6", "pre-fix readiness body should fail on payment_not_authorized", raised6);

    console.log(`\n  credit settlement: ${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    // up() does not register a normal-process-exit teardown. Leaving this
    // disposable cluster on the shared port turns every later DB gate red.
    down({ quiet: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
