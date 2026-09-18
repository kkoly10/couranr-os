/**
 * P10-015 second half, executed: a historical leave_at_door request must not
 * MATERIALIZE a new delivery, while the one that already has a delivery keeps
 * working.
 *
 *   export COURANR_PGBIN=/opt/homebrew/opt/postgresql@17/bin
 *   export COURANR_DISPOSABLE_DIR=/tmp/pgdisp-conv
 *   export COURANR_DISPOSABLE_PORT=55439
 *   node e2e/disposable/withdrawnProofConversion.mjs
 *
 * The ordering under test exists only at execution time: a guard placed one
 * line too early would refuse the grandfathered delivery, and one placed too
 * late would refuse nothing.
 */
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";

const sql = (q) => psql(q).trim();
let pass = 0, fail = 0;
const t = (id, what, ok, detail = "") => { ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${what}${detail ? `  [${detail}]` : ""}`); };
const refuses = (q, marker) => {
  try { psql(q); return "ACCEPTED"; }
  catch (e) { const s = String(e.stderr || e.message);
    if (s.includes(marker)) return marker;
    const c = /constraint "([a-z_]+)"/.exec(s); if (c) return `refused-by:${c[1]}`;
    const r = /ERROR:\s+([a-z][a-z0-9_]{4,})\s*$/m.exec(s);
    if (r && r[1].includes("_")) return `raised:${r[1]}`;
    return `other:${s.replace(/\s+/g," ").slice(0,110)}`; }
};

try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);

  const biz = sql(`insert into public.business_accounts (name,status) values ('conv probe','active') returning id`);
  const usr = sql(`insert into auth.users (email) values ('conv@example.test') returning id`);
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: biz, actorUserId: usr, marker: "conv-probe", recipientName: "Conv recipient",
  });

  const setMethod = (rid, m) =>
    sql(`update public.couranr_delivery_requests set proof_method='${m}' where id='${rid}' returning proof_method`);

  /* ── A. the GRANDFATHERED case: a delivery already exists ─────────────── */
  setMethod(chain.requestId, "leave_at_door");
  const before = sql(`select id from public.couranr_deliveries where request_id='${chain.requestId}'`);
  t("C0", "fixture: the chain request already has a delivery", before.length === 36, before.slice(0, 8));

  const idem = sql(`select id from public.couranr_create_delivery_from_capture('${chain.requestId}')`);
  t("C1", "GRANDFATHERED — an existing leave_at_door delivery is returned, not refused",
    idem === before, `${idem.slice(0,8)} vs ${before.slice(0,8)}`);

  const idemCredit = sql(`select id from public.couranr_create_delivery_from_promotional_credit('${chain.requestId}')`);
  t("C2", "and the credit path returns it too, idempotently", idemCredit === before);

  const stillOne = sql(`select count(*) from public.couranr_deliveries where request_id='${chain.requestId}'`);
  t("C3", "no second delivery was created by either call", stillOne === "1", stillOne);

  /* ── B. the AT-RISK case: historical method, NO delivery ──────────────── */
  const bare = sql(`insert into public.couranr_delivery_requests
      (business_account_id,requester_kind,source,request_state,submitted_at,
       recipient_name,recipient_phone,pickup_address,dropoff_address,
       idempotency_key,proof_method)
    select '${biz}','business','merchant_portal','confirmed',now(),
       'R','+15715550100',pickup_address,dropoff_address,
       'conv-bare-key','leave_at_door'
    from public.couranr_delivery_requests where id='${chain.requestId}' returning id`);
  const noDelivery = sql(`select count(*) from public.couranr_deliveries where request_id='${bare}'`);
  t("C4", "fixture: the at-risk request has NO delivery", noDelivery === "0", noDelivery);

  const cap = refuses(`select public.couranr_create_delivery_from_capture('${bare}')`,
    "proof_method_currently_unavailable");
  t("C5", "CAPTURE path refuses to materialize a withdrawn method",
    cap === "raised:proof_method_currently_unavailable" || cap === "proof_method_currently_unavailable", cap);

  const cred = refuses(`select public.couranr_create_delivery_from_promotional_credit('${bare}')`,
    "proof_method_currently_unavailable");
  t("C6", "CREDIT path refuses it too — the automatic worker uses this one",
    cred === "raised:proof_method_currently_unavailable" || cred === "proof_method_currently_unavailable", cred);

  t("C7", "and neither call created anything",
    sql(`select count(*) from public.couranr_deliveries where request_id='${bare}'`) === "0");

  t("C8", "the refusal did NOT rewrite the historical request",
    sql(`select proof_method from public.couranr_delivery_requests where id='${bare}'`) === "leave_at_door");

  /* ── C. the supported methods are untouched ───────────────────────────── */
  for (const m of ["photo_or_pin", "signature"]) {
    setMethod(bare, m);
    const got = refuses(`select public.couranr_create_delivery_from_capture('${bare}')`,
      "proof_method_currently_unavailable");
    /* It will fail for a REAL reason — no captured obligation — which is the
       point: it gets PAST the proof-method guard. */
    t(`C9-${m}`, `${m} is not blocked by the proof-method guard`,
      got !== "raised:proof_method_currently_unavailable" && got !== "proof_method_currently_unavailable", got);
  }
  setMethod(bare, "leave_at_door");

  /* ── D. the driver's completion command is untouched ──────────────────── */
  const cmd = sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='couranr_complete_leave_at_door_delivery'`);
  t("C10", "the driver completion command still exists for the in-flight delivery", cmd === "1", cmd);

  const vocab = sql(`select count(*) from pg_constraint
    where conname like '%proof_method%' and pg_get_constraintdef(oid) not like '%leave_at_door%'`);
  t("C11", "no stored proof-method vocabulary dropped leave_at_door", vocab === "0", vocab);

} catch (e) {
  console.error("\n  SUITE ERROR:", String(e.stderr || e.message).slice(0, 900));
  fail += 1;
} finally {
  down({ quiet: true });
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
