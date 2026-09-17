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
  { const r = mustRefuse(`insert into public.couranr_recipient_identity_verifications
       (delivery_id, policy_version, verification_state) values ('${D}','v1','verified')`,
      "couranr_riv_outcome_coherence_chk");
    t("A13", "a 'verified' state without coherent verified evidence is refused", r.ok, r.got); }

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
       sender_adult_attested_at)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '{"email":"sender@example.test","name":"S"}'::jsonb, 'R Name', 'r@example.test',
       pickup_address, dropoff_address, version, created_by,
       'tc-governed-' || gen_random_uuid()::text, 'consumer:tc-governed-fixture-scope',
       2000, 'standard', '${POL}',
       'shipment-terms-v1', now(), now(), now()
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
       sender_adult_attested_at)
    select null::uuid, 'consumer', source, 'confirmed', now(),
       '${snapshot}'::jsonb, ${rName}, ${rEmail},
       pickup_address, dropoff_address, version, created_by,
       'tc-neg-' || gen_random_uuid()::text, 'consumer:tc-negative-fixture-scope',
       2000, 'standard', '${POL}',
       'shipment-terms-v1', now(), now(), now()
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
                 set recipient_adult_attested_at=now(),
                     recipient_attestation_version='couranr-recipient-adult-attestation-2026-09'
               where id='${A26id}'`); ok = true; }
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
      // $20.00 -> $100.00, which also moves the derived level standard ->
      // secure_pickup. Both must be writable while the statement is a draft.
      sql(`update public.couranr_delivery_requests
             set declared_value_cents=10000, protection_level='secure_pickup'
           where id='${D}'`);
      const now = sql(`select declared_value_cents||'/'||protection_level
                       from public.couranr_delivery_requests where id='${D}'`);
      ok = now === "10000/secure_pickup"; detail = now;
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
    const r = mustRefuse(`update public.couranr_delivery_requests
             set request_state='awaiting_quote_acceptance', submitted_at=now(), version=version+1
           where id='${rid}'`, "protected_handoff_identity_unavailable");
    t("D14", "a protected handoff cannot submit while identity capability is absent",
      r.ok && (r.got === "protected_handoff_identity_unavailable" ||
        r.got === "raised:protected_handoff_identity_unavailable"), r.got); }

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

  /* ── §W: the triggers sit on the ONLY paths into the guarded states ─────
     Both custody triggers fire on ONE transition each — at_pickup -> picked_up
     and at_dropoff -> delivered. That is only sufficient while those are the
     only ways to reach those states. A new command writing 'picked_up' from
     somewhere else would walk straight past the whole ceremony, and nothing
     else in this suite would notice: every check above begins by putting a
     delivery INTO at_pickup.

     A trigger was the right shape precisely because of this — it catches
     couranr_complete_pickup (v1) as well as v2, which an edit to v2 would have
     missed. This census keeps that true. It cannot prove a new writer is safe;
     it fails loudly enough that someone has to look. */
  {
    const writers = (state) => sql(
      "select coalesce(string_agg(p.proname, ',' order by p.proname), '')" +
      "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace" +
      " where n.nspname in ('public','private') and p.prokind = 'f'" +
      "   and pg_get_functiondef(p.oid) ~ 'set[^;]*fulfillment_state\\s*=\\s*''" + state + "'''"
    ).split(",").filter(Boolean);

    /* couranr_start_route_to_dropoff appears under 'picked_up' because its
       UPDATE reads that state in the WHERE clause; it WRITES in_transit. Listed
       rather than quietly excluded, so the census is honest about what it
       matches. */
    const EXPECTED = {
      picked_up: ["couranr_complete_pickup", "couranr_complete_pickup_v2",
                  "couranr_start_route_to_dropoff"],
      delivered: ["couranr_finish_delivered"],
    };
    for (const [state, expected] of Object.entries(EXPECTED)) {
      const found = writers(state).sort();
      const unexpected = found.filter((f) => !expected.includes(f));
      t("W1 " + state, "no command writes this state outside the known set",
        unexpected.length === 0,
        unexpected.length ? "NEW WRITER: " + unexpected.join(", ") : found.join(", "));
    }

    /* And the guard each known writer names. couranr_complete_pickup v1 still
       exists and is still a writer, so the custody sequence has to hold for it
       too — which it does, because the trigger is on the transition rather than
       inside v2. */
    for (const [fn, want] of [
      ["couranr_complete_pickup", "at_pickup"],
      ["couranr_complete_pickup_v2", "at_pickup"],
      ["couranr_finish_delivered", "at_dropoff"],
    ]) {
      const named = sql(
        "select (pg_get_functiondef(p.oid) ~ 'fulfillment_state\\s*(<>|=)\\s*''" + want + "''')::text" +
        "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace" +
        " where n.nspname = 'public' and p.proname = '" + fn + "' limit 1");
      t("W2 " + fn, "still gates on '" + want + "', where the trigger waits", named === "true", named);
    }
  }

  /* ── §P: who may CALL any of this ───────────────────────────────────────
     `has_function_privilege`, not grantee rows: a privilege inherited through
     PUBLIC does not appear as a row against anon, so reading
     information_schema would report these as locked while they are open.

     pg_default_acl in this project grants EXECUTE on every new function in
     `public` to anon, authenticated AND service_role, so a migration that only
     CREATES a function has published it. And `create or replace` resets grants,
     so the revoke has to live beside every definition, not once at the start. */
  {
    const priv = (fn, role) =>
      sql(`select has_function_privilege('${role}','${fn}','EXECUTE')::text`) === "true";

    const sealed = [
      "public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)",
      "public.couranr_record_delivery_seal(uuid,uuid,text,uuid)",
      "private.couranr_delivery_protection_level(uuid)",
      "private.couranr_freeze_consumer_consent_evidence()",
      "private.couranr_enforce_consumer_custody_sequence()",
      "private.couranr_derive_protection_level(integer)",
      "public.couranr_record_seal_condition(uuid,uuid,text)",
      "private.couranr_enforce_consumer_dropoff_custody()",
      "public.couranr_record_recipient_identity_verification(uuid,text,text,boolean,boolean,boolean,text)",
      "public.couranr_claim_consumer_recipient_tracking_delivery(uuid,text,integer)",
      "public.couranr_mark_recipient_tracking_notification(text,text)",
      "public.couranr_fail_recipient_tracking_notification(text,text)",
      "public.couranr_attest_recipient_adult(text,text,boolean)",
    ];
    const open = sealed.filter((f) =>
      ["public", "anon", "authenticated"].some((r) => priv(f, r)));
    t("P1", "no browser role can call anything this policy added",
      open.length === 0, open.length ? open.join(", ") : `${sealed.length} functions sealed`);

    // The server still can, or the whole flow is bricked — a revoke that locks
    // out the caller is not security, it is an outage.
    const commands = [
      "public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)",
      "public.couranr_record_delivery_seal(uuid,uuid,text,uuid)",
      "public.couranr_record_seal_condition(uuid,uuid,text)",
      "public.couranr_claim_consumer_recipient_tracking_delivery(uuid,text,integer)",
      "public.couranr_mark_recipient_tracking_notification(text,text)",
      "public.couranr_fail_recipient_tracking_notification(text,text)",
      "public.couranr_attest_recipient_adult(text,text,boolean)",
    ];
    const blocked = commands.filter((f) => !priv(f, "service_role"));
    t("P2", "and service_role still can", blocked.length === 0, blocked.join(", ") || "both");

    /* The triggers fire with their functions revoked from PUBLIC because
       EXECUTE is checked when a trigger is CREATED, not when it runs. E4 and
       A29-A32 would go red if that were wrong, so this records the reason
       rather than re-proving it. */
    t("P3", "schema USAGE on private is denied to the browser roles",
      sql(`select (has_schema_privilege('anon','private','USAGE') or
                   has_schema_privilege('authenticated','private','USAGE'))::text`) === "false",
      "anon/authenticated");
  }

  /* ── §V: EVERY enforcement point, from the LIVE catalog ─────────────────
     The generalized form of the defect this stage found. Two constraints
     policed proof_type and the migration extended one; a value must satisfy
     both, so Secure Pickup was unreachable and nothing noticed.

     A static read of the migration cannot catch the next one, because the guard
     that goes unextended is by definition the one nobody remembered was there.
     So this asks the DATABASE: for each vocabulary this policy extends, find
     EVERY check constraint that mentions the column and require all of them to
     admit the new values. A third guard added by some future migration fails
     here loudly instead of silently refusing every secure pickup. */
  {
    const guards = (col) => sql(
      `select coalesce(string_agg(conrelid::regclass || '.' || conname, ',' order by conname), '')
         from pg_constraint
        where contype='c' and pg_get_constraintdef(oid) ~ '\\m${col}\\M'
          and conrelid='public.couranr_delivery_proofs'::regclass`).split(",").filter(Boolean);

    const admits = (name, value) => sql(
      `select (pg_get_constraintdef(oid) like '%${value}%')::text
         from pg_constraint where conname='${name.split(".").pop()}'`) === "true";

    const typeGuards = guards("proof_type");
    t("V1", "more than one constraint polices proof_type, as this stage learned",
      typeGuards.length >= 2, `${typeGuards.length}: ${typeGuards.join(" + ")}`);

    for (const pt of ["item_prepack_photo", "sealed_package_photo"]) {
      const missing = typeGuards.filter((g) => !admits(g, pt));
      t(`V2 ${pt}`, "is admitted by EVERY constraint that polices the column",
        missing.length === 0, missing.length ? `not in ${missing.join(", ")}` : `all ${typeGuards.length}`);
    }

    /* The event verb has SEVEN vocabularies in this schema, one per event table.
       Only the delivery-REQUEST one should carry it — a verb appearing in the
       assignment or team vocabularies would mean the command writes somewhere it
       does not belong. */
    const verbTables = sql(
      `select coalesce(string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text), '')
         from pg_constraint
        where contype='c' and pg_get_constraintdef(oid) like '%record_consumer_trust%'`)
      .split(",").filter(Boolean);
    t("V3", "the trust verb is in the delivery-request vocabulary and no other",
      verbTables.length === 1 && verbTables[0] === "couranr_delivery_request_events",
      verbTables.join(", ") || "none");
  }

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

  /* `proofMethod` is set at SEED time, never by a later update: it is part of
     the delivery's commercial snapshot, frozen by
     delivery_commercial_snapshot_is_immutable. Trying to change it afterwards
     is refused — which is itself why a protected handoff can never acquire
     leave_at_door after the fact, and why F6 has to build one that way from
     the start to reach the rule at all. */
  const custodyChain = async (marker, cents, level, state = "at_pickup", proofMethod = undefined) => {
    const c = await seedCanonicalDeliveryChain(psqlTransport(psql), {
      businessId: biz, actorUserId: usr, marker, recipientName: "TC recipient",
      ...(proofMethod ? { proofMethod } : {}),
    });
    if (level !== null) govern(c.requestId, cents, level);
    sql(`update public.couranr_deliveries
           set fulfillment_state='${state}' where id='${c.deliveryId}'`);
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

  const succeeds = (q, f, want = "picked_up") => {
    try { const got = sql(`select fulfillment_state from public.couranr_deliveries
                           where id='${f.dlv}'`);
          sql(q);
          const after = sql(`select fulfillment_state from public.couranr_deliveries
                             where id='${f.dlv}'`);
          return { ok: after === want, got: after === want ? after : `${got} -> ${after}` }; }
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

  /* ── §S: the custody SEQUENCE, attacked out of order ─────────────────────
     §E proves every PART of the ceremony is present. Presence is not sequence,
     and a direct API caller reaching the same RPCs in a different order
     satisfied all of §E: photograph the sealed package first, upload the
     "pre-pack" photo afterwards, and both exist. A pre-pack photo taken after
     the package was sealed shows a sealed package — which is what the other
     photo is for — so the one thing that photo exists to prove was unproven.

     These build legitimate AND hostile sequences with controlled timestamps. */
  const orderedFixture = async (marker, drv) => {
    /* couranr_asg_one_active_per_driver allows a driver exactly one live
       assignment, which is the same invariant that lets
       couranr_driver_assignment_for resolve "their" delivery at all. Each
       fixture retires the previous one first. */
    sql(`update public.couranr_delivery_assignments
            set assignment_state='completed', end_reason='completed', ended_at=now()
          where driver_id='${drv.driverId}' and assignment_state='active'`);
    const f = await custodyChain(marker, 5000, "secure_pickup");
    assign(f, drv);
    return f;
  };

  const drvS = driverFor("tc-driver-s@example.test");
  /* Returns the QUERY. mustRefuse takes a string and runs it itself, so a
     helper that executed eagerly would fire the statement before the assertion
     ever saw it — which is how N1 first reported a raw psql crash instead of a
     refusal. */
  const sealQuery = (f, drv, proofId, serial) =>
    "select public.couranr_record_delivery_seal('" + f.dlv + "','" + drv.userId +
    "','" + serial + "','" + proofId + "')";
  const sealIt = (f, drv, proofId, serial) => sql(sealQuery(f, drv, proofId, serial));

  /* S1 — THE ATTACK THE OLD RULE ALLOWED. Sealed photo first, pre-pack second.
     Every part present; the order is a lie. */
  { const f = await orderedFixture("tc-seq-reversed", drvS);
    const sp = addProof(f, "sealed_package_photo", drvS, "now() - interval '9 minutes'");
    addProof(f, "item_prepack_photo", drvS, "now() - interval '4 minutes'");
    sealIt(f, drvS, sp, "SEAL-SEQ-0001");
    consumeCode(f, 1, "now()");
    const r = mustRefuse(pickUp(f), "prepack_photo_must_precede_sealing");
    t("S1", "a pre-pack photo taken AFTER sealing cannot complete the pickup",
      (r.got === "prepack_photo_must_precede_sealing" ||
       r.got === "raised:prepack_photo_must_precede_sealing"), r.got); }

  /* S2 — the legitimate sequence still completes. A rule that only refuses is a
     rule nobody has shown to be satisfiable. */
  { const f = await orderedFixture("tc-seq-correct", drvS);
    addProof(f, "item_prepack_photo", drvS, "now() - interval '9 minutes'");
    const sp = addProof(f, "sealed_package_photo", drvS, "now() - interval '7 minutes'");
    sealIt(f, drvS, sp, "SEAL-SEQ-0002");
    consumeCode(f, 1, "now()");
    const done = succeeds(pickUp(f), f, "picked_up");
    t("S2", "item, then sealed package, then seal, then credential — completes",
      done.ok, done.got); }

  /* S3 — the seal cannot predate the photograph it cites. A serial recorded
     before there is a sealed package to photograph is a serial typed early. */
  { const f = await orderedFixture("tc-seq-seal-early", drvS);
    addProof(f, "item_prepack_photo", drvS, "now() - interval '9 minutes'");
    const sp = addProof(f, "sealed_package_photo", drvS, "now() - interval '2 minutes'");
    sealIt(f, drvS, sp, "SEAL-SEQ-0003");
    // Back-date the seal to before its own photograph.
    sql("update public.couranr_delivery_security_seals set applied_at = now() - interval '6 minutes'" +
        " where delivery_id='" + f.dlv + "'");
    consumeCode(f, 1, "now()");
    const r = mustRefuse(pickUp(f), "seal_recorded_before_sealed_photo");
    t("S3", "a seal recorded BEFORE its own photograph is refused",
      (r.got === "seal_recorded_before_sealed_photo" ||
       r.got === "raised:seal_recorded_before_sealed_photo"), r.got); }

  /* S4 — THE GAP THE OLD RULE LEFT. The credential was compared against the
     photographs and never against the SEAL, so it could be taken after both
     photos and before the seal was recorded. The sender's confirmation means
     "the documented and SEALED shipment is what I am tendering". */
  { const f = await orderedFixture("tc-seq-cred-before-seal", drvS);
    addProof(f, "item_prepack_photo", drvS, "now() - interval '9 minutes'");
    const sp = addProof(f, "sealed_package_photo", drvS, "now() - interval '8 minutes'");
    consumeCode(f, 1, "now() - interval '7 minutes'");   // after photos, before seal
    sealIt(f, drvS, sp, "SEAL-SEQ-0004");                // seal recorded now
    const r = mustRefuse(pickUp(f), "pickup_credential_before_documentation");
    t("S4", "a credential taken before the SEAL was recorded is refused",
      (r.got === "pickup_credential_before_documentation" ||
       r.got === "raised:pickup_credential_before_documentation"), r.got); }

  /* S5 — several legitimate pre-pack shots are fine; the FIRST still has to
     precede the sealing. Using max() here would let a later upload repair an
     out-of-order sequence after the fact. */
  { const f = await orderedFixture("tc-seq-multi-prepack", drvS);
    addProof(f, "item_prepack_photo", drvS, "now() - interval '9 minutes'");
    addProof(f, "item_prepack_photo", drvS, "now() - interval '8 minutes'");
    const sp = addProof(f, "sealed_package_photo", drvS, "now() - interval '6 minutes'");
    sealIt(f, drvS, sp, "SEAL-SEQ-0005");
    consumeCode(f, 1, "now()");
    const done = succeeds(pickUp(f), f, "picked_up");
    t("S5", "several pre-pack shots are fine while the first precedes sealing",
      done.ok, done.got); }

  /* N — a tamper-evident seal is single-use by construction. Two custody
     records claiming one serial means one of them is false. */
  { const f = await orderedFixture("tc-seq-dup-serial", drvS);
    const sp = addProof(f, "sealed_package_photo", drvS);
    const r = mustRefuse(sealQuery(f, drvS, sp, "SEAL-SEQ-0002"),
      "couranr_dss_identifier_unique_active");
    t("N1", "a serial already used on another delivery is refused", r.ok, r.got); }

  { const f = await orderedFixture("tc-seq-dup-case", drvS);
    const sp = addProof(f, "sealed_package_photo", drvS);
    /* 'seal-seq-0002' and 'SEAL-SEQ-0002' are the same physical label. A
       case-sensitive index would wave the second one through. */
    const r = mustRefuse(sealQuery(f, drvS, sp, "seal-seq-0002"),
      "couranr_dss_identifier_unique_active");
    t("N2", "case cannot smuggle a duplicate serial past the index", r.ok, r.got); }

  /* ── §F: the custody chain CLOSES at handoff ────────────────────────────
     A tamper-evident seal nobody looks at is a sticker. Its whole value is the
     comparison between what was applied and what arrived, and until this stage
     couranr_delivery_security_seals.dropoff_condition existed with constraints
     and NO WRITER — derived, surfaced to the driver, enforcing nothing. */
  const deliver = (f) =>
    `update public.couranr_deliveries set fulfillment_state='delivered',
       version=version+1, updated_at=now() where id='${f.dlv}'`;

  /* A sealed delivery parked at at_dropoff: the pickup ceremony already done,
     the seal applied, now standing at the recipient's door. */
  let serialSeq = 0;
  const uniqueSerial = () => `TC${String(++serialSeq).padStart(5, "0")}`;

  const sealedAtDropoff = async (marker, level, drv, proofMethod = null) => {
    const f = await custodyChain(marker, level === "protected_handoff" ? 20000 : 5000,
      level, "at_pickup", proofMethod);
    assign(f, drv);
    const sp = addProof(f, "sealed_package_photo", drv);
    /* A DISTINCT serial per fixture. The first version used the marker's last six
       characters, so 'tc-id-verified' and any other marker ending the same way
       produced one serial — and the new uniqueness index refused the second,
       which is the index doing exactly its job on my own fixtures. A physical
       seal is single-use; test fixtures have to respect that too. */
    sql(`select public.couranr_record_delivery_seal('${f.dlv}','${drv.userId}','SEAL-${uniqueSerial()}','${sp}')`);
    sql(`update public.couranr_deliveries set fulfillment_state='at_dropoff' where id='${f.dlv}'`);
    return f;
  };

  const drvD = driverFor("tc-driver-d@example.test");
  const drvE = driverFor("tc-driver-e@example.test");
  const condition = (f, drv, c) =>
    `select public.couranr_record_seal_condition('${f.dlv}','${drv.userId}','${c}')`;

  { const f = await sealedAtDropoff("tc-dropoff-unchecked", "secure_pickup", drvD);
    const r = mustRefuse(deliver(f), "seal_condition_required_at_dropoff");
    t("F1", "a sealed delivery cannot be DELIVERED without the seal being looked at",
      (r.got === "seal_condition_required_at_dropoff" ||
       r.got === "raised:seal_condition_required_at_dropoff"), r.got);

    sql(condition(f, drvD, "intact"));
    const done = succeeds(deliver(f), f, "delivered");
    t("F2", "...and completes once the driver records what they saw", done.ok, done.got); }

  /* HONESTY MUST BE THE CHEAP ANSWER. If a broken seal blocked completion, the
     one person holding the parcel would have every reason to report it intact.
     Both of these must complete. */
  for (const [id, cond] of [["F3", "damaged"], ["F4", "missing"]]) {
    sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvD.driverId}'`);
    const f = await sealedAtDropoff(`tc-dropoff-${cond}`, "secure_pickup", drvD);
    sql(condition(f, drvD, cond));
    const done = succeeds(deliver(f), f, "delivered");
    t(id, `a '${cond}' seal still completes the delivery — the record is the product`,
      done.ok, done.got);
  }

  { sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvD.driverId}'`);
    const f = await sealedAtDropoff("tc-dropoff-revise", "secure_pickup", drvD);
    sql(condition(f, drvD, "damaged"));
    /* A driver who could revise the condition could record 'damaged' at the
       door, watch the reaction, and change it to 'intact'. One observation. */
    const r = mustRefuse(condition(f, drvD, "intact"), "seal_condition_already_recorded");
    t("F5", "the recorded condition cannot be revised after the reaction",
      (r.got === "seal_condition_already_recorded" ||
       r.got === "raised:seal_condition_already_recorded"), r.got); }

  { sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvD.driverId}'`);
    const f = await sealedAtDropoff("tc-dropoff-door", "protected_handoff", drvD, "leave_at_door");
    sql(condition(f, drvD, "intact"));
    const r = mustRefuse(deliver(f), "protected_handoff_forbids_leave_at_door");
    t("F6", "a PROTECTED HANDOFF can never be left at a door",
      (r.got === "protected_handoff_forbids_leave_at_door" ||
       r.got === "raised:protected_handoff_forbids_leave_at_door"), r.got); }

  // The rule must reach only governed secure deliveries.
  { const f = await custodyChain("tc-dropoff-ungoverned", null, null, "at_dropoff");
    const done = succeeds(deliver(f), f, "delivered");
    t("F7", "an UNGOVERNED delivery still completes untouched", done.ok, done.got); }

  { const f = await custodyChain("tc-dropoff-standard", 3000, "standard", "at_dropoff");
    const done = succeeds(deliver(f), f, "delivered");
    t("F8", "a $30.00 STANDARD delivery still completes untouched", done.ok, done.got); }

  { sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvE.driverId}'`);
    const f = await custodyChain("tc-dropoff-nostandard", 3000, "standard", "at_dropoff");
    assign(f, drvE);
    const r = mustRefuse(condition(f, drvE, "intact"), "seal_not_required_for_delivery");
    t("F9", "a seal condition on a STANDARD delivery is refused, not stored",
      (r.got === "seal_not_required_for_delivery" ||
       r.got === "raised:seal_not_required_for_delivery"), r.got); }

  { sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvD.driverId}'`);
    const f = await sealedAtDropoff("tc-dropoff-stranger", "secure_pickup", drvD);
    const r = mustRefuse(condition(f, drvE, "intact"), "not_your_delivery");
    t("F10", "a driver who does not hold the assignment cannot record the seal",
      (r.got === "not_your_delivery" || r.got === "raised:not_your_delivery"), r.got); }

  { sql(`update public.couranr_delivery_assignments set assignment_state='completed',
           end_reason='completed', ended_at=now() where driver_id='${drvE.driverId}'`);
    const f = await custodyChain("tc-dropoff-noseal", 5000, "secure_pickup", "at_dropoff");
    assign(f, drvE);
    const r = mustRefuse(condition(f, drvE, "intact"), "security_seal_required");
    t("F11", "a condition cannot be recorded when no seal was ever applied",
      (r.got === "security_seal_required" || r.got === "raised:security_seal_required"), r.got); }

  /* ── §G: RECIPIENT IDENTITY, and the fact that it is not active ─────────
     Stripe Identity is not activated in V1 by the owner's instruction. The
     point of these checks is that the ABSENCE is recorded as a fact rather than
     left as a gap someone later reads as "it must have been fine": a protected
     handoff that proceeded on the recipient code alone and one that passed an
     identity check are different things, and a claim six months later has to be
     able to tell them apart. */
  const identity = (f, state, opts = {}) =>
    "select public.couranr_record_recipient_identity_verification('" + f.dlv + "','" + state + "'," +
    (opts.ref ? "'" + opts.ref + "'" : "null") + "," +
    (opts.verified ? "true" : "false") + "," +
    (opts.adult ? "true" : "false") + "," +
    (opts.match ? "true" : "false") + ",'" + POL + "')";

  const drvG = driverFor("tc-driver-g@example.test");
  const endAssignments = (drv) => sql(
    "update public.couranr_delivery_assignments set assignment_state='completed'," +
    " end_reason='completed', ended_at=now() where driver_id='" + drv.driverId + "'" +
    "   and assignment_state='active'");

  const protectedAtDropoff = async (marker) => {
    endAssignments(drvG);
    const f = await sealedAtDropoff(marker, "protected_handoff", drvG);
    sql(condition(f, drvG, "intact"));
    return f;
  };

  { const f = await protectedAtDropoff("tc-id-none");
    const r = mustRefuse(deliver(f), "recipient_identity_verification_required");
    t("G1", "a protected handoff cannot complete with NO identity verification",
      (r.got === "recipient_identity_verification_required" ||
       r.got === "raised:recipient_identity_verification_required"), r.got); }

  /* `unavailable` is durable evidence that no check completed. It is never a
     substitute for the verified outcome the sender was promised. */
  { const f = await protectedAtDropoff("tc-id-unavailable");
    sql(identity(f, "unavailable"));
    const r = mustRefuse(deliver(f), "recipient_identity_not_verified");
    t("G2", "'unavailable' is recorded but never authorizes handoff",
      r.got === "recipient_identity_not_verified" ||
      r.got === "raised:recipient_identity_not_verified", r.got); }

  for (const [id, state] of [["G3", "pending"], ["G4", "processing"]]) {
    const f = await protectedAtDropoff("tc-id-" + state);
    sql(identity(f, state, { ref: "vs_test_" + state }));
    const r = mustRefuse(deliver(f), "recipient_identity_not_verified");
    t(id, "a '" + state + "' verification is not an outcome and blocks the handoff",
      (r.got === "recipient_identity_not_verified" ||
       r.got === "raised:recipient_identity_not_verified"), r.got);
  }

  { const f = await protectedAtDropoff("tc-id-verified");
    sql(identity(f, "verified", { ref: "vs_test_ok", verified: true, adult: true, match: true }));
    const done = succeeds(deliver(f), f, "delivered");
    t("G5", "'verified' completes, and stamps the moment it was verified", done.ok, done.got); }

  /* 'failed' is an OUTCOME and it is a no. Handing a protected shipment to
     someone who just failed an identity check defeats the only thing the level
     exists for. Not a stranded parcel: could_not_deliver and the returns flow
     are the path and they already exist. */
  { const f = await protectedAtDropoff("tc-id-failed");
    sql(identity(f, "failed", { ref: "vs_test_failed" }));
    const r = mustRefuse(deliver(f), "recipient_identity_not_verified");
    t("G6", "a FAILED identity check stops the handoff rather than completing it",
      (r.got === "recipient_identity_not_verified" ||
       r.got === "raised:recipient_identity_not_verified"), r.got); }

  { const f = await protectedAtDropoff("tc-id-resolved");
    sql(identity(f, "failed", { ref: "vs_test_resolved" }));
    /* A resolved outcome cannot be re-run to a different one. Otherwise a
       failed check could be retried until it passed, which is not verification
       — it is retrying until the answer is convenient. */
    const r = mustRefuse(identity(f, "verified", {
      ref: "vs_test_resolved", verified: true, adult: true, match: true,
    }),
      "identity_verification_already_resolved");
    t("G7", "a resolved verification cannot be re-run to a different answer",
      (r.got === "identity_verification_already_resolved" ||
       r.got === "raised:identity_verification_already_resolved"), r.got);

    // Re-recording the SAME state stays idempotent, so a webhook retry is safe.
    let ok = false, detail = "";
    try { sql(identity(f, "failed", { ref: "vs_test_resolved" })); ok = true; }
    catch (e) { detail = String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 80); }
    t("G8", "...but re-recording the same outcome is idempotent", ok, detail); }

  { /* An identity record on a delivery that never required one would sit in the
       evidence bundle implying a check the sender never consented to. */
    endAssignments(drvG);
    const f = await sealedAtDropoff("tc-id-secure-only", "secure_pickup", drvG);
    const r = mustRefuse(identity(f, "verified", { verified: true, adult: true, match: true }),
      "identity_verification_not_required");
    t("G9", "a SECURE PICKUP delivery cannot carry an identity record at all",
      (r.got === "identity_verification_not_required" ||
       r.got === "raised:identity_verification_not_required"), r.got); }

  { const f = await protectedAtDropoff("tc-id-canceled");
    sql(identity(f, "canceled"));
    /* couranr_riv_one_live_per_delivery_uniq excludes canceled rows, so a
       canceled session leaves the delivery with NO live verification. Reading
       "the latest row" instead of "the live row" would treat an abandoned
       attempt as the answer. */
    const r = mustRefuse(deliver(f), "recipient_identity_verification_required");
    t("G10", "a CANCELED session leaves no live verification, and blocks",
      (r.got === "recipient_identity_verification_required" ||
       r.got === "raised:recipient_identity_verification_required"), r.got); }

  { const f = await protectedAtDropoff("tc-id-false-verified");
    const r = mustRefuse(identity(f, "verified", { ref: "vs_false" }),
      "verified_identity_evidence_incomplete");
    t("G11", "a verified label with false evidence is refused",
      r.got === "verified_identity_evidence_incomplete" ||
      r.got === "raised:verified_identity_evidence_incomplete", r.got); }

  { const f = await protectedAtDropoff("tc-id-rewrite");
    sql(identity(f, "failed", { ref: "vs_rewrite" }));
    const r = mustRefuse(identity(f, "failed", {
      ref: "vs_rewrite", verified: true, adult: true, match: false,
    }), "identity_verification_already_resolved");
    t("G12", "same-state replay cannot rewrite terminal evidence",
      r.got === "identity_verification_already_resolved" ||
      r.got === "raised:identity_verification_already_resolved", r.got); }

  /* ── §H: RECIPIENT-HELD LINK + VERSIONED ADULT ATTESTATION ────────────
     Protected handoff cannot be sold while the provider seam is absent. To
     execute the downstream command a future activation unlocks, this
     disposable-only fixture disables the availability trigger only for the
     INSERT of a synthetic already-confirmed request, then restores it before
     any command is called. No production/runtime path has this bypass. */
  const makeProtectedRecipientRequest = (scope) => {
    sql(`alter table public.couranr_delivery_requests
           disable trigger couranr_dr_block_unavailable_protected_handoff`);
    try {
      return sql(`insert into public.couranr_delivery_requests
          (business_account_id,requester_kind,source,request_state,submitted_at,
           consumer_contact_snapshot,recipient_name,recipient_email,
           pickup_address,dropoff_address,version,created_by,
           idempotency_key,idempotency_scope,
           declared_value_cents,protection_level,protection_policy_version,
           sender_terms_version,sender_terms_accepted_at,
           sender_electronic_consent_at,sender_adult_attested_at)
        select null::uuid,'consumer','consumer_send','confirmed',now(),
           '{"email":"sender@example.test","name":"Sender"}'::jsonb,
           'Recipient','recipient@example.test',pickup_address,dropoff_address,
           1,null::uuid,'${scope}-key','consumer:${scope}',
           20000,'protected_handoff','${POL}',
           'couranr-consumer-shipment-terms-2026-09',now(),now(),now()
        from public.couranr_delivery_requests where id='${R}' returning id`);
    } finally {
      sql(`alter table public.couranr_delivery_requests
             enable trigger couranr_dr_block_unavailable_protected_handoff`);
    }
  };
  const claimRecipient = (rid, hash) =>
    `select outcome from public.couranr_claim_consumer_recipient_tracking_delivery(
      '${rid}',repeat('${hash}',64),30)`;
  const attestRecipient = (hash, version="couranr-recipient-adult-attestation-2026-09") =>
    `select public.couranr_attest_recipient_adult(repeat('${hash}',64),'${version}',true)`;

  { const rid = makeProtectedRecipientRequest("tc-recipient-attest");
    const first = sql(claimRecipient(rid,"a"));
    const concurrent = sql(claimRecipient(rid,"b"));
    t("H1", "the database serializes one recipient notification claim",
      first === "issued" && concurrent === "in_progress", `${first}/${concurrent}`);

    const wrong = mustRefuse(attestRecipient("c"), "tracking_token_not_available");
    t("H2", "an unknown recipient token cannot attest",
      wrong.got === "tracking_token_not_available" ||
      wrong.got === "raised:tracking_token_not_available", wrong.got);

    sql(`select public.couranr_mark_recipient_tracking_notification(
      repeat('a',64),'resend_test_receipt')`);
    t("H3", "a provider receipt closes the claim and retry reports sent",
      sql(claimRecipient(rid,"d")) === "sent");

    sql(attestRecipient("a"));
    const evidence = sql(`select recipient_attestation_version||'/'||
        (recipient_adult_attested_at is not null)::text||'/'||version
      from public.couranr_delivery_requests where id='${rid}'`);
    t("H4", "the active recipient credential records versioned evidence and advances CAS",
      evidence === "couranr-recipient-adult-attestation-2026-09/true/2", evidence);

    const event = sql(`select command||'/'||(metadata->>'attestationVersion')
      from public.couranr_delivery_request_events
      where request_id='${rid}' and command='record_recipient_adult_attestation'`);
    t("H5", "recipient attestation leaves a versioned audit event",
      event === "record_recipient_adult_attestation/couranr-recipient-adult-attestation-2026-09", event);

    const mismatch = mustRefuse(attestRecipient("a","different-version"),
      "recipient_attestation_already_recorded");
    t("H6", "a retry cannot rewrite the accepted statement version",
      mismatch.got === "recipient_attestation_already_recorded" ||
      mismatch.got === "raised:recipient_attestation_already_recorded", mismatch.got);

    const stored = sql(`select count(*) from public.couranr_delivery_access_tokens
      where request_id='${rid}' and token_hash=repeat('a',64) and audience='recipient'`);
    t("H7", "only the token digest is stored under recipient audience", stored === "1", stored); }

  { const rid = makeProtectedRecipientRequest("tc-recipient-failed-mail");
    sql(claimRecipient(rid,"e"));
    const failed = sql(`select public.couranr_fail_recipient_tracking_notification(
      repeat('e',64),'provider_send_failed')`);
    const revoked = sql(`select (revoked_at is not null)::text||'/'||revoked_reason
      from public.couranr_delivery_access_tokens where token_hash=repeat('e',64)`);
    const replacement = sql(claimRecipient(rid,"f"));
    t("H8", "a failed email revokes exactly its token and permits a fresh claim",
      failed === "t" && revoked === "true/provider_send_failed" && replacement === "issued",
      `${failed}/${revoked}/${replacement}`); }

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
