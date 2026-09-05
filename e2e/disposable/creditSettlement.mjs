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
 *   CS-4  anon/authenticated hold no EXECUTE on the function
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { up, psql } from "./up.mjs";
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

    /* ── CS-1: the fix — credit path with a coexisting obligation succeeds ── */
    const s1 = await seedCreditScenario(`cs1-${uniq()}`);
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
    eq("CS-4", "anon/authenticated hold no EXECUTE on couranr_confirm_service_plan",
       one(`select has_function_privilege('anon',
              'public.couranr_confirm_service_plan(uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb)','EXECUTE')::text
            || ',' || has_function_privilege('authenticated',
              'public.couranr_confirm_service_plan(uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb)','EXECUTE')::text`),
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

    console.log(`\n  credit settlement: ${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    // up() owns teardown via its own process-exit handler in the suite runner;
    // nothing seeded here touches a real project.
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
