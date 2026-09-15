/**
 * Consumer Same Day V1 — Trust, Custody & Fraud, EXECUTED against a disposable
 * database with every forward migration applied.
 *
 * WHY THIS EXISTS RATHER THAN SQL-TEXT ASSERTIONS. A CHECK constraint that
 * parses is not a CHECK constraint that refuses. Every assertion here ATTEMPTS
 * the attack and reads what the database said — the defect class CLAUDE.md
 * names as invisible to text assertions and fatal at runtime.
 *
 * The attacks come from the owner's §27 list. The one that matters most is A2:
 * a tampered payload asking for 'standard' on a $500 shipment. TypeScript
 * refusing it is not enough, because the browser is not an enforcement point —
 * the database re-derives the level and refuses the row.
 *
 * A8 is the §25 counterpart: a CONFIRMED consumer row carrying no policy
 * version, no recipient email and no acceptance evidence must still be
 * accepted, or the migration would have broken every historical delivery.
 *
 * Run: node e2e/disposable/consumerTrustCustody.mjs
 * On macOS export COURANR_PGBIN and COURANR_DISPOSABLE_DIR — up.mjs explains why.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";
const sql = (q) => psql(q).trim();
let pass = 0, fail = 0;
const t = (id, what, ok, detail = "") => { ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${what}${detail ? `  [${detail}]` : ""}`); };
const refuses = (q, marker) => {
  try { psql(q); return "ACCEPTED"; }
  catch (e) { const s = String(e.stderr || e.message);
    return s.includes(marker) ? marker : `other:${s.replace(/\s+/g," ").slice(0,90)}`; }
};
try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);
  const biz = sql(`insert into public.business_accounts (name,status) values ('TC probe','active') returning id`);
  const usr = sql(`insert into auth.users (email) values ('tcprobe@example.test') returning id`);
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: biz, actorUserId: usr, marker: "tc-probe", recipientName: "TC recipient",
  });
  const R = chain.requestId;
  const setV = (cents, level) =>
    `update public.couranr_delivery_requests set declared_value_cents=${cents},`
    + ` protection_level=${level === null ? "null" : `'${level}'`},`
    + ` protection_policy_version='couranr-consumer-protection-v1-2026-09-14' where id='${R}'`;

  // §27: declare $501
  t("A1", "$501 is refused at the database",
    refuses(setV(50001, "protected_handoff"), "couranr_dr_declared_value_range_chk") === "couranr_dr_declared_value_range_chk");

  // §27: tamper to choose 'standard' for a $500 shipment
  t("A2", "a $500 shipment cannot be stored as 'standard'",
    refuses(setV(50000, "standard"), "couranr_dr_protection_derived_chk") === "couranr_dr_protection_derived_chk");
  t("A3", "a $150.01 shipment cannot be stored as 'secure_pickup'",
    refuses(setV(15001, "secure_pickup"), "couranr_dr_protection_derived_chk") === "couranr_dr_protection_derived_chk");
  t("A4", "a $30.01 shipment cannot be stored as 'standard'",
    refuses(setV(3001, "standard"), "couranr_dr_protection_derived_chk") === "couranr_dr_protection_derived_chk");

  // the legitimate value is accepted
  psql(setV(50000, "protected_handoff"));
  t("A5", "the correctly derived level IS accepted",
    sql(`select protection_level from public.couranr_delivery_requests where id='${R}'`) === "protected_handoff");

  // half-governed is impossible
  t("A6", "a declared value without a level is refused",
    refuses(`update public.couranr_delivery_requests set protection_level=null where id='${R}'`,
      "couranr_dr_protection_completeness_chk") === "couranr_dr_protection_completeness_chk");

  // negative value
  t("A7", "a negative declared value is refused",
    refuses(setV(-1, "standard"), "couranr_dr_declared_value_range_chk") === "couranr_dr_declared_value_range_chk");

  // historical compatibility: an ungoverned row is untouched by every new rule
  // The row that matters for §25: CONFIRMED, consumer, no policy version, no
  // recipient email, no acceptance evidence. Every new constraint must ignore it.
  const H = sql(`insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state, submitted_at,
       consumer_contact_snapshot, pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '{"phone":"+15550100"}'::jsonb, pickup_address, dropoff_address, version, created_by,
       'tc-probe-historical-' || gen_random_uuid()::text, 'consumer:tc-probe-historical'
    from public.couranr_delivery_requests where id='${R}' returning id`);
  t("A8", "a CONFIRMED consumer row with no policy version, no recipient email and no acceptance is accepted", H.length === 36, H.slice(0,8));

  // seal: vocabulary and pairing
  const D = chain.deliveryId;
  psql(`insert into public.couranr_delivery_security_seals (delivery_id, seal_identifier) values ('${D}','CR-019482')`);
  t("A9", "a second seal on the same delivery is refused",
    refuses(`insert into public.couranr_delivery_security_seals (delivery_id, seal_identifier) values ('${D}','CR-000002')`,
      "couranr_dss_one_seal_per_delivery_uniq") === "couranr_dss_one_seal_per_delivery_uniq");
  t("A10", "an unknown seal condition is refused",
    refuses(`update public.couranr_delivery_security_seals set dropoff_condition='fine', dropoff_recorded_at=now() where delivery_id='${D}'`,
      "couranr_dss_condition_chk") === "couranr_dss_condition_chk");
  t("A11", "a seal condition without its timestamp is refused",
    refuses(`update public.couranr_delivery_security_seals set dropoff_condition='damaged' where delivery_id='${D}'`,
      "couranr_dss_condition_pair_chk") === "couranr_dss_condition_pair_chk");

  // identity: cannot claim adult/match without identity itself
  t("A12", "adult_verified cannot be claimed without identity_verified",
    refuses(`insert into public.couranr_recipient_identity_verifications
       (delivery_id, policy_version, identity_verified, adult_verified)
       values ('${D}','v1', false, true)`, "couranr_riv_derived_flags_chk") === "couranr_riv_derived_flags_chk");
  t("A13", "a 'verified' state without verified_at is refused",
    refuses(`insert into public.couranr_recipient_identity_verifications
       (delivery_id, policy_version, verification_state) values ('${D}','v1','verified')`,
      "couranr_riv_verified_pair_chk") === "couranr_riv_verified_pair_chk");

  /* ── the rollback's refuse-on-evidence behaviour ───────────────────────
     Governed rows and a seal now exist, so the paired rollback must REFUSE
     rather than drop the columns a claim depends on. Verified by running the
     real rollback file, not by reading it. */
  const rollback = "supabase/rollbacks/20260915090000_couranr_consumer_trust_custody_v1.rollback.sql";
  let rolled = "ACCEPTED";
  try {
    execFileSync(path.join(process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin", "psql"), [
      "-h", "127.0.0.1", "-p", String(process.env.COURANR_DISPOSABLE_PORT || 55432),
      "-U", "postgres", "-d", "couranr_disposable", "-q", "-v", "ON_ERROR_STOP=1", "-f", rollback,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const msg = String(e.stderr || e.message);
    rolled = msg.includes("consumer_trust_custody_rollback_refused")
      ? "refused" : `other:${msg.replace(/\s+/g, " ").slice(0, 80)}`;
  }
  t("A14", "the rollback REFUSES while custody evidence exists", rolled === "refused", rolled);
  t("A15", "and the columns survive the refusal",
    sql(`select count(*) from information_schema.columns where table_schema='public'
         and table_name='couranr_delivery_requests' and column_name='declared_value_cents'`) === "1");

  console.log(`\n  probe: ${pass} passed, ${fail} failed`);
} finally { down({ quiet: true }); }
process.exit(fail === 0 ? 0 : 1);
