/**
 * Executed adversarial probe for the recipient drop-off credential (closure B).
 *
 * A SEPARATE FILE, not a section of consumerTrustCustody.mjs, because another
 * worker holds that file in this batch. It stands up its own cluster on its own
 * port for the same reason.
 *
 *   export COURANR_PGBIN=/opt/homebrew/opt/postgresql@17/bin
 *   export COURANR_DISPOSABLE_DIR=/tmp/pgdisp-b
 *   export COURANR_DISPOSABLE_PORT=55433
 *   node e2e/disposable/recipientCredential.mjs
 *
 * What it is here to catch is the class of defect that only exists at execution
 * time: a CHECK that rejects the row the migration exists to allow, a trigger
 * body that references a column by the wrong name, an overload the planner
 * resolves to the OLD function. None of those are visible to a text assertion.
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
    const other = /constraint "([a-z_]+)"/.exec(s);
    if (other) return `refused-by:${other[1]}`;
    const raised = /ERROR:\s+([a-z][a-z0-9_]{4,})\s*$/m.exec(s);
    if (raised && raised[1].includes("_")) return `raised:${raised[1]}`;
    return `other:${s.replace(/\s+/g," ").slice(0,110)}`; }
};
const mustRefuse = (q, expected) => {
  const got = refuses(q, expected);
  return { ok: got !== "ACCEPTED" && !got.startsWith("other:"), got };
};
const D64 = (c) => `repeat('${c}',64)`;

try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);

  const POL = "couranr-consumer-protection-v1-2026-09-14";
  const biz = sql(`insert into public.business_accounts (name,status) values ('B probe','active') returning id`);
  const usr = sql(`insert into auth.users (email) values ('bprobe@example.test') returning id`);

  /* The canonical chain builds a real request AND a real delivery, satisfying
     every NOT NULL the deliveries table carries. Hand-rolling that insert is
     how the first draft of this probe died — twenty columns of fixture is the
     schema telling you what the command actually requires. */
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: biz, actorUserId: usr, marker: "b-probe", recipientName: "B recipient",
  });

  /* A CONSUMER request cannot be made by converting a business one:
     private.couranr_derive_requester_scope() raises `requester_identity_is_immutable`
     on any such update. That refusal is the product working — requester identity
     is frozen at creation — so the consumer row is inserted natively, copying
     only the addresses from the chain. */
  const consumerRequest = (marker) => sql(`insert into public.couranr_delivery_requests
      (business_account_id,requester_kind,source,request_state,submitted_at,
       consumer_contact_snapshot,recipient_name,recipient_email,
       pickup_address,dropoff_address,created_by,
       idempotency_key,idempotency_scope,
       declared_value_cents,protection_level,protection_policy_version,
       sender_terms_version,sender_terms_accepted_at,
       sender_electronic_consent_at,sender_adult_attested_at)
    select null::uuid,'consumer','consumer_send','confirmed',now(),
       '{"email":"sender@example.test","name":"Sender"}'::jsonb,
       'Recipient','recipient@example.test',pickup_address,dropoff_address,
       null::uuid,'${marker}-key','consumer:b-probe-${marker}-recipient-credential',
       5000,'secure_pickup','${POL}',
       'couranr-consumer-shipment-terms-2026-09',now(),now(),now()
    from public.couranr_delivery_requests where id='${chain.requestId}' returning id`);

  /* And the delivery is cloned off the canonical one, which is what satisfies
     the twenty NOT NULL columns without guessing at any of them. */
  /* Clone the whole commercial chain onto the new request rather than pointing
     the delivery at the old one. couranr_dlv_quote_invariant_trg requires the
     quote, obligation and service plan to be bound to the SAME request, and
     couranr_dlv_quote_request_fk is a COMPOSITE key — so a borrowed quote id
     fails twice over. Cloning keeps every trigger and constraint armed, which
     an earlier draft of this probe achieved by disabling the trigger instead.
     Disabling would have been the easier fixture and a worse proof.

     `jsonb_populate_record` copies the row without naming its columns, so this
     does not silently go stale when a column is added to any of these tables. */
  const clone = (table, id, overrides) => sql(
    `insert into public.${table}
     select (jsonb_populate_record(null::public.${table},
       to_jsonb(r) || '${JSON.stringify(overrides)}'::jsonb
       || jsonb_build_object('id', gen_random_uuid()))).*
     from public.${table} r where r.id='${id}' returning id`);

  /* FOUR QUOTE-INVARIANT TRIGGERS ARE OFF FOR FIXTURE CONSTRUCTION ONLY, and this is stated
     rather than buried: couranr_dr_quote_projection_trg refuses any write to
     current_quote_version_id outside a named quote command, and the _po_, _sp_
     and _dlv_ invariant triggers each re-check that the obligation, plan and
     delivery still match the quote. All four are correct and none is what this
     probe tests — the credential
     command reads no quote, no obligation and no plan. They are re-armed before
     a single assertion runs, so everything under test below executes with every
     trigger and constraint live. Any future assertion that DOES concern quotes
     must not be written inside this helper. */
  const withoutQuoteGuards = (fn) => {
    sql(`alter table public.couranr_delivery_requests disable trigger couranr_dr_quote_projection_trg`);
    sql(`alter table public.couranr_deliveries disable trigger couranr_dlv_quote_invariant_trg`);
    sql(`alter table public.couranr_payment_obligations disable trigger couranr_po_quote_invariant_trg`);
    sql(`alter table public.couranr_service_plans disable trigger couranr_sp_quote_invariant_trg`);
    try { return fn(); }
    finally {
      sql(`alter table public.couranr_service_plans enable trigger couranr_sp_quote_invariant_trg`);
      sql(`alter table public.couranr_payment_obligations enable trigger couranr_po_quote_invariant_trg`);
      sql(`alter table public.couranr_deliveries enable trigger couranr_dlv_quote_invariant_trg`);
      sql(`alter table public.couranr_delivery_requests enable trigger couranr_dr_quote_projection_trg`);
    }
  };

  const consumerDelivery = (rid) => withoutQuoteGuards(() => {
    const q = sql(`select current_quote_version_id from public.couranr_delivery_requests
                    where id='${chain.requestId}'`);
    const o = sql(`select id from public.couranr_payment_obligations
                    where request_id='${chain.requestId}' limit 1`);
    const p = sql(`select id from public.couranr_service_plans
                    where request_id='${chain.requestId}' limit 1`);
    const newQuote = clone("couranr_quote_versions", q, { request_id: rid });
    /* couranr_dr_quote_identity_completeness_chk: a request holding a quote id
       may not still say 'not_quoted'. The whole pricing projection is copied
       from the chain request so the row is internally coherent rather than
       merely constraint-passing. */
    sql(`update public.couranr_delivery_requests t set
            current_quote_version_id='${newQuote}',
            quote_status=c.quote_status,
            pricing_policy_version=c.pricing_policy_version,
            delivery_subtotal_cents=c.delivery_subtotal_cents,
            payment_due_cents=c.payment_due_cents,
            quote_line_items=c.quote_line_items,
            loaded_miles=c.loaded_miles,
            included_loaded_miles=c.included_loaded_miles,
            billable_loaded_miles=c.billable_loaded_miles,
            rounding_applied=c.rounding_applied,
            tax_included=c.tax_included
          from public.couranr_delivery_requests c
          where t.id='${rid}' and c.id='${chain.requestId}'`);
    /* The provider intent id is globally unique — a cloned obligation must mint
       its own, or the fixture collides with the row it copied. */
    const newObligation = clone("couranr_payment_obligations", o,
      { request_id: rid, quote_version_id: newQuote,
        provider_payment_intent_id: `pi_bprobe_${rid.slice(0, 12)}` });
    const newPlan = clone("couranr_service_plans", p,
      { request_id: rid, quote_version_id: newQuote });
    return clone("couranr_deliveries", chain.deliveryId, {
      request_id: rid, business_account_id: null, quote_version_id: newQuote,
      payment_obligation_id: newObligation, service_plan_id: newPlan,
      fulfillment_state: "assigned",
    });
  });

  const seed = consumerRequest("one");
  const dlv = consumerDelivery(seed);

  /* The recipient's tracking token, under the audience the command requires. */
  sql(`insert into public.couranr_delivery_access_tokens
        (request_id,business_account_id,token_hash,audience,expires_at)
       values ('${seed}',null,${D64("a")},'recipient',now()+interval '7 days')`);

  const issue = (hash, gen, digest, ttl = 720) =>
    `select generation from public.couranr_issue_recipient_dropoff_code(
       ${D64(hash)},${gen},${D64(digest)},${ttl})`;

  /* --- the constraint that made this impossible, proved to now allow it ---- */

  const first = sql(issue("a", 1, "1"));
  t("B1", "a recipient tracking token can mint a drop-off PIN at all",
    first === "1", first);

  const attributed = sql(`select (issued_by is null)::text||'/'||
      (issued_by_guest_session_id is null)::text||'/'||
      (issued_by_access_token_id is not null)::text
    from public.couranr_handoff_codes
    where delivery_id='${dlv}' and code_kind='recipient_dropoff' and generation=1`);
  t("B2", "it is attributed to the token, and to neither other issuer",
    attributed === "true/true/true", attributed);

  /* NEGATIVE CONTROL for B1/B2: the three-armed rule must still refuse a row
     with no issuer and a row with two. Without these, a constraint that had
     been dropped and never replaced would score as a pass. */
  const none = mustRefuse(`insert into public.couranr_handoff_codes
      (delivery_id,code_kind,generation,code_digest,code_state,issued_at,expires_at,superseded_at)
     values ('${dlv}','recipient_dropoff',900,${D64("9")},'superseded',
       now(),now()+interval '1 hour',now())`, "couranr_hc_issuer_xor_chk");
  t("B3", "a credential with NO issuer is still refused",
    none.got.includes("couranr_hc_issuer_xor_chk"), none.got);

  const tokId = sql(`select id from public.couranr_delivery_access_tokens
     where token_hash=${D64("a")}`);
  const two = mustRefuse(`insert into public.couranr_handoff_codes
      (delivery_id,code_kind,generation,code_digest,code_state,issued_by,
       issued_by_access_token_id,issued_at,expires_at,superseded_at)
     values ('${dlv}','recipient_dropoff',901,${D64("8")},'superseded','${usr}',
       '${tokId}',now(),now()+interval '1 hour',now())`, "couranr_hc_issuer_xor_chk");
  t("B4", "a credential with TWO issuers is refused",
    two.got.includes("couranr_hc_issuer_xor_chk"), two.got);

  /* The recipient must never be able to mint the SENDER's credential. */
  const wrongKind = mustRefuse(`insert into public.couranr_handoff_codes
      (delivery_id,code_kind,generation,code_digest,code_state,
       issued_by_access_token_id,issued_at,expires_at,superseded_at)
     values ('${dlv}','merchant_pickup',902,${D64("7")},'superseded',
       '${tokId}',now(),now()+interval '1 hour',now())`, "couranr_hc_token_issuer_kind_chk");
  /* An earlier run of this probe scored B5 as a FAILURE because the fixture row
     said code_state='superseded' with no superseded_at, so couranr_hc_superseded_stamp_chk
     fired first and the rule under test was never reached. Asserting on which
     of several errors comes back, from an incomplete row, is precisely how the
     two-proof_type-constraints defect survived review. The row is complete now. */
  t("B5", "a tracking token cannot attribute a merchant_pickup credential",
    wrongKind.got.includes("couranr_hc_token_issuer_kind_chk"), wrongKind.got);

  /* ------------------------------------------------ generation and CAS ---- */

  sql(`update public.couranr_handoff_codes set issued_at=now()-interval '5 minutes'
       where delivery_id='${dlv}' and code_kind='recipient_dropoff'`);
  const stale = mustRefuse(issue("a", 1, "2"), "handoff_generation_conflict");
  t("B6", "a stale expected generation is refused, never silently renumbered",
    stale.got === "raised:handoff_generation_conflict" ||
    stale.got === "handoff_generation_conflict", stale.got);

  const second = sql(issue("a", 2, "2"));
  const states = sql(`select string_agg(generation||':'||code_state,',' order by generation)
    from public.couranr_handoff_codes where delivery_id='${dlv}' and code_kind='recipient_dropoff'`);
  t("B7", "re-issuing supersedes the previous credential rather than leaving two live",
    second === "2" && states === "1:superseded,2:active", `${second}/${states}`);

  const soon = mustRefuse(issue("a", 3, "3"), "recipient_code_reissued_too_soon");
  t("B8", "a re-mint inside the cooldown is rate-limited, not served",
    soon.got === "raised:recipient_code_reissued_too_soon" ||
    soon.got === "recipient_code_reissued_too_soon", soon.got);

  /* ------------------------------------------------------ authorization -- */

  const unknown = mustRefuse(issue("z", 3, "4"), "tracking_token_not_available");
  t("B9", "an unknown token mints nothing",
    unknown.got === "raised:tracking_token_not_available" ||
    unknown.got === "tracking_token_not_available", unknown.got);

  /* The command checks `audience='recipient'`. It turns out the TABLE pins it
     harder than the command does — couranr_dat_audience_chk admits that one
     value and nothing else — so a sender-audience token cannot be created to
     test with. The stronger guarantee is asserted directly rather than faked. */
  const audienceRule = mustRefuse(`insert into public.couranr_delivery_access_tokens
        (request_id,business_account_id,token_hash,audience,expires_at)
       values ('${seed}',null,${D64("b")},'sender',now()+interval '7 days')`,
    "couranr_dat_audience_chk");
  t("B10", "no token of any other audience can exist to mint with",
    audienceRule.got.includes("couranr_dat_audience_chk"), audienceRule.got);

  sql(`insert into public.couranr_delivery_access_tokens
        (request_id,business_account_id,token_hash,audience,expires_at,revoked_at,revoked_reason)
       values ('${seed}',null,${D64("c")},'recipient',now()+interval '7 days',now(),'probe_revoked')`);
  const revoked = mustRefuse(issue("c", 3, "4"), "tracking_token_not_available");
  t("B11", "a REVOKED recipient token mints nothing",
    revoked.got === "raised:tracking_token_not_available" ||
    revoked.got === "tracking_token_not_available", revoked.got);

  /* couranr_dat_expiry_chk forbids minting a token that is already expired, so
     expiry is reached by ageing a live one rather than by inserting a dead one. */
  sql(`insert into public.couranr_delivery_access_tokens
        (request_id,business_account_id,token_hash,audience,expires_at)
       values ('${seed}',null,${D64("d")},'recipient',now()+interval '7 days')`);
  sql(`update public.couranr_delivery_access_tokens
          set created_at=now()-interval '30 days', expires_at=now()-interval '1 day'
        where token_hash=${D64("d")}`);
  const expired = mustRefuse(issue("d", 3, "4"), "tracking_token_not_available");
  t("B12", "an EXPIRED recipient token mints nothing",
    expired.got === "raised:tracking_token_not_available" ||
    expired.got === "tracking_token_not_available", expired.got);

  const badDigest = mustRefuse(
    `select public.couranr_issue_recipient_dropoff_code(${D64("a")},3,'123456',720)`,
    "recipient_code_digest_required");
  t("B13", "a RAW six-digit PIN can never be passed where a digest belongs",
    badDigest.got === "raised:recipient_code_digest_required" ||
    badDigest.got === "recipient_code_digest_required", badDigest.got);

  /* ------------------------------------------------------------ lifecycle - */

  sql(`update public.couranr_handoff_codes set issued_at=now()-interval '5 minutes'
       where delivery_id='${dlv}' and code_kind='recipient_dropoff'`);
  /* couranr_dlv_quote_invariant_trg re-runs its whole match on EVERY update, not
     only on the columns it declares immutable, so advancing the cloned fixture's
     state needs the same guard window its creation did. */
  withoutQuoteGuards(() =>
    sql(`update public.couranr_deliveries set fulfillment_state='delivered' where id='${dlv}'`));
  const late = mustRefuse(issue("a", 3, "5"), "recipient_code_too_late");
  t("B14", "a settled delivery mints nothing",
    late.got === "raised:recipient_code_too_late" ||
    late.got === "recipient_code_too_late", late.got);
  withoutQuoteGuards(() =>
    sql(`update public.couranr_deliveries set fulfillment_state='assigned' where id='${dlv}'`));

  /* A consumer request left UNGOVERNED and in draft. */
  const draft = sql(`insert into public.couranr_delivery_requests
      (business_account_id,requester_kind,source,request_state,
       consumer_contact_snapshot,recipient_name,recipient_email,
       pickup_address,dropoff_address,idempotency_key,idempotency_scope)
    select null::uuid,'consumer','consumer_send','draft',
       '{"email":"s2@example.test","name":"S2"}'::jsonb,'R2','r2@example.test',
       pickup_address,dropoff_address,'b-probe-draft','consumer:b-probe-draft-ungoverned-request'
    from public.couranr_delivery_requests where id='${chain.requestId}' returning id`);
  consumerDelivery(draft);
  sql(`insert into public.couranr_delivery_access_tokens
        (request_id,business_account_id,token_hash,audience,expires_at)
       values ('${draft}',null,${D64("f")},'recipient',now()+interval '7 days')`);
  const ungoverned = mustRefuse(issue("f", 1, "6"), "recipient_code_not_allowed");
  t("B15", "an UNGOVERNED, unconfirmed request mints nothing",
    ungoverned.got === "raised:recipient_code_not_allowed" ||
    ungoverned.got === "recipient_code_not_allowed", ungoverned.got);

  /* --------------------------------------------------------- the record -- */

  const ev = sql(`select command||'/'||coalesce(metadata->>'generation','-')
    from public.couranr_delivery_request_events
    where request_id='${seed}' and command='issue_recipient_dropoff_code'
    order by created_at limit 1`);
  t("B16", "issuance leaves an audit event the command vocabulary admits",
    ev === "issue_recipient_dropoff_code/1", ev);

  const leak = sql(`select count(*) from public.couranr_delivery_request_events
    where request_id='${seed}' and command='issue_recipient_dropoff_code'
      and (metadata::text ilike '%digest%' or metadata::text ~ '[0-9a-f]{64}')`);
  t("B17", "the audit event carries neither the PIN nor its digest", leak === "0", leak);

  const used = sql(`select (last_used_at is not null)::text
    from public.couranr_delivery_access_tokens where token_hash=${D64("a")}`);
  t("B18", "minting stamps the token it was minted from", used === "true", used);

  /* ------------------------------------------------------------- sealed -- */

  const grants = sql(`select
      has_function_privilege('anon','public.couranr_issue_recipient_dropoff_code(text,integer,text,integer)','execute')::text
    ||'/'|| has_function_privilege('authenticated','public.couranr_issue_recipient_dropoff_code(text,integer,text,integer)','execute')::text
    ||'/'|| has_function_privilege('service_role','public.couranr_issue_recipient_dropoff_code(text,integer,text,integer)','execute')::text`);
  t("B19", "no browser role may call it; service_role may",
    grants === "false/false/true", grants);

  /* An overload would let an old 3-argument call resolve to a function that no
     longer exists — or worse, to a different one. There must be exactly one. */
  const overloads = sql(`select count(*) from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='couranr_issue_recipient_dropoff_code'`);
  t("B20", "exactly one function of this name exists", overloads === "1", overloads);

} catch (e) {
  console.error("\n  SUITE ERROR:", String(e.stderr || e.message).slice(0, 900));
  fail += 1;
} finally {
  down({ quiet: true });
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
