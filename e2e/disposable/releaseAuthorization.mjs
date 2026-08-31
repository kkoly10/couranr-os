/**
 * EXECUTION VERIFICATION for 20260806195405_couranr_release_authorization.
 *
 * The migration applying cleanly proves it parses. A test that reads its SQL
 * text proves the file says what someone expected. NEITHER proves the command
 * runs. In this repo a foreign key pointing at the wrong table survived 1230
 * passing tests and a full migration round trip, because every check of that
 * slice was static and a constraint only fires on INSERT.
 *
 * So: build a fixture that satisfies the constraints, CALL both commands, and
 * read what came back. Every path, once.
 *
 *   R1   a non-Operations actor is refused                        CR403
 *   R2   ... and the row is untouched
 *   R3   an empty reason is refused                               CR400
 *   R4   a wrong expected_version is refused                      CR409
 *   R5   begin succeeds for Operations on an authorized hold
 *   R6   ... and payment_state is STILL authorized (the whole design)
 *   R7   ... and an append-only begun event was written
 *   R8   complete refuses a status that is not a cancellation     CR422
 *   R9   complete refuses a mismatched intent id                  rejected
 *   R10  ... and the row is untouched by that rejection
 *   R11  ... and the rejection burned NO provider_event_id
 *   R12  complete moves authorized -> cancelled
 *   R13  ... and stamps cancelled_at (the IFF constraint)
 *   R14  ... and bumped version
 *   R15  a replayed complete is `ignored`, not an error
 *   R16  a replayed begin on a released hold is `ignored`
 *   R17  capture_pending may NOT be released                      CR409
 *   R18  captured may NOT be released                             CR409
 *   R19  the SCHEMA forbids an authorized hold with no intent (23514),
 *        which makes the command's own CR422 intent guard unreachable
 *   R20  anon/authenticated hold no EXECUTE on either command
 *   R21  begin bumps the version, giving each ATTEMPT an identity
 *   R22  a SECOND begin succeeds — the retry after a failed Stripe call
 *   R23  ... and writes a DISTINCT event rather than colliding (23505)
 *   R24  the seeded fixtures leave couranr_foundation_integrity() clean
 */
import crypto from "node:crypto";
import { up, down, psql } from "./up.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalDeliveryChain,
  syntheticIntentId,
} from "./gateAFixtures.mjs";

const KEEP = process.argv.includes("--keep");
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

/**
 * Run SQL expecting it to RAISE, and return `SQLSTATE|message`.
 *
 * psql does not print SQLSTATE at the default VERBOSITY, so scraping stderr
 * for a CR code silently yields the message text instead — which compares
 * unequal to the code and reports a passing guard as a failure. The first
 * version of this harness did exactly that and called seven working refusals
 * broken.
 *
 * Catching inside plpgsql and returning the code as a ROW is exact rather than
 * scraped. It must be one psql call: each invocation is its own connection, so
 * a temp table does not survive between them.
 *
 * Asserting the code AND the message together is stronger than either alone —
 * the code is the contract the API layer maps to HTTP, the message pins WHICH
 * guard fired, and a refactor that swaps two guards keeps the code while
 * changing the message.
 */
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  // `perform (…)` takes an expression, so it works for a SELECT and is a syntax
  // error for an INSERT. Anything that is not a SELECT is executed directly.
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  const out = psql(
    `create temp table _probe(code text, msg text);
     do $probe$ begin
       ${stmt}
       insert into _probe values ('NO_ERROR', '');
     exception when others then
       insert into _probe values (SQLSTATE, SQLERRM);
     end $probe$;
     select code || '|' || msg from _probe;`,
  );
  return out.trim();
}

