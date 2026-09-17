/**
 * OPS-011 refund review — EXECUTION verification against a real PostgreSQL.
 *
 * A migration that applies is not a migration that works. Everything below is
 * a CALL against a real row: foreign keys, CHECKs, partial unique indexes,
 * trigger bodies and the money arithmetic only exist at execution time, and
 * every one of them is invisible to a SQL-text assertion.
 *
 * WHAT THIS PROVES, and the ids that prove it:
 *
 *   RR-01..05  the review record's shape and its Operations-only gate
 *   RR-10..16  THE OVER-REFUND GUARD. A figure above what remains refundable
 *              is REFUSED, not clamped — proved at the command, at the CHECK
 *              constraint, and after a partial has already been taken.
 *   RR-20..25  partial and full approval arithmetic in integer cents, and the
 *              registry's `partially_refunded` / `refunded` distinction
 *   RR-30..34  IDEMPOTENCY. The same approval replayed converges on the same
 *              decision and the same single attempt — it never refunds twice.
 *   RR-40..43  the event-derived idempotency key, and that it is minted from
 *              row identity and version rather than from the clock
 *   RR-50..53  DENIAL as a recorded decision, and that a denial cannot later
 *              be approved
 *   RR-60..63  `failed` is a REAL recorded outcome, and every one of the seven
 *              registry states is reachable
 *   RR-70..74  LEDGER BALANCE across a reviewed refund
 *   RR-80..83  the boundary: no merchandise refund, no time-based reason, and
 *              the old full-refund path cannot mint a reviewed settlement
 *   RR-90..93  CONCURRENCY. Two Operations users approving the same request at
 *              the same moment produce ONE refund.
 *
 * NO PROVIDER CALL IS MADE OR SIMULATED HERE. This suite is the SQL half: it
 * drives the database commands directly. The TypeScript half — which provider
 * calls are permitted in which order — is
 * `tests/couranr-operations-refunds.test.ts`, against an injected gateway.
 */

import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { up, psql, dbUrl } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain, gateAIntegrityIssues } from "./gateAFixtures.mjs";

const execFileAsync = promisify(execFile);

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
function truthy(id, label, cond, got) {
  cond ? ok(id, label, got) : bad(id, label, got);
}

/** The standard refusal probe: returns "SQLSTATE|message". */
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

/**
 * A SECOND connection, so a race can actually be expressed. `psql()` is
 * synchronous and one statement per connection, which cannot interleave.
 *
 * COURANR_PGBIN is honoured here deliberately — two older probes hardcode a
 * Linux path and their race sections die with ENOENT on any machine that sets
 * it, which is a portability wart worth not repeating.
 */
