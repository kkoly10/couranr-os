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
    if (s.includes(marker)) return marker;
    const other = /constraint "([a-z_]+)"/.exec(s);
    if (other) return `refused-by:${other[1]}`;
    /* A trigger refuses by RAISE, which carries no constraint name. The Couranr
       command convention is a bare snake_case identifier as the message, so a
       named refusal is distinguishable from a typo — "syntax error at or near"
       has spaces and never matches. Without this a correct trigger refusal
       reads as `other:` and scores as a FAILURE, which is how removing a CHECK
       in favour of a trigger looks like a regression when it is the fix. */
    const raised = /ERROR:\s+([a-z][a-z0-9_]{4,})\s*$/m.exec(s);
    if (raised && raised[1].includes("_")) return `raised:${raised[1]}`;
    return `other:${s.replace(/\s+/g," ").slice(0,90)}`; }
};
/* A write that must not succeed. Names the constraint expected, but accepts any
   refusal and REPORTS which rule actually fired — pinning one name turns a
   correct refusal by a neighbouring constraint into a false failure, and hides
   which rule is really doing the work. */
const mustRefuse = (q, expected) => {
  const got = refuses(q, expected);
  return { ok: got !== "ACCEPTED" && !got.startsWith("other:"), got };
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
  const POL = "couranr-consumer-protection-v1-2026-09-14";
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

  /* Negative value. Asserted on a FRESH row rather than by mutating R: R now
     carries a declared value, and the append-only trigger would refuse the
     change before the range CHECK could be reached — so the old UPDATE form
     stopped proving the range rule the moment that trigger existed. An INSERT
     is also what a real caller meets. */
  { const r = mustRefuse(`insert into public.couranr_delivery_requests
        (business_account_id, requester_kind, source, request_state,
         consumer_contact_snapshot, pickup_address, dropoff_address, version,
         created_by, idempotency_key, idempotency_scope,
         declared_value_cents, protection_level, protection_policy_version)
      select null::uuid, 'consumer', source, 'draft',
         '{"email":"s@example.test"}'::jsonb, pickup_address, dropoff_address,
         version, created_by, 'tc-neg-val-' || gen_random_uuid()::text,
         'consumer:tc-negative-value-scope', -1, 'standard', '${POL}'
      from public.couranr_delivery_requests where id='${R}'`,
      "couranr_dr_declared_value_range_chk");
    t("A7", "a negative declared value is refused", r.ok, r.got); }

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

  /* ── §15/§17: email-first and versioned acceptance ────────────────────
     These four constraints shipped in stage 2 written but never once violated
     on purpose. The commit claimed them; nothing proved them. A constraint
     nobody attempts to break is a constraint nobody knows works. */

  // A governed, SUBMITTED consumer request needs sender email + recipient
  // name/email. Build one that is governed and confirmed, then strip each.
  const C = sql(`insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state, submitted_at,
       consumer_contact_snapshot, recipient_name, recipient_email,
       pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope,
       declared_value_cents, protection_level, protection_policy_version,
       sender_terms_version, sender_terms_accepted_at, sender_electronic_consent_at,
       sender_adult_attested_at, recipient_adult_attested_at)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '{"email":"sender@example.test","name":"S"}'::jsonb, 'R Name', 'r@example.test',
       pickup_address, dropoff_address, version, created_by,
       'tc-governed-' || gen_random_uuid()::text, 'consumer:tc-governed-fixture-scope',
       2000, 'standard', '${POL}',
       'shipment-terms-v1', now(), now(), now(), now()
    from public.couranr_delivery_requests where id='${R}' returning id`);
  t("A16", "a fully-governed submitted consumer request IS accepted", C.length === 36, C.slice(0,8));

  /* The sender contact snapshot is IMMUTABLE — a pre-existing trigger
     (requester_identity_is_immutable) refuses to change it at all, which is
     stronger than the email-first rule and fires first. So the email-first
     constraint is exercised where a direct API call would actually hit it: on
     INSERT of a governed, submitted consumer request. */
  const governedInsert = (snapshot, rName, rEmail) => `insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state, submitted_at,
       consumer_contact_snapshot, recipient_name, recipient_email,
       pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope,
       declared_value_cents, protection_level, protection_policy_version,
       sender_terms_version, sender_terms_accepted_at, sender_electronic_consent_at,
       sender_adult_attested_at, recipient_adult_attested_at)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '${snapshot}'::jsonb, ${rName}, ${rEmail},
       pickup_address, dropoff_address, version, created_by,
       'tc-neg-' || gen_random_uuid()::text, 'consumer:tc-negative-fixture-scope',
       2000, 'standard', '${POL}',
       'shipment-terms-v1', now(), now(), now(), now()
    from public.couranr_delivery_requests where id='${R}'`;

  { const r = mustRefuse(governedInsert('{"name":"S"}', "'R Name'", "'r@example.test'"),
      "couranr_dr_consumer_email_first_chk");
    t("A17", "creating a governed request with NO sender email is refused", r.ok, r.got); }

  { const r = mustRefuse(governedInsert('{"phone":"+15550100"}', "'R Name'", "'r@example.test'"),
      "couranr_dr_consumer_email_first_chk");
    t("A20", "a phone cannot substitute for the required sender email", r.ok, r.got); }

  { const r = mustRefuse(governedInsert('{"email":"s@example.test"}', "null", "'r@example.test'"),
      "couranr_dr_consumer_email_first_chk");
    t("A20b", "creating a governed request with NO recipient name is refused", r.ok, r.got); }

  { const r = mustRefuse(`update public.couranr_delivery_requests set recipient_email=null where id='${C}'`, "couranr_dr_consumer_email_first_chk");
    t("A18", "removing the RECIPIENT email from a governed request is refused", r.ok, r.got); }

  { const r = mustRefuse(`update public.couranr_delivery_requests set recipient_name='   ' where id='${C}'`, "couranr_dr_consumer_email_first_chk");
    t("A19", "removing the RECIPIENT name from a governed request is refused", r.ok, r.got); }

  /* These three were UPDATEs that set a column to null. They now reach the
     append-only trigger first, which refuses them for a DIFFERENT and stronger
     reason — so as UPDATEs they would no longer prove the CHECK works at all,
     only that the trigger does. Moved to INSERT, where the CHECK is what a real
     caller actually meets, exactly as A17/A20 do for email-first. The erasure
     property they used to cover is now A29–A32, against the trigger that owns
     it. */
  const missingEvidence = (col) => `insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state, submitted_at,
       consumer_contact_snapshot, recipient_name, recipient_email,
       pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope,
       declared_value_cents, protection_level, protection_policy_version,
       sender_terms_version, sender_terms_accepted_at, sender_electronic_consent_at,
       sender_adult_attested_at)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '{"email":"sender@example.test","name":"S"}'::jsonb, 'R Name', 'r@example.test',
       pickup_address, dropoff_address, version, created_by,
       'tc-miss-' || gen_random_uuid()::text, 'consumer:tc-missing-fixture-scope',
       2000, 'standard', '${POL}',
       ${col === "sender_terms_version" ? "null" : "'shipment-terms-v1'"},
       ${col === "sender_terms_accepted_at" ? "null" : "now()"},
       ${col === "sender_electronic_consent_at" ? "null" : "now()"},
       ${col === "sender_adult_attested_at" ? "null" : "now()"}
    from public.couranr_delivery_requests where id='${R}'`;

  { const r = mustRefuse(missingEvidence("sender_adult_attested_at"),
      "couranr_dr_consumer_acceptance_chk");
    t("A21", "a governed submitted request with NO sender adult attestation is refused", r.ok, r.got); }

  { const r = mustRefuse(missingEvidence("sender_electronic_consent_at"),
      "couranr_dr_consumer_acceptance_chk");
    t("A22", "a governed submitted request with NO electronic consent is refused", r.ok, r.got); }

  /* Both-or-neither: a timestamp saying "they accepted" with no version saying
     WHAT they accepted is not evidence. This is couranr_dr_terms_evidence_chk,
     which is a different rule from the acceptance CHECK and must fire on its
     own — so the row is otherwise complete. */
  { const r = mustRefuse(missingEvidence("sender_terms_version"),
      "couranr_dr_terms_evidence_chk");
    t("A23", "accepted terms with no version is refused — a boolean is not evidence", r.ok, r.got); }

  { const r = mustRefuse(`update public.couranr_delivery_requests set protection_level='none' where id='${C}'`, "couranr_dr_protection_level_chk");
    t("A24", "an unknown protection level is refused", r.ok, r.got); }

  /* ── THE LEGITIMATE UNHAPPY PATH (§27) ────────────────────────────────────
     Every check above attacks the constraint by VIOLATING it, and A16's happy
     path pre-loads `recipient_adult_attested_at` so the row is accepted. Both
     pass while the constraint blocks the only sequence that actually occurs.

     The real order is: the sender completes /send and SUBMITS, which moves the
     request draft -> awaiting_quote_acceptance. Only afterwards does the
     recipient open the tracking link and attest. So at submit time the sender's
     evidence is complete and the recipient's attestation CANNOT exist yet —
     there is no tracking token to attest through until the request is submitted.

     A constraint tested only by breaking it looks perfect and refuses every
     legitimate customer. This is the check that tells the difference. */
  const senderSubmitted = (state) => `insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state, submitted_at,
       consumer_contact_snapshot, recipient_name, recipient_email,
       pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope,
       declared_value_cents, protection_level, protection_policy_version,
       sender_terms_version, sender_terms_accepted_at, sender_electronic_consent_at,
       sender_adult_attested_at, recipient_adult_attested_at)
    select null::uuid, 'consumer', source, '${state}', now(),
       '{"email":"sender@example.test","name":"S"}'::jsonb, 'R Name', 'r@example.test',
       pickup_address, dropoff_address, version, created_by,
       'tc-seq-' || gen_random_uuid()::text, 'consumer:tc-sequence-fixture-scope',
       2000, 'standard', '${POL}',
       'shipment-terms-v1', now(), now(), now(),
       null   -- the recipient has not opened the tracking link yet
    from public.couranr_delivery_requests where id='${R}'`;

  const submitted = {};
  for (const [id, state] of [["A26", "awaiting_quote_acceptance"], ["A27", "pending_couranr_review"]]) {
    let ok = false, detail = "";
    try { submitted[state] = sql(senderSubmitted(state) + " returning id"); ok = true; }
    catch (e) { const m = /constraint "([a-z_]+)"/.exec(String(e.stderr || e.message));
      detail = m ? `blocked by ${m[1]}` : String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 90); }
    t(id, `a sender may SUBMIT to '${state}' before the recipient attests`, ok, detail);
  }

  /* ── consent evidence is APPEND-ONLY ──────────────────────────────────────
     Removing recipient_adult_attested_at from the acceptance CHECK cost a
     property that CHECK was silently providing: once written it could not be
     erased, because a null would fail the constraint on the next write. A CHECK
     cannot say "was not null before", so the property moved to a trigger. These
     prove the trigger actually carries it — otherwise the fix above would have
     quietly traded a blocked flow for erasable evidence. */
  const A26id = submitted["awaiting_quote_acceptance"];
  if (A26id) {
    let ok = false, detail = "";
    try { sql(`update public.couranr_delivery_requests
                 set recipient_adult_attested_at=now() where id='${A26id}'`); ok = true; }
    catch (e) { detail = String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 90); }
    t("A28", "the recipient CAN attest later — null -> a value is the whole point", ok, detail);

    { const r = mustRefuse(`update public.couranr_delivery_requests
        set recipient_adult_attested_at=null where id='${A26id}'`,
        "consumer_consent_evidence_is_append_only");
      t("A29", "and having attested, the attestation cannot be erased", r.ok, r.got); }

    { const r = mustRefuse(`update public.couranr_delivery_requests
        set recipient_adult_attested_at=now() + interval '1 day' where id='${A26id}'`,
        "consumer_consent_evidence_is_append_only");
      t("A30", "nor moved to a different moment", r.ok, r.got); }

    { const r = mustRefuse(`update public.couranr_delivery_requests
        set sender_terms_version='shipment-terms-v0' where id='${A26id}'`,
        "consumer_consent_evidence_is_append_only");
      t("A31", "the terms version accepted against cannot be rewritten", r.ok, r.got); }

    /* The declared value decides the protection level, which decides what the
       driver is told to do. Changing it after the fact would rewrite both the
       sender's representation and the custody instruction. */
    { const r = mustRefuse(`update public.couranr_delivery_requests
        set declared_value_cents=49999 where id='${A26id}'`,
        "consumer_consent_evidence_is_append_only");
      t("A32", "the declared value cannot change once stated", r.ok, r.got); }
  } else {
    t("A28", "the recipient CAN attest later", false, "A26 row was never created");
  }

  /* THE CARVE-OUT, tested in the direction that can regress silently.
     A29-A32 prove the freeze holds after submit. Nothing above proves the
     sender can still revise BEFORE it — and if the freeze were tightened back
     to "from first write", every one of those would still pass while a sender
     who corrected a typo on the /send form got a CR409. A rule that only ever
     refuses is only ever tested by refusals. */
  { const D = sql(`insert into public.couranr_delivery_requests
        (business_account_id, requester_kind, source, request_state,
         consumer_contact_snapshot, recipient_name, recipient_email,
         pickup_address, dropoff_address, version,
         created_by, idempotency_key, idempotency_scope,
         declared_value_cents, protection_level, protection_policy_version,
         sender_terms_version, sender_terms_accepted_at)
      select null::uuid, 'consumer', source, 'draft',
         '{"email":"s@example.test"}'::jsonb, 'R Name', 'r@example.test',
         pickup_address, dropoff_address,
         version, created_by, 'tc-draft-' || gen_random_uuid()::text,
         'consumer:tc-draft-revision-scope', 2000, 'standard', '${POL}',
         'shipment-terms-v1', now()
      from public.couranr_delivery_requests where id='${R}' returning id`);

    let ok = false, detail = "";
    try {
      // $20.00 -> $200.00, which also moves the derived level standard ->
      // protected_handoff. Both must be writable while the statement is a draft.
      sql(`update public.couranr_delivery_requests
             set declared_value_cents=20000, protection_level='protected_handoff'
           where id='${D}'`);
      const now = sql(`select declared_value_cents||'/'||protection_level
                       from public.couranr_delivery_requests where id='${D}'`);
      ok = now === "20000/protected_handoff"; detail = now;
    } catch (e) { detail = String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 90); }
    t("A34", "a sender may still revise the declared value while it is a DRAFT", ok, detail);

    let ok2 = false, detail2 = "";
    try {
      sql(`update public.couranr_delivery_requests
             set sender_terms_accepted_at=now() + interval '1 minute' where id='${D}'`);
      ok2 = true;
    } catch (e) { detail2 = String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 90); }
    t("A35", "and may re-accept the terms while it is a DRAFT", ok2, detail2);

    /* And the freeze must engage the moment it stops being a draft — otherwise
       the carve-out is not a carve-out, it is a hole. */
    sql(`update public.couranr_delivery_requests
           set request_state='awaiting_quote_acceptance', submitted_at=now(),
               sender_electronic_consent_at=now(), sender_adult_attested_at=now()
         where id='${D}'`);
    { const r = mustRefuse(`update public.couranr_delivery_requests
        set declared_value_cents=100 where id='${D}'`,
        "consumer_consent_evidence_is_append_only");
      t("A36", "and the freeze engages the moment it leaves draft", r.ok, r.got); }
  }

  /* ── §D: the COMMAND, executed ─────────────────────────────────────────
     Every check above asserts what the SCHEMA refuses. None of them calls the
     function a real /send submit actually goes through, and a migration that
     applies is not a command that runs: this repo has already shipped a foreign
     key pointing at the wrong table, invisible to 1230 green tests and a full
     forward-and-back migration round trip, because nothing ever INSERTED. */
  const draftFor = (scope) => sql(`insert into public.couranr_delivery_requests
      (business_account_id, requester_kind, source, request_state,
       consumer_contact_snapshot, recipient_name, recipient_email,
       pickup_address, dropoff_address, version, created_by,
       idempotency_key, idempotency_scope)
    select null::uuid, 'consumer', source, 'draft',
       '{"email":"s@example.test","name":"S"}'::jsonb, 'R Name', 'r@example.test',
       pickup_address, dropoff_address, 1, created_by,
       '${scope}-' || gen_random_uuid()::text, 'consumer:${scope}'
    from public.couranr_delivery_requests where id='${R}' returning id`);

  /* The command derives the request from the SESSION and the scope must match
     'consumer:'||session.id, so the session is created first and the draft is
     inserted under its id — the same binding a real guest flow produces. */
  const sessionFor = (requestId) => sql(`insert into public.couranr_consumer_guest_sessions
      (token_hash, request_id, expires_at)
    values (md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),  -- 64 hex chars without pgcrypto
            ${requestId ? `'${requestId}'` : "null"},
            now() + interval '1 hour') returning id`);

  const newBinding = () => {
    const sid = sessionFor(null);
    const rid = draftFor(sid);   // idempotency_scope = 'consumer:<session id>'
    sql(`update public.couranr_consumer_guest_sessions set request_id='${rid}' where id='${sid}'`);
    return { sid, rid };
  };

  const callTrust = (sid, cents, terms, a1, a2) =>
    `select public.couranr_record_consumer_trust('${sid}'::uuid, ${cents}, ${terms}, ${a1}, ${a2})`;

  { const { sid, rid } = newBinding();
    let ok = false, detail = "";
    try {
      sql(callTrust(sid, 15001, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"));
      const row = sql(`select declared_value_cents||'/'||protection_level||'/'||
                              (protection_policy_version is not null)||'/'||
                              (sender_terms_accepted_at is not null)||'/'||
                              (sender_electronic_consent_at is not null)||'/'||
                              (sender_adult_attested_at is not null)||'/'||version
                       from public.couranr_delivery_requests where id='${rid}'`);
      // $150.01 -> protected_handoff, DERIVED: the command takes no level.
      ok = row === "15001/protected_handoff/true/true/true/true/2"; detail = row;
    } catch (e) { detail = String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 110); }
    t("D1", "the command records the statement and DERIVES the level", ok, detail);

    /* Re-running must not move the recorded moment. A sender who revises a
       draft and re-accepts has not consented at a later time; a fresher
       timestamp would be a more flattering record of the same event. */
    const before = sql(`select sender_terms_accepted_at from public.couranr_delivery_requests where id='${rid}'`);
    sql(callTrust(sid, 2000, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"));
    const after = sql(`select declared_value_cents||'/'||protection_level||'/'||sender_terms_accepted_at
                       from public.couranr_delivery_requests where id='${rid}'`);
    t("D2", "re-stating a draft updates the value but never moves the accepted moment",
      after === `2000/standard/${before}`, after);
  }

  for (const [id, what, cents, a1, a2, expected] of [
    ["D3", "a value over the $500 ceiling is refused", 50001, "true", "true", "declared_value_invalid"],
    ["D4", "a negative value is refused", -1, "true", "true", "declared_value_invalid"],
    ["D5", "a null value is refused, never treated as $0", "null", "true", "true", "declared_value_invalid"],
    ["D6", "an unticked certification is refused", 2000, "false", "true", "shipment_certification_required"],
    ["D7", "an unticked electronic consent is refused", 2000, "true", "false", "electronic_consent_required"],
    ["D8", "a null acknowledgement is not a true one", 2000, "null", "true", "shipment_certification_required"],
  ]) {
    const { sid } = newBinding();
    const r = mustRefuse(callTrust(sid, cents, "'couranr-consumer-shipment-terms-2026-09'", a1, a2), expected);
    t(id, what, r.ok && r.got === expected, r.got);
  }

  { const { sid } = newBinding();
    const r = mustRefuse(callTrust(sid, 2000, "null", "true", "true"), "terms_version_required");
    t("D9", "consent with no document version is refused — a boolean is not evidence",
      r.ok && r.got === "terms_version_required", r.got); }

  { const { sid, rid } = newBinding();
    sql(callTrust(sid, 2000, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"));
    sql(`update public.couranr_delivery_requests
           set request_state='awaiting_quote_acceptance', submitted_at=now() where id='${rid}'`);
    const r = mustRefuse(callTrust(sid, 49999, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"),
      "consumer_trust_already_tendered");
    t("D10", "a TENDERED request cannot have its statement rewritten",
      r.ok && r.got === "consumer_trust_already_tendered", r.got); }

  { /* The authority boundary: a session that names no request, is expired, or
       is revoked cannot reach any row. */
    const orphan = sessionFor(null);
    const r = mustRefuse(callTrust(orphan, 2000, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"),
      "guest_session_not_available");
    t("D11", "a session bound to no request cannot record a statement",
      r.ok && r.got === "guest_session_not_available", r.got);

    const { sid } = newBinding();
    sql(`update public.couranr_consumer_guest_sessions set revoked_at=now() where id='${sid}'`);
    const r2 = mustRefuse(callTrust(sid, 2000, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"),
      "guest_session_not_available");
    t("D12", "a REVOKED session cannot record a statement",
      r2.ok && r2.got === "guest_session_not_available", r2.got); }

  /* THE CHAIN, asserted rather than incidental. D10 happens to perform this
     transition on its way to proving something else; if the acceptance
     constraint ever refused it again — the exact defect ed67b12b fixed — D10
     would die in setup and report a confusing failure about rewriting a tendered
     statement. This says what is actually being claimed: a draft that has
     recorded its trust statement can be SUBMITTED, with the recipient's
     attestation still absent because the recipient has no tracking link yet. */
  { const { sid, rid } = newBinding();
    sql(callTrust(sid, 15001, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"));
    let ok = false, detail = "";
    try {
      sql(`update public.couranr_delivery_requests
             set request_state='awaiting_quote_acceptance', submitted_at=now(), version=version+1
           where id='${rid}'`);
      const row = sql(`select request_state||'/'||protection_level||'/'||
                              (recipient_adult_attested_at is null)
                       from public.couranr_delivery_requests where id='${rid}'`);
      ok = row === "awaiting_quote_acceptance/protected_handoff/true"; detail = row;
    } catch (e) { const m = /constraint "([a-z_]+)"/.exec(String(e.stderr || e.message));
      detail = m ? `blocked by ${m[1]}` : String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 90); }
    t("D14", "a trust-recorded draft SUBMITS, recipient attestation still absent", ok, detail); }

  { const { sid, rid } = newBinding();
    sql(callTrust(sid, 2000, "'couranr-consumer-shipment-terms-2026-09'", "true", "true"));
    const ev = sql(`select command||'/'||(metadata->>'protectionLevel')||'/'||(metadata->>'declaredValueCents')
                    from public.couranr_delivery_request_events
                    where request_id='${rid}' and command='record_consumer_trust'`);
    t("D13", "the statement leaves an audit event naming the derived level",
      ev === "record_consumer_trust/standard/2000", ev); }

  const driverFor = (email) => {
    const u = sql(`insert into auth.users (email) values ('${email}') returning id`);
    return { userId: u, driverId: sql(
      `insert into public.couranr_drivers (user_id, display_name, driver_state, active)
       values ('${u}', 'TC driver', 'active', true) returning id`) };
  };

  /* Assignments reference a real dispatch vehicle. One is enough for every
     fixture — none of these checks reads the vehicle. */
  const VEH = sql(`insert into public.couranr_dispatch_vehicles
      (name, vehicle_class, payload_capacity_lb)
    values ('TC van', 'van', 2000) returning id`);

  const drvA = driverFor("tc-driver-a@example.test");
  const drvB = driverFor("tc-driver-b@example.test");

  /* A25's own delivery/assignment. A DEDICATED driver on purpose: the authority
     helper resolves a driver's single live assignment, so reusing drvA here
     would make §E's "not your delivery" checks depend on which of two
     assignments it happened to pick. */
  const drvVocab = driverFor("tc-driver-vocab@example.test");
  const VOCAB = { dlv: D };
  VOCAB.asg = sql(`insert into public.couranr_delivery_assignments
      (delivery_id, driver_id, vehicle_id, assignment_state, assignment_source, assigned_by)
    values ('${D}', '${drvVocab.driverId}', '${VEH}', 'active', 'operations', '${usr}')
    returning id`);

  /* ── §E: CUSTODY RESEQUENCING, executed ────────────────────────────────
     Above $30 the pickup credential stops meaning "a driver arrived" and starts
     meaning "the documented and sealed shipment is what I am tendering". That
     is only true when the credential is confirmed AFTER the documentation, so
     ORDER is the substance here, not a detail.

     FIXTURES ARE SEEDED, NOT HAND-BUILT. A delivery carries snapshots that a
     pre-existing invariant trigger checks against its quote version, obligation,
     plan and request — all four must agree — and couranr_dr_quote_projection_trg
     refuses a direct write to the quote projection at all. Both guards are
     correct and neither should be worked around, so each fixture is a real
     chain from seedCanonicalDeliveryChain. The protection columns are then set
     the same way the A-series sets them on R, which the append-only trigger
     permits precisely because it is their FIRST value. */
  const govern = (requestId, cents, level) => sql(
    `update public.couranr_delivery_requests
       set declared_value_cents=${cents}, protection_level='${level}',
           protection_policy_version='${POL}'
     where id='${requestId}'`);

  const custodyChain = async (marker, cents, level) => {
    const c = await seedCanonicalDeliveryChain(psqlTransport(psql), {
      businessId: biz, actorUserId: usr, marker, recipientName: "TC recipient",
    });
    if (level !== null) govern(c.requestId, cents, level);
    sql(`update public.couranr_deliveries
           set fulfillment_state='at_pickup' where id='${c.deliveryId}'`);
    return { req: c.requestId, dlv: c.deliveryId };
  };

  const assign = (f, drv) => {
    f.asg = sql(`insert into public.couranr_delivery_assignments
        (delivery_id, driver_id, vehicle_id, assignment_state,
         assignment_source, assigned_by)
      -- couranr_asg_source_actor_chk: an 'operations' assignment names who made
      -- it; an 'automatic' one names the dispatch reservation instead.
      values ('${f.dlv}', '${drv.driverId}', '${VEH}', 'active',
              'operations', '${usr}') returning id`);
    return f.asg;
  };

  const addProof = (f, type, drv, at = "now()") => sql(
    `insert into public.couranr_delivery_proofs
       (delivery_id, assignment_id, proof_stage, proof_type, actor_driver_id, finalized_at)
     values ('${f.dlv}', '${f.asg}', 'pickup', '${type}', '${drv.driverId}', ${at})
     returning id`);

  const consumeCode = (f, gen, at) => sql(
    `insert into public.couranr_handoff_codes
       (delivery_id, code_kind, generation, code_digest, code_state, expires_at,
        consumed_at, issued_by)
     -- couranr_hc_issuer_xor_chk: exactly one issuer — a user OR a guest session.
     values ('${f.dlv}', 'merchant_pickup', ${gen}, repeat('a',64), 'consumed',
             now() + interval '1 hour', ${at}, '${usr}') returning id`);

  const pickUp = (f) =>
    `update public.couranr_deliveries set fulfillment_state='picked_up',
       version=version+1, updated_at=now() where id='${f.dlv}'`;

  const succeeds = (q, f) => {
    try { sql(q); return { ok: sql(`select fulfillment_state from public.couranr_deliveries
                                    where id='${f.dlv}'`) === "picked_up", got: "picked_up" }; }
    catch (e) { const m = /ERROR:\s+([a-z_]+)/.exec(String(e.stderr || e.message));
      return { ok: false, got: m ? m[1] : String(e.stderr || e.message).replace(/\s+/g," ").slice(0,90) }; }
  };


  /* ONE delivery walked through the whole sequence. Each refusal leaves the
     state at at_pickup, so the next step adds exactly the thing the previous
     one was missing — which is also the order a driver actually works in. */
  const sec = await custodyChain("tc-custody-secure", 5000, "secure_pickup");
  assign(sec, drvA);
  // The credential taken on ARRIVAL, before anything is documented.
  consumeCode(sec, 1, "now() - interval '10 minutes'");

  { const r = mustRefuse(pickUp(sec), "item_prepack_photo_required");
    t("E1", "a secure pickup without the ITEM photo cannot complete",
      (r.got === "item_prepack_photo_required" || r.got === "raised:item_prepack_photo_required"), r.got); }

  addProof(sec, "item_prepack_photo", drvA, "now() - interval '5 minutes'");
  { const r = mustRefuse(pickUp(sec), "sealed_package_photo_required");
    t("E2", "...nor without the SEALED PACKAGE photo",
      (r.got === "sealed_package_photo_required" || r.got === "raised:sealed_package_photo_required"), r.got); }

  const sealProof = addProof(sec, "sealed_package_photo", drvA, "now() - interval '4 minutes'");
  { const r = mustRefuse(pickUp(sec), "security_seal_required");
    t("E3", "...nor with both photos but NO seal recorded",
      (r.got === "security_seal_required" || r.got === "raised:security_seal_required"), r.got); }

  sql(`select public.couranr_record_delivery_seal('${sec.dlv}','${drvA.userId}','SEAL-E-0001','${sealProof}')`);
  /* E4: THE ORDER. Every individual requirement is now satisfied — photos
     taken, seal applied, credential consumed. The only defect left is that the
     sender confirmed BEFORE the documentation existed, so their confirmation
     cannot mean "this documented, sealed shipment". */
  { const r = mustRefuse(pickUp(sec), "pickup_credential_before_documentation");
    t("E4", "a credential taken BEFORE the documentation is refused",
      (r.got === "pickup_credential_before_documentation" || r.got === "raised:pickup_credential_before_documentation"), r.got); }

  // The sender re-confirms, now that there is something to confirm.
  consumeCode(sec, 2, "now()");
  { const r = succeeds(pickUp(sec), sec);
    t("E5", "documented, sealed, THEN confirmed — the pickup completes", r.ok, r.got); }

  { const r = mustRefuse(
      `select public.couranr_record_delivery_seal('${sec.dlv}','${drvA.userId}','SEAL-E-0002','${sealProof}')`,
      "couranr_dss_one_seal_per_delivery_uniq");
    t("E10", "a SECOND seal on the same delivery is refused", r.ok, r.got); }

  { const r = mustRefuse(
      `select public.couranr_record_delivery_seal('${sec.dlv}','${drvB.userId}','SEAL-E-0003','${sealProof}')`,
      "not_your_delivery");
    t("E11", "a driver who does not hold the assignment cannot seal it",
      (r.got === "not_your_delivery" || r.got === "raised:not_your_delivery"), r.got); }

  /* A seal must cite a photograph of THIS delivery. A serial typed against
     someone else's proof is a serial typed into a box. */
  /* A DIFFERENT driver, because couranr_asg_one_active_per_driver allows a
     driver exactly one live assignment — which is the same invariant that makes
     couranr_driver_assignment_for able to resolve "their" delivery at all. */
  { const other = await custodyChain("tc-custody-secure-2", 5000, "secure_pickup");
    assign(other, drvB);
    addProof(other, "sealed_package_photo", drvB);
    // drvB holds `other`; `sealProof` is a photograph of `sec`. The seal must be
    // refused for citing evidence from a delivery it does not belong to.
    const r = mustRefuse(
      `select public.couranr_record_delivery_seal('${other.dlv}','${drvB.userId}','SEAL-E-0004','${sealProof}')`,
      "sealed_package_photo_required");
    t("E9", "a seal cannot cite ANOTHER delivery's photograph",
      (r.got === "sealed_package_photo_required" || r.got === "raised:sealed_package_photo_required"), r.got); }

  /* E6/E7: the rule must reach ONLY governed secure deliveries. A rule that
     also stopped every business pickup would be found in production, not here,
     and "it fires only for secure" is the claim actually being made. */
  { const f = await custodyChain("tc-custody-ungoverned", null, null);
    const r = succeeds(pickUp(f), f);
    t("E6", "an UNGOVERNED delivery is untouched by all of it", r.ok, r.got); }

  { const f = await custodyChain("tc-custody-standard", 3000, "standard");
    const r = succeeds(pickUp(f), f);
    t("E7", "a $30.00 STANDARD delivery keeps the simple pickup", r.ok, r.got); }

  { const f = await custodyChain("tc-custody-standard-2", 3000, "standard");
    const d = driverFor("tc-driver-c@example.test");
    assign(f, d);
    const pr = addProof(f, "sealed_package_photo", d);
    const r = mustRefuse(
      `select public.couranr_record_delivery_seal('${f.dlv}','${d.userId}','SEAL-E-0005','${pr}')`,
      "seal_not_required_for_delivery");
    t("E8", "a seal on a STANDARD delivery is refused, not quietly stored",
      (r.got === "seal_not_required_for_delivery" || r.got === "raised:seal_not_required_for_delivery"), r.got); }

  /* A recipient attestation on a row this policy does NOT govern would imply a
     workflow that never ran. */
  { const r = mustRefuse(`insert into public.couranr_delivery_requests
        (business_account_id, requester_kind, source, request_state,
         consumer_contact_snapshot, pickup_address, dropoff_address, version,
         created_by, idempotency_key, idempotency_scope, recipient_adult_attested_at)
      select null::uuid, 'consumer', source, 'draft',
         '{"email":"s@example.test"}'::jsonb, pickup_address, dropoff_address,
         version, created_by, 'tc-ung-' || gen_random_uuid()::text,
         'consumer:tc-ungoverned-scope', now()
      from public.couranr_delivery_requests where id='${R}'`,
      "couranr_dr_recipient_attestation_chk");
    t("A33", "an UNGOVERNED row cannot carry a recipient attestation", r.ok, r.got); }


  // The two new proof types must actually be storable, or Secure Pickup cannot
  // record what it is required to record.
  /* The two new proof types must be WRITABLE, not merely listed.
     This check used to insert a deliberately INCOMPLETE row and assert on WHICH
     rule refused it — reasoning that a refusal naming assignment_id proved the
     proof_type had got through. It proved the ORDER OF TWO ERRORS and nothing
     else, and it hid a real defect for a whole stage: TWO constraints police
     this column, couranr_delivery_proofs_proof_type_check and
     couranr_dp_type_chk, the migration extended only the first, and the NOT NULL
     on assignment_id fired before the second could be reached. Every Secure
     Pickup would have been impossible in production.

     So the row is COMPLETE now and the assertion is that it lands. The driver
     and vehicle chain that made this look disproportionate is built anyway for
     the §E checks below. */
  for (const pt of ["item_prepack_photo", "sealed_package_photo"]) {
    let ok = false, detail = "";
    try {
      const id = sql(`insert into public.couranr_delivery_proofs
          (delivery_id, assignment_id, proof_stage, proof_type, actor_driver_id,
           storage_bucket, storage_object_path, byte_size, mime_type,
           -- couranr_dp_v2_identity_shape_chk: client_evidence_id, evidence_sha256
           -- and captured_at are all-or-nothing. A row carrying two of the three
           -- is a half-recorded piece of offline evidence.
           evidence_sha256, client_evidence_id, captured_at)
        values ('${VOCAB.dlv}', '${VOCAB.asg}', 'pickup', '${pt}', '${drvVocab.driverId}',
          'delivery-photos', 'x/${pt}', 100, 'image/jpeg', repeat('a',64),
          gen_random_uuid(), now()) returning id`);
      ok = id.length === 36; detail = id.slice(0, 8);
    } catch (e) { const t2 = String(e.stderr || e.message);
      const c = /constraint "([a-z0-9_]+)"/.exec(t2);
      const m = /ERROR:\s+(.{0,60})/.exec(t2);
      detail = c ? c[1] : (m ? m[1] : "refused"); }
    t("A25", `${pt} can actually be WRITTEN, not just listed`, ok, detail);
  }

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