function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`,
  );
  return id;
}

/**
 * A request and an obligation in `state`, with the whole Gate A lineage behind
 * them.
 *
 * The previous version inserted both rows by hand: a request claiming
 * quote_status='estimated' with no current_quote_version_id, and an obligation
 * with an amount and no quote_version_id. Gate A made both illegal — the first
 * violates couranr_dr_quote_identity_completeness_chk, the second raises CR409
 * payment_obligation_quote_mismatch before the row is even written — so the
 * suite died in setup with none of its 23 assertions reached.
 *
 * The states are produced the way the product produces them, which is also why
 * they are integrity-clean: `capture_pending` comes from
 * couranr_begin_payment_capture, and `captured` is followed by the converted
 * delivery, so couranr_foundation_integrity() has nothing to report. Seeding a
 * captured obligation with no delivery would leave `captured_without_delivery`
 * behind — measured, not assumed.
 */
const CHAIN_STOP_FOR_STATE = {
  authorized: "obligation",
  capture_pending: "capture_pending",
  captured: "delivery",
};

async function seedObligation(businessId, creatorId, state, { withIntent = true } = {}) {
  const stopAfter = CHAIN_STOP_FOR_STATE[state];
  if (!stopAfter) throw new Error(`seedObligation: unsupported state ${state}`);
  const intent = withIntent ? syntheticIntentId() : null;
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId,
    actorUserId: creatorId,
    marker: `rel-${crypto.randomUUID().slice(0, 8)}`,
    recipientName: "Release Fixture",
    stopAfter,
    intentId: intent,
    withIntent,
  });
  return { requestId: chain.requestId, obligationId: chain.obligationId, intent, quoteVersionId: chain.quoteVersionId };
}

async function main() {
  up();
  try {
    console.log("\n  release-authorization execution verification\n");

    const businessId = one(
      `insert into public.business_accounts (name, slug, status)
       values ('Release Co', 'release-co-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`,
    );
    const ops = seedActor(`ops+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
    const merchant = seedActor(`mer+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "merchant");

    // ---- gating and guards on begin ------------------------------------
    const a = await seedObligation(businessId, merchant, "authorized");
    const beginSql = (actor, ver, reason) =>
      `select (public.couranr_begin_payment_release('${a.obligationId}', '${actor}', ${ver}, '${esc(reason)}')).outcome`;

    eq("R1", "a non-Operations actor is refused",
       raises(beginSql(merchant, 1, "cust cancelled")), "CR403|operations_access_required");
    eq(
      "R2", "... and the row is untouched",
      one(`select payment_state from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "authorized",
    );
    eq("R3", "an empty reason is refused",
       raises(beginSql(ops, 1, "   ")), "CR400|release_requires_a_reason");
    eq("R4", "a wrong expected_version is refused",
       raises(beginSql(ops, 99, "cust cancelled")), "CR409|version_or_state_conflict");

    eq("R5", "begin succeeds for Operations", one(beginSql(ops, 1, "customer cancelled")), "applied");
    eq(
      "R6", "... payment_state is STILL authorized (the design)",
      one(`select payment_state from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "authorized",
    );
    eq(
      "R7", "... a begun event was appended",
      one(`select count(*) from public.couranr_payment_events
            where obligation_id='${a.obligationId}' and event_type='couranr.release.begun'`),
      "1",
    );

    /*
     * R21-R23 — THE RETRY AFTER A FAILED STRIPE CALL.
     *
     * These exist because the first version of this migration made a hold
     * PERMANENTLY un-releasable. `begin` did not bump the version, its event id
     * was version-scoped, and so a second attempt rebuilt the same id and died
     * on couranr_pe_provider_event_uniq with 23505 — forever. One failed Stripe
     * call and the operator had a button that could never work again.
     *
     * Nothing in the original 20 checks touched this, because they only ever
     * called `begin` once per obligation. Four independent adversarial-review
     * lenses found it; no test did. That is the gap these close.
     */
    eq(
      "R21", "begin bumped the version, giving the attempt an identity",
      one(`select version from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "2",
    );
    eq(
      "R22", "a SECOND begin succeeds — the retry after a failed Stripe call",
      one(beginSql(ops, 2, "stripe timed out, trying again")), "applied",
    );
    eq(
      "R23", "... and it wrote a DISTINCT begun event, not a duplicate",
      one(`select count(distinct provider_event_id) from public.couranr_payment_events
            where obligation_id='${a.obligationId}' and event_type='couranr.release.begun'`),
      "2",
    );

    // ---- complete --------------------------------------------------------
    const doneSql = (intent, status) =>
      `select (public.couranr_complete_payment_release('${a.obligationId}', '${intent}', '${status}')).outcome`;

    eq("R8", "a non-cancellation status is refused",
       raises(doneSql(a.intent, "succeeded")), "CR422|status_not_a_cancellation");
    eq("R9", "a mismatched intent id is rejected", one(doneSql("pi_not_the_one", "canceled")), "rejected");
    eq(
      "R10", "... and the row is untouched",
      one(`select payment_state from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "authorized",
    );
    eq(
      "R11", "... and the rejection burned NO provider_event_id",
      one(`select count(*) from public.couranr_payment_events
            where obligation_id='${a.obligationId}' and event_type='couranr.release.completed'`),
      "0",
    );

    eq("R12", "complete moves authorized -> cancelled", one(doneSql(a.intent, "canceled")), "applied");
    eq(
      "R13", "... and stamped cancelled_at (the IFF constraint)",
      one(`select (payment_state='cancelled' and cancelled_at is not null)
             from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "t",
    );
    eq(
      "R14", "... and bumped version",
      one(`select version > 1 from public.couranr_payment_obligations where id='${a.obligationId}'`),
      "t",
    );
    eq("R15", "a replayed complete is ignored, not an error", one(doneSql(a.intent, "canceled")), "ignored");
    eq("R16", "a replayed begin on a released hold is ignored",
       one(beginSql(ops, 99, "again")), "ignored");  // state is checked before version

    // ---- states that may NOT be released ---------------------------------
    for (const [id, state] of [["R17", "capture_pending"], ["R18", "captured"]]) {
      const o = await seedObligation(businessId, merchant, state);
      eq(
        id, `${state} may NOT be released`,
        raises(`select public.couranr_begin_payment_release('${o.obligationId}', '${ops}', 1, 'try')`),
        "CR409|only_an_authorized_hold_may_be_released",
      );
    }

    /*
     * R19 changed after running it. The plan was "an authorized obligation
     * with no intent is refused CR422" — but couranr_po_authorized_needs_intent_chk
     * is `payment_state <> 'authorized' OR provider_payment_intent_id IS NOT NULL`,
     * so the DATABASE forbids that row existing at all. The CR422 branch in
     * couranr_begin_payment_release is therefore unreachable defence in depth,
     * not a live path, and claiming a test covers it would be a lie.
     *
     * What is worth asserting is the constraint that makes it unreachable.
     */
    eq(
      "R19", "the schema forbids an authorized hold with no intent (guard is unreachable)",
      raises(
        // Gate A note: quote_version_id is supplied and CORRECT here on
        // purpose. couranr_po_quote_invariant_trg is a BEFORE INSERT trigger,
        // so an obligation with no quote raises CR409 before any CHECK is
        // evaluated — which would make this assertion pass for the wrong
        // reason and stop proving anything about the intent constraint.
        `insert into public.couranr_payment_obligations
           (request_id, business_account_id, payer_type, request_version,
            quote_version_id, pricing_policy_version, amount_cents, currency,
            payment_state, provider_payment_intent_id, idempotency_key, authorized_at)
         values ('${a.requestId}', '${businessId}', 'merchant', 1,
                 '${a.quoteVersionId}', 'disposable',
                 2299, 'usd', 'authorized', null, 'noint-${crypto.randomUUID()}', now())
         returning id`,
      ).split("|")[0],
      "23514",
    );

    // ---- grants ----------------------------------------------------------
    eq(
      "R20", "no browser role holds EXECUTE on either command",
      one(`select bool_or(has_function_privilege(r, f, 'EXECUTE'))
             from unnest(array['anon','authenticated']) r,
                  unnest(array[
                    'public.couranr_begin_payment_release(uuid,uuid,integer,text)',
                    'public.couranr_complete_payment_release(uuid,text,text)']) f`),
      "f",
    );

    /*
     * R24 — the FIXTURES themselves are Gate A legal.
     *
     * Every assertion above would still pass on a fixture that satisfied each
     * trigger in isolation while leaving the commercial graph inconsistent.
     * couranr_foundation_integrity() is the permanent probe for that, and it is
     * asserted rather than assumed: seeding a `captured` obligation without its
     * converted delivery leaves `captured_without_delivery` behind, which is
     * how the shape of the captured fixture above was chosen.
     */
    eq(
      "R24", "couranr_foundation_integrity() reports NO issue for any seeded fixture",
      (await gateAIntegrityIssues(psqlTransport(psql))).join(",") || "(none)", "(none)",
    );

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
  } finally {
    if (!KEEP) down();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n  RUN FAILED: ${(e.stack || e.message || e).toString().slice(0, 800)}`);
  down();
  process.exit(1);
});