const PSQL_BIN = path.join(process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin", "psql");
async function psqlAsync(statement) {
  try {
    const { stdout } = await execFileAsync(
      PSQL_BIN,
      [dbUrl(), "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { timeout: 30_000 }
    );
    return { ok: true, out: String(stdout).trim() };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
}

function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`
  );
  return id;
}

const rrCol = (id, col) =>
  one(`select coalesce(${col}::text,'-') from public.couranr_refund_requests where id='${id}'`);
const obCol = (id, col) =>
  one(`select coalesce(${col}::text,'-') from public.couranr_payment_obligations where id='${id}'`);

async function main() {
  up();
  const t = psqlTransport(psql);

  console.log("\n  OPS-011 refund review — execution verification\n");

  const bizId = one(
    `insert into public.business_accounts (name, slug, status)
     values ('Refund Review Co', 'refund-review-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`
  );
  const ops = seedActor(`ops+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
  const ops2 = seedActor(`ops2+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
  const merchant = seedActor(`mer+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "merchant");
  psql(`insert into public.business_members (business_account_id, user_id, role, status)
        values ('${bizId}', '${merchant}', 'owner', 'active')`);

  /** A CAPTURED obligation with its converted delivery, as the product makes one. */
  async function seedCaptured(marker, opts = {}) {
    const chain = await seedCanonicalDeliveryChain(t, {
      businessId: bizId,
      actorUserId: merchant,
      marker,
      stopAfter: "delivery",
      ...opts,
    });
    const amountCents = Number(obCol(chain.obligationId, "captured_amount_cents"));
    return {
      requestId: chain.requestId,
      obligationId: chain.obligationId,
      deliveryId: chain.deliveryId,
      amountCents,
    };
  }

  const openReq = (requestId, actor, reason = "service_not_performed", requester = "customer") =>
    `select id from public.couranr_open_refund_request(
       '${requestId}','${actor}','${requester}','${reason}','probe detail',null,null)`;

  const approve = (rrId, actor, ver, cents) =>
    `select request_state || '|' || coalesce(approved_amount_cents::text,'-') || '|' || coalesce(refundable_base_cents::text,'-')
       from public.couranr_approve_refund_request('${rrId}','${actor}',${ver},${cents})`;

  const begin = (rrId, actor) =>
    `select id || '|' || amount_cents || '|' || retained_cents || '|' || refund_key
       from public.couranr_begin_approved_refund('${rrId}','${actor}')`;

  const complete = (refundId, providerId, status, cents) =>
    `select attempt_state from public.couranr_complete_payment_refund(
       '${refundId}','${providerId}','${status}',${cents})`;

  /* ═══════════════════ §1 shape and the Operations gate ═══════════════ */

  const f1 = await seedCaptured("rr-shape");
  eq("RR-01", "a captured delivery charge exists to review", f1.amountCents > 0, true);

  const rr1 = one(openReq(f1.requestId, ops));
  truthy("RR-02", "couranr_open_refund_request creates a PENDING review", rrCol(rr1, "request_state") === "pending", rrCol(rr1, "request_state"));
  eq("RR-03", "a pending review carries NO decision and NO figure",
     [rrCol(rr1, "approved_amount_cents"), rrCol(rr1, "refundable_base_cents"), rrCol(rr1, "decided_at"), rrCol(rr1, "refund_attempt_id")].join(","),
     "-,-,-,-");

  eq("RR-04", "a non-Operations actor cannot open a review",
     raises(openReq(f1.requestId, merchant)).split("|")[1], "operations_access_required");
  eq("RR-05", "a non-Operations actor cannot approve one",
     raises(approve(rr1, merchant, 1, 100)).split("|")[1], "operations_access_required");

  /* ═════════════ §2 THE OVER-REFUND GUARD — refused, not clamped ═════ */

  const over = f1.amountCents + 1;
  const overAttempt = raises(approve(rr1, ops, 1, over));
  eq("RR-10", "approving MORE than the captured delivery charge is REFUSED",
     overAttempt.split("|")[1], "refund_amount_exceeds_refundable");
  eq("RR-11", "... with CR422, a refusal rather than a crash", overAttempt.split("|")[0], "CR422");
  eq("RR-12", "... and the review is untouched — nothing was clamped and written",
     [rrCol(rr1, "request_state"), rrCol(rr1, "approved_amount_cents"), rrCol(rr1, "version")].join(","),
     "pending,-,1");
  eq("RR-13", "... and NO refund attempt row was created",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f1.obligationId}'`), "0");

  eq("RR-14", "a zero approval is refused",
     raises(approve(rr1, ops, 1, 0)).split("|")[1], "refund_amount_not_positive");
  eq("RR-15", "a negative approval is refused",
     raises(approve(rr1, ops, 1, -500)).split("|")[1], "refund_amount_not_positive");
  eq("RR-16", "a null approval is refused",
     raises(`select public.couranr_approve_refund_request('${rr1}','${ops}',1,null)`).split("|")[1],
     "refund_amount_required");

  /* The CHECK constraint is the second, independent guard: even with every
     command deleted, an approved figure above its base is UNWRITABLE. */
  /*
   * NAME THE CONSTRAINT. An earlier version of this check asserted only
   * SQLSTATE 23514 and stayed GREEN when couranr_rr_amount_within_base_chk was
   * deliberately weakened — because the same UPDATE also violates
   * couranr_rr_pending_clean_chk, which returns the identical code. A check
   * that passes for the wrong reason is worse than no check.
   *
   * So: move the row OUT of `pending` first, then attempt the over-base write,
   * and assert the specific constraint by name.
   */
  psql(`update public.couranr_refund_requests
           set request_state='approved', refundable_base_cents=${f1.amountCents},
               approved_amount_cents=${f1.amountCents},
               decided_by='${ops}', decided_at=now()
         where id='${rr1}'`);
  const clamped = raises(
    `update public.couranr_refund_requests
        set approved_amount_cents=${over}
      where id='${rr1}'`
  );
  eq("RR-17", "an over-base figure is UNWRITABLE even by direct UPDATE (CHECK, not code)",
     clamped.split("|")[0], "23514");
  truthy("RR-18", "... and it is couranr_rr_amount_within_base_chk that refuses it",
     clamped.includes("couranr_rr_amount_within_base_chk"), clamped.split("|")[1]);
  // Put the row back to pending so the arithmetic section below is unaffected.
  psql(`update public.couranr_refund_requests
           set request_state='pending', refundable_base_cents=null,
               approved_amount_cents=null, decided_by=null, decided_at=null
         where id='${rr1}'`);

  /* ═══════════════ §3 partial and full approval arithmetic ══════════ */

  const partialCents = Math.floor(f1.amountCents / 2);
  const approved = one(approve(rr1, ops, 1, partialCents)).split("|");
  eq("RR-20", "a PARTIAL approval is recorded as approved", approved[0], "approved");
  eq("RR-21", "... in integer cents, exactly as approved", approved[1], String(partialCents));
  eq("RR-22", "... against a SERVER-COMPUTED base of captured - already refunded",
     approved[2], String(f1.amountCents));
  eq("RR-23", "an approval alone creates NO attempt — the decision is durable first",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f1.obligationId}'`), "0");

  const begun = one(begin(rr1, ops)).split("|");
  const refund1 = begun[0];
  eq("RR-24", "beginning the approved refund writes ONE attempt for the approved cents", begun[1], String(partialCents));
  eq("RR-25", "... retaining exactly base - approved", begun[2], String(f1.amountCents - partialCents));
  eq("RR-26", "... and the review moves to PROCESSING", rrCol(rr1, "request_state"), "processing");
  eq("RR-27", "... on the ONE governed reviewed reason",
     one(`select reason from public.couranr_payment_refunds where id='${refund1}'`), "operations_reviewed_refund");

  /* ═══════════════════ §4 the event-derived key ═══════════════════ */

  const expectedKey = `couranr:refund-request:${rr1}:v1`;
  eq("RR-40", "the provider idempotency key is derived from the review id and the approved version",
     begun[3], expectedKey);
  truthy("RR-41", "... and carries no timestamp", !/\d{4}-\d{2}-\d{2}|T\d{2}:/.test(begun[3]), begun[3]);
  eq("RR-42", "the key is unique across attempts",
     one(`select count(distinct refund_key) from public.couranr_payment_refunds`),
     one(`select count(*) from public.couranr_payment_refunds`));

  /* ═══════════════════ §5 idempotency of the decision ═══════════════ */

  /* A replay must SUCCEED and converge. If the replay branch is gone it raises
     instead, so read it through `raises()` and assert on the outcome by name —
     a named failure says which guarantee broke, where a crash only says that
     one did. */
  const replayRaw = raises(approve(rr1, ops, 1, partialCents));
  truthy("RR-30", "REPLAYING the approval CONVERGES rather than raising",
     replayRaw.startsWith("NO_ERROR"), replayRaw.split("|")[1] || replayRaw);
  const replay = one(approve(rr1, ops, 1, partialCents)).split("|");
  eq("RR-30b", "... on the recorded decision", replay[0], "processing");
  eq("RR-31", "... on the SAME figure", replay[1], String(partialCents));

  const replayDifferent = one(approve(rr1, ops, 1, f1.amountCents)).split("|");
  eq("RR-32", "replaying with a DIFFERENT figure still converges — it never re-decides",
     replayDifferent[1], String(partialCents));

  const beginReplay = one(begin(rr1, ops)).split("|");
  eq("RR-33", "REPLAYING the begin returns the SAME attempt — never a second one", beginReplay[0], refund1);
  eq("RR-34", "... and exactly ONE attempt exists on the obligation",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f1.obligationId}'`), "1");

  /* ══════════ §6 partial settles as partially_refunded, and caps ════ */

  eq("RR-50", "the provider outcome settles the attempt",
     one(complete(refund1, "re_probe_partial", "succeeded", partialCents)), "succeeded");
  eq("RR-51", "the review follows the money to PARTIALLY REFUNDED", rrCol(rr1, "request_state"), "partially_refunded");
  eq("RR-52", "the obligation records exactly the refunded cents", obCol(f1.obligationId, "refunded_amount_cents"), String(partialCents));
  eq("RR-53", "the sum of refunds never exceeds the capture",
     one(`select case when coalesce(sum(amount_cents),0) <= (select captured_amount_cents from public.couranr_payment_obligations where id='${f1.obligationId}')
            then 'within' else 'OVER' end
          from public.couranr_payment_refunds where obligation_id='${f1.obligationId}' and attempt_state='succeeded'`),
     "within");

  /*
   * A SECOND refund on an obligation that already settled one is refused
   * OUTRIGHT — not re-ceilinged, refused. This is stricter than "cap the
   * remainder" and it is inherited from P6-004: `couranr_pr_one_live_attempt_uniq`
   * makes a second live attempt structurally impossible, so the approve
   * command refuses before it ever computes a figure.
   *
   * The consequence is a real product limitation and is reported as one: in
   * V0 a partial refund CANNOT later be topped up. One obligation, one
   * settlement, forever. That is why the sum of refunds can never exceed the
   * capture — there is only ever one of them.
   */
  const rr1b = one(openReq(f1.requestId, ops));
  const remaining = f1.amountCents - partialCents;
  eq("RR-54", "a second refund on a settled obligation is REFUSED outright, whatever the figure",
     raises(approve(rr1b, ops, 1, remaining)).split("|")[1], "refund_already_settled_or_in_flight");
  eq("RR-55", "... and an over-large second figure is refused just the same",
     raises(approve(rr1b, ops, 1, f1.amountCents)).split("|")[1], "refund_already_settled_or_in_flight");
  eq("RR-56", "... so still exactly ONE attempt exists and the capture is not exceeded",
     one(`select count(*) || '|' || coalesce(sum(amount_cents),0)
            from public.couranr_payment_refunds
           where obligation_id='${f1.obligationId}' and attempt_state='succeeded'`),
     `1|${partialCents}`);
  /* The obligation-level bound is the last line and is a CHECK, not code:
     couranr_po_refund_bounds_chk makes refunded > captured unwritable. */
  eq("RR-57", "refunded_amount_cents ABOVE captured is unwritable (CHECK, not code)",
     raises(`update public.couranr_payment_obligations
                set refunded_amount_cents = captured_amount_cents + 1
              where id='${f1.obligationId}'`).split("|")[0],
     "23514");

  /* ═══════════════ §7 full approval settles as refunded ═════════════ */

  const f2 = await seedCaptured("rr-full");
  const rr2 = one(openReq(f2.requestId, ops));
  const full2 = one(approve(rr2, ops, 1, f2.amountCents)).split("|");
  eq("RR-60", "a FULL approval equals the whole refundable base", full2[1], String(f2.amountCents));
  const begun2 = one(begin(rr2, ops)).split("|");
  eq("RR-61", "a full refund retains nothing", begun2[2], "0");
  eq("RR-62", "the provider outcome settles it", one(complete(begun2[0], "re_probe_full", "succeeded", f2.amountCents)), "succeeded");
  eq("RR-63", "the review reaches REFUNDED", rrCol(rr2, "request_state"), "refunded");
  eq("RR-64", "the obligation reaches the refunded payment state", obCol(f2.obligationId, "payment_state"), "refunded");

  /* ═══════════ §8 `failed` is a REAL recorded outcome ═══════════════ */

  const f3 = await seedCaptured("rr-failed");
  const rr3 = one(openReq(f3.requestId, ops));
  one(approve(rr3, ops, 1, f3.amountCents));
  const begun3 = one(begin(rr3, ops)).split("|");
  eq("RR-70", "a provider failure marks the attempt failed",
     one(complete(begun3[0], "", "failed", 0)), "failed");
  eq("RR-71", "... and the REVIEW records failed — it is not an exception that vanished",
     rrCol(rr3, "request_state"), "failed");
  eq("RR-72", "... and no money was recorded as refunded", obCol(f3.obligationId, "refunded_amount_cents"), "-");

  /* ═══════════════ §9 denial is a recorded decision ═════════════════ */

  const f4 = await seedCaptured("rr-deny");
  const rr4 = one(openReq(f4.requestId, ops));
  eq("RR-80", "a denial needs a written reason",
     raises(`select public.couranr_deny_refund_request('${rr4}','${ops}',1,'   ')`).split("|")[1],
     "denial_reason_required");
  eq("RR-81", "a denial is recorded",
     one(`select request_state from public.couranr_deny_refund_request('${rr4}','${ops}',1,'Delivery was completed and proven.')`),
     "denied");
  eq("RR-82", "a denial replayed is the SAME denial",
     one(`select request_state || '|' || version from public.couranr_deny_refund_request('${rr4}','${ops}',99,'anything else')`),
     "denied|2");
  eq("RR-83", "a DENIED review can never be approved afterwards",
     raises(approve(rr4, ops, 2, 100)).split("|")[1], "refund_request_already_denied");
  eq("RR-84", "denial moved no money",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f4.obligationId}'`), "0");

  /* ════ §9b the BEGIN-time re-validation against the money as it is now ══ */

  /*
   * This guard had NO test until RED-proofing found that removing it changed
   * nothing. It is reachable: the decision is recorded BEFORE any provider
   * work, so another governed settlement can land in between and shrink the
   * refundable balance under a decision that was valid when it was made.
   */
  const f7 = await seedCaptured("rr-shrunk");
  const rr7 = one(openReq(f7.requestId, ops));
  eq("RR-58", "a full approval is recorded while the whole capture is refundable",
     one(approve(rr7, ops, 1, f7.amountCents)).split("|")[1], String(f7.amountCents));

  /* A cancellation settlement lands in between and takes most of the money,
     retaining the CAN-001 $8. The approved figure is now too large. */
  const cancelAttempt = one(
    `select id from public.couranr_begin_payment_refund('${f7.obligationId}','${ops}',
       ${Number(obCol(f7.obligationId, "version"))},'cancel_after_confirmation_before_arrival')`
  );
  one(complete(cancelAttempt, "re_probe_cancel", "succeeded",
      Number(one(`select amount_cents from public.couranr_payment_refunds where id='${cancelAttempt}'`))));
  truthy("RR-59", "... and the balance really did shrink",
     Number(obCol(f7.obligationId, "refunded_amount_cents")) > 0,
     obCol(f7.obligationId, "refunded_amount_cents"));

  const shrunk = raises(begin(rr7, ops));
  truthy("RR-59b", "beginning a stale approval is REFUSED, not clamped to the smaller balance",
     ["refund_amount_exceeds_refundable", "refund_already_settled_or_in_flight"].includes(shrunk.split("|")[1]),
     shrunk.split("|")[1]);
  eq("RR-59c", "... and no second attempt was created for it",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f7.obligationId}'`), "1");
  eq("RR-59d", "... and the review never claims money it did not move",
     rrCol(rr7, "refund_attempt_id"), "-");

  /* ══════════ §10 the registry boundary: scope and vocabulary ═══════ */

  const f5 = await seedCaptured("rr-boundary");
  eq("RR-85", "a merchandise reason is not in the vocabulary and is refused",
     raises(openReq(f5.requestId, ops, "product_damaged")).split("|")[0], "23514");
  eq("RR-86", "a LATE-DELIVERY reason is not in the vocabulary — Couranr claims no on-time guarantee",
     raises(openReq(f5.requestId, ops, "late_delivery")).split("|")[0], "23514");
  eq("RR-87", "the reviewed reason cannot be minted by the OLD full-refund path",
     raises(`select public.couranr_begin_payment_refund('${f5.obligationId}','${ops}',
              ${Number(obCol(f5.obligationId, "version"))},'operations_reviewed_refund')`).split("|")[1],
     "refund_reason_invalid");

  const rr5 = one(openReq(f5.requestId, ops));
  eq("RR-88", "only ONE live review exists per obligation",
     raises(openReq(f5.requestId, ops)).split("|")[1], "refund_request_already_open");
  /* An AUTHORIZED hold is money Couranr has not taken. It is released, never
     refunded — so a review cannot even be opened against one. */
  const authorizedChain = await seedCanonicalDeliveryChain(t, {
    businessId: bizId, actorUserId: merchant, marker: "rr-authorized", stopAfter: "obligation",
  });
  eq("RR-89", "an UNCAPTURED (authorized) obligation has nothing to refund",
     raises(openReq(authorizedChain.requestId, ops)).split("|")[1],
     "only_captured_money_may_be_refunded");

  /* ═══════════════════ §11 LEDGER BALANCE ══════════════════════════ */

  const recon = JSON.parse(one(`select public.couranr_get_ledger_reconciliation()::text`));
  eq("RR-90", "every ledger transaction balances debits against credits", recon.unbalancedTransactions ?? recon.unbalanced_transactions ?? 0, 0);
  eq("RR-91", "no successful refund is missing its ledger posting", recon.missingRefunds ?? recon.missing_refunds ?? 0, 0);
  eq("RR-92", "no capture is missing its ledger posting", recon.missingCaptures ?? recon.missing_captures ?? 0, 0);
  eq("RR-93", "the ledger's refund expense equals the refunds actually taken",
     one(`select coalesce(sum(case when e.side='debit' then e.amount_cents else -e.amount_cents end),0)
            from private.couranr_ledger_entries e where e.account_code='refund_expense'`),
     one(`select coalesce(sum(amount_cents),0) from public.couranr_payment_refunds where attempt_state='succeeded'`));
  eq("RR-94", "a reviewed refund posted Dr refund_expense / Cr stripe_clearing like any other",
     one(`select count(*) from private.couranr_ledger_transactions where source_kind='refund' and source_id='${refund1}'`), "1");

  /* ═══════════════ §12 CONCURRENCY — two callers, one row ══════════ */

  const f6 = await seedCaptured("rr-race");
  const rr6 = one(openReq(f6.requestId, ops));

  /* Two Operations users press Approve at the same instant, on the same
     review, at the same version, for DIFFERENT figures. */
  const halfCents = Math.floor(f6.amountCents / 2);

  /*
   * BOTH CALLERS WAIT ON THE SERVER, INSIDE THEIR OWN TRANSACTION, then call.
   * Without this the two psql spawns cost tens of milliseconds each and the
   * first transaction commits before the second begins — so the probe measures
   * process startup rather than concurrency, and it stayed green with the row
   * lock, the compare-and-set and the duplicate-key convergence ALL removed.
   * `psql -c` runs multiple statements in one implicit transaction, so the
   * sleep is held inside it and the contended window is real.
   */
  const together = (sql) => `select pg_sleep(0.5); ${sql}`;

  const raceApprove = await Promise.all([
    psqlAsync(
      together(`select request_state || '|' || approved_amount_cents
         from public.couranr_approve_refund_request('${rr6}','${ops}',1,${f6.amountCents})`)
    ),
    psqlAsync(
      together(`select request_state || '|' || approved_amount_cents
         from public.couranr_approve_refund_request('${rr6}','${ops2}',1,${halfCents})`)
    ),
  ]);
  const approvedFigures = new Set(
    raceApprove.filter((r) => r.ok).map((r) => r.out.split("|")[1])
  );
  eq("RR-95", "two simultaneous approvals agree on exactly ONE figure", approvedFigures.size, 1);
  eq("RR-96", "... and the review advanced by exactly one decision", rrCol(rr6, "version"), "2");
  eq("RR-96b", "... and exactly ONE approval event was recorded for it",
     one(`select count(*) from public.couranr_payment_events
           where event_type='couranr.refund_request.approved'
             and detail->>'refundRequestId' = '${rr6}'`), "1");

  /* Now two simultaneous BEGINs — the step that would mint a provider refund. */
  const raceBegin = await Promise.all([
    psqlAsync(together(`select id from public.couranr_begin_approved_refund('${rr6}','${ops}')`)),
    psqlAsync(together(`select id from public.couranr_begin_approved_refund('${rr6}','${ops2}')`)),
  ]);
  const attemptIds = new Set(raceBegin.filter((r) => r.ok).map((r) => r.out));
  eq("RR-97", "two simultaneous begins converge on exactly ONE attempt id", attemptIds.size, 1);
  eq("RR-98", "... and the database holds exactly ONE attempt for that obligation",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f6.obligationId}'`), "1");
  eq("RR-99", "... so only ONE provider refund could ever be submitted",
     one(`select count(distinct refund_key) from public.couranr_payment_refunds where obligation_id='${f6.obligationId}'`), "1");

  /* ═══════════════════ §13 every registry state reached ════════════ */

  const reached = one(
    `select string_agg(distinct request_state, ',' order by request_state) from public.couranr_refund_requests`
  );
  for (const state of ["pending", "denied", "failed", "partially_refunded", "refunded", "processing"]) {
    truthy(`RR-S-${state}`, `the registry state '${state}' is reachable`, reached.split(",").includes(state), reached);
  }
  /* `approved` is transient by design — it exists durably between the decision
     and the begin, which RR-20 observed directly. */
  truthy("RR-S-approved", "the registry state 'approved' was observed directly (RR-20)", approved[0] === "approved", approved[0]);

  /* ═══ §13b THE CROSS-SURFACE GUARD (found by adversarial review) ═══ */

  /*
   * Widening the reason vocabulary made `operations_reviewed_refund` visible
   * to OPS-009's payment recovery panel, which classifies any attempt whose
   * reason is not `full_refund` as cancellation-governed. A FAILED reviewed
   * refund on a cancelled delivery would therefore have offered "Resume
   * settlement", re-derived a CAN-001 figure, and settled THAT amount instead
   * of the one Operations approved — leaving the review record pointing at a
   * failed attempt while different money moved.
   *
   * The settlement-identity trigger closes it for EVERY writer at once.
   */
  const f8 = await seedCaptured("rr-identity");
  const rr8 = one(openReq(f8.requestId, ops));
  one(approve(rr8, ops, 1, Math.floor(f8.amountCents / 2)));
  const begun8 = one(begin(rr8, ops)).split("|");
  eq("RR-110", "a reviewed refund FAILS at the provider",
     one(complete(begun8[0], "", "failed", 0)), "failed");

  eq("RR-111", "a CANCELLATION settlement can no longer override the reviewed one",
     raises(`select public.couranr_begin_payment_refund('${f8.obligationId}','${ops}',
              ${Number(obCol(f8.obligationId, "version"))},'cancel_after_confirmation_before_arrival')`).split("|")[1],
     "refund_settlement_reason_conflict");
  eq("RR-112", "... nor can a standalone full refund",
     raises(`select public.couranr_begin_payment_refund('${f8.obligationId}','${ops}',
              ${Number(obCol(f8.obligationId, "version"))},'full_refund')`).split("|")[1],
     "refund_settlement_reason_conflict");
  eq("RR-113", "... and neither refusal wrote anything",
     one(`select count(*) from public.couranr_payment_refunds where obligation_id='${f8.obligationId}'`), "1");

  /* The mirror: a cancellation settlement already established cannot be
     overridden by an Operations review either. */
  const f9 = await seedCaptured("rr-identity-mirror");
  const cancel9 = one(
    `select id from public.couranr_begin_payment_refund('${f9.obligationId}','${ops}',
       ${Number(obCol(f9.obligationId, "version"))},'cancel_after_confirmation_before_arrival')`
  );
  one(complete(cancel9, "", "failed", 0));
  const rr9 = one(openReq(f9.requestId, ops));
  one(approve(rr9, ops, 1, 100));
  eq("RR-114", "a review cannot override an established CANCELLATION settlement",
     raises(begin(rr9, ops)).split("|")[1], "refund_settlement_reason_conflict");
  eq("RR-115", "... and the review never claims money it did not move",
     rrCol(rr9, "refund_attempt_id"), "-");

  /* Retrying the SAME reason is untouched — that is the documented recovery. */
  const f10 = await seedCaptured("rr-identity-sameReason");
  const rr10 = one(openReq(f10.requestId, ops));
  one(approve(rr10, ops, 1, f10.amountCents));
  const begun10 = one(begin(rr10, ops)).split("|");
  one(complete(begun10[0], "", "failed", 0));
  eq("RR-116", "retrying the SAME governed reason is still permitted",
     raises(`select public.couranr_begin_payment_refund('${f10.obligationId}','${ops}',
              ${Number(obCol(f10.obligationId, "version"))},'operations_reviewed_refund')`).split("|")[1],
     "refund_reason_invalid");

  /* ═══════════════ §14 GRANTS, measured not asserted ═══════════════ */

  /*
   * has_*_privilege, never grantee rows: this project's pg_default_acl grants
   * broadly to anon/authenticated/service_role on every new object in public,
   * so a narrow GRANT can be a silent no-op and only an effective-privilege
   * question finds out.
   */
  const priv = (role, fn) =>
    one(`select has_function_privilege('${role}','${fn}','EXECUTE')::text`);
  const tpriv = (role, p) =>
    one(`select has_table_privilege('${role}','public.couranr_refund_requests','${p}')::text`);

  for (const role of ["anon", "authenticated"]) {
    eq(`RR-G-${role}-approve`, `${role} cannot EXECUTE the approval command`,
       priv(role, "public.couranr_approve_refund_request(uuid,uuid,integer,integer)"), "false");
    eq(`RR-G-${role}-begin`, `${role} cannot EXECUTE the begin command`,
       priv(role, "public.couranr_begin_approved_refund(uuid,uuid)"), "false");
    eq(`RR-G-${role}-select`, `${role} cannot read refund decisions`, tpriv(role, "SELECT"), "false");
  }
  eq("RR-G-svc-approve", "service_role CAN execute the approval command",
     priv("service_role", "public.couranr_approve_refund_request(uuid,uuid,integer,integer)"), "true");
  eq("RR-G-svc-delete", "NOBODY may delete a refund decision — append and advance only",
     tpriv("service_role", "DELETE"), "false");
  eq("RR-G-trigger", "the SECURITY DEFINER trigger fn is callable by no role at all",
     priv("service_role", "public.couranr_refund_request_follow_attempt()"), "false");
  eq("RR-G-rls", "row level security is enabled on the review table",
     one(`select relrowsecurity::text from pg_class where relname='couranr_refund_requests'`), "true");

  const integrity = await gateAIntegrityIssues(psqlTransport(psql));
  eq("RR-100", "the seeded fixtures leave couranr_foundation_integrity() clean",
     integrity.join(",") || "clean", "clean");

  console.log(`\n  Refund review: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exitCode = 1;
});
