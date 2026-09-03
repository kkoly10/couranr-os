/**
 * P5-001 Smart Intake V0 — DATABASE EXECUTION.
 *
 * The §32 adversarial matrix at the durable layer: the stale race an
 * out-of-order provider completion loses, the idempotent begin that a double
 * click converges on, the confirmed fact a rerun cannot overwrite, the junk
 * key with nowhere to land, cross-tenant refusals, append-only-by-grant, and
 * the commit wrapper that refuses to mint a quote from facts the merchant has
 * since changed. Every one is CALLED with real rows.
 */
import { up, psql } from "./up.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const one = (q) => psql(q).trim();
const raw = (q) => psql(q);
const check = (id, d, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${ok ? "" : `  [got ${got}, want ${want}]`}`);
};
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _p(code text, msg text);
     do $probe$ begin ${stmt} insert into _p values ('NO_ERROR','');
     exception when others then insert into _p values (SQLSTATE, SQLERRM); end $probe$;
     select code || '|' || msg from _p;`
  ).trim();
}

const BIZ_A = "aaaaaaa1-1111-4111-8111-111111111111";
const BIZ_B = "bbbbbbb2-2222-4222-8222-222222222222";
const USER_A = "aaaaaaa3-3333-4333-8333-333333333333";
const USER_B = "bbbbbbb4-4444-4444-8444-444444444444";
const POLICY = "couranr-pricing-v2-2026-09-01";

const addr = (pid, line1) =>
  `jsonb_build_object('googlePlaceId','${pid}','formattedAddress','${line1}, Stafford, VA 22554, USA',
   'line1','${line1}','line2',null,'city','Stafford','region','VA','postalCode','22554',
   'countryCode','US','latitude',38.422,'longitude',-77.408,'addressSource','google_places_new','instructions',null)`;
const items = (a) =>
  `jsonb_build_array(jsonb_build_object('code','base_delivery','label','Base','quantity',1,
   'unitAmountCents',${a},'amountCents',${a}))`;

function draftFor(biz, user, key) {
  return one(`select id from public.couranr_create_routed_delivery_request_draft(
    '${biz}','${user}','${key}','merchant_portal','not_confirmed','merchant',
    'Recipient','555-0100','r@example.test',10,0,'standard',false,'photo_or_pin',
    ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
    3219,900,600,300,'google_routes_v2','available_for_request',null,
    'estimated','${POLICY}',799,2,0,${items(799)},'[]'::jsonb,
    null,'asap',null,null,'[]'::jsonb,'none')`);
}

const MIG = "supabase/migrations/20260902210000_couranr_smart_intake_v0.sql";
const RB = "supabase/rollbacks/20260902210000_couranr_smart_intake_v0.rollback.sql";
const applyScript = (file) => {
  try {
    raw(readFileSync(file, "utf8").replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, ""));
    return "NO_ERROR|";
  } catch (e) {
    return `ERROR|${String(e.message).split("\n").find((l) => /ERROR:/.test(l)) ?? "unknown"}`;
  }
};

async function main() {
  up({ quiet: true });
  try {
    raw(`insert into auth.users(id,email) values
           ('${USER_A}','ia@example.test'),('${USER_B}','ib@example.test');
         insert into public.business_accounts(id,name,slug,created_by) values
           ('${BIZ_A}','Intake A','intake-a','${USER_A}'),
           ('${BIZ_B}','Intake B','intake-b','${USER_B}');
         insert into public.business_members(business_account_id,user_id,role,status) values
           ('${BIZ_A}','${USER_A}','owner','active'),
           ('${BIZ_B}','${USER_B}','owner','active');`);

    console.log("\n  Smart Intake V0 — database execution\n");

    /* ---- 0. rollback/replay on the evidence-free database ---------------- */
    check("SI-01", "the rollback applies cleanly before any commit evidence exists",
      applyScript(RB), "NO_ERROR|");
    check("SI-02", "... and the intake tables are gone",
      one(`select count(*) from information_schema.tables
            where table_name like 'couranr_intake%'`), "0");
    check("SI-03", "the forward migration replays over its own rollback",
      applyScript(MIG), "NO_ERROR|");
    check("SI-04", "... and is re-runnable over itself",
      applyScript(MIG), "NO_ERROR|");

    /* ---- 1. session + revisions ------------------------------------------ */
    const reqA = draftFor(BIZ_A, USER_A, "si-req-a");
    const session = one(`select id from public.couranr_create_intake_session(
      '${BIZ_A}','${reqA}','${USER_A}','20 boxes of flower arrangements, about 20 lb total','v0')`);
    check("SI-05", "a session starts at revision 1 with the merchant's words preserved",
      one(`select s.current_revision||'|'||r.raw_description
             from public.couranr_intake_sessions s
             join public.couranr_intake_description_revisions r on r.session_id=s.id and r.revision=1
            where s.id='${session}'`),
      "1|20 boxes of flower arrangements, about 20 lb total");

    check("SI-06", "linking a session to ANOTHER tenant's request is refused as not-found",
      raises(`select public.couranr_create_intake_session(
        '${BIZ_B}','${reqA}','${USER_B}','stolen linkage','v0')`),
      "CR404|request_not_found");

    check("SI-07", "a stale revision CAS is refused",
      raises(`select public.couranr_add_intake_revision(
        '${session}','${BIZ_A}','${USER_A}','2 boxes, not 20',99,'merchant_statement')`),
      "CR409|version_or_state_conflict");

    /* ---- 2. the §6 out-of-order race ------------------------------------- */
    const begun1 = one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',1,'prompt-v1','v0','fake','key-rev1','["shipment_description"]'::jsonb)::text`);
    const run1 = JSON.parse(begun1).run.id;
    check("SI-08a", "the first begin CLAIMS the run — this caller spends the provider money",
      JSON.parse(begun1).claimed, "true");
    const begunDup = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',1,'prompt-v1','v0','fake','key-rev1','["shipment_description"]'::jsonb)::text`));
    check("SI-08", "a duplicate begin CONVERGES on the same run — one row, and it is NOT claimed",
      `${begunDup.run.id === run1}|${begunDup.claimed}|${one(`select count(*) from public.couranr_intake_runs where session_id='${session}'`)}`,
      "true|false|1");

    // Merchant corrects the description: 20 boxes -> 2 boxes.
    raw(`select public.couranr_add_intake_revision(
      '${session}','${BIZ_A}','${USER_A}','2 boxes of flower arrangements',1,'merchant_statement')`);
    check("SI-09", "beginning a run against a NON-current revision is refused",
      raises(`select public.couranr_begin_intake_run(
        '${session}','${BIZ_A}',1,'prompt-v1','v0','fake','key-stale','[]'::jsonb)`),
      "CR409|stale_source_revision");

    const run2 = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',2,'prompt-v1','v0','fake','key-rev2','["shipment_description"]'::jsonb)::text`)).run.id;
    // Run 2 (current words) completes FIRST.
    raw(`select public.couranr_complete_intake_run('${run2}','${BIZ_A}','success',
      '[{"key":"quantity","value":2,"confidence":92,"source":"ai_inference","sourceEvidence":"2 boxes","requiresConfirmation":true},
        {"key":"item_category","value":"flower arrangements","confidence":95,"source":"ai_inference","requiresConfirmation":false}]'::jsonb,
      'hash-run2',480,'{"factKey":"weight_band","priority":3,"question":"Roughly how heavy?","reason":"weight_unresolved"}'::jsonb)`);
    // Run 1 (STALE words: "20 boxes") straggles in afterwards.
    raw(`select public.couranr_complete_intake_run('${run1}','${BIZ_A}','success',
      '[{"key":"quantity","value":20,"confidence":97,"source":"ai_inference","sourceEvidence":"20 boxes","requiresConfirmation":true}]'::jsonb,
      'hash-run1',2100,null)`);

    check("SI-10", "the straggling stale completion is recorded as SUPERSEDED",
      one(`select status from public.couranr_intake_runs where id='${run1}'`), "superseded");
    check("SI-11", "... and the CURRENT fact still says 2 boxes, not 20",
      one(`select value::text from public.couranr_intake_facts
            where session_id='${session}' and fact_key='quantity'`), "2");
    check("SI-12", "... and the current run pointer still names Run 2",
      one(`select (current_run_id='${run2}')::text from public.couranr_intake_sessions
            where id='${session}'`), "true");
    check("SI-13", "... and the current clarification survived the straggler",
      one(`select current_clarification->>'factKey' from public.couranr_intake_sessions
            where id='${session}'`), "weight_band");
    check("SI-14", "the superseded proposals are retained as audit evidence",
      one(`select proposals->0->>'value' from public.couranr_intake_runs where id='${run1}'`), "20");

    /* ---- 3. confirmed facts beat models ---------------------------------- */
    raw(`select public.couranr_confirm_intake_fact(
      '${session}','${BIZ_A}','${USER_A}','weight_band','"over_25_to_50_lb"'::jsonb,'confirmed')`);
    check("SI-15", "confirming the clarified fact clears the current clarification",
      one(`select coalesce(current_clarification::text,'-') from public.couranr_intake_sessions
            where id='${session}'`), "-");

    const run3 = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',2,'prompt-v1','v0','fake','key-rerun','[]'::jsonb)::text`)).run.id;
    raw(`select public.couranr_complete_intake_run('${run3}','${BIZ_A}','success',
      '[{"key":"weight_band","value":"0_25_lb","confidence":99,"source":"ai_inference","requiresConfirmation":true},
        {"key":"charge_amount","value":1,"source":"ai_inference"},
        {"key":"ignore_all_rules","value":true,"source":"ai_inference"}]'::jsonb,
      'hash-run3',300,null)`);
    check("SI-16", "a 99%-confident rerun CANNOT overwrite the merchant-confirmed band",
      one(`select value::text||'|'||authority from public.couranr_intake_facts
            where session_id='${session}' and fact_key='weight_band'`),
      '"over_25_to_50_lb"|confirmed');
    check("SI-17", "... the disagreement is retained as audit, not applied",
      one(`select count(*) from public.couranr_intake_fact_events
            where session_id='${session}' and fact_key='weight_band'
              and event='ai_disagreement_retained'`), "1");
    check("SI-18", "unknown model fields (charge_amount, ignore_all_rules) never became facts",
      one(`select count(*) from public.couranr_intake_facts
            where session_id='${session}' and fact_key in ('charge_amount','ignore_all_rules')`), "0");

    check("SI-19", "a double completion returns the stored outcome and rewrites nothing",
      one(`select status||'|'||output_hash from public.couranr_complete_intake_run(
             '${run3}','${BIZ_A}','malformed',null,'hash-overwrite',1,null)`),
      "success|hash-run3");

    check("SI-20", "confirm with untrusted authority is refused",
      raises(`select public.couranr_confirm_intake_fact(
        '${session}','${BIZ_A}','${USER_A}','fragile','true'::jsonb,'proposed')`),
      "CR422|authority_must_be_trusted");

    /* ---- 4. provider failure degrades to manual --------------------------- */
    const run4 = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',2,'prompt-v1','v0','fake','key-fail','[]'::jsonb)::text`)).run.id;
    raw(`select public.couranr_complete_intake_run('${run4}','${BIZ_A}','malformed',null,null,90,null)`);
    check("SI-21", "malformed output lands the session in MANUAL, request flow unblocked",
      one(`select interpretation_status from public.couranr_intake_sessions where id='${session}'`),
      "manual");
    const run5 = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${session}','${BIZ_A}',2,'prompt-v1','v0','fake','key-unavail','[]'::jsonb)::text`)).run.id;
    raw(`select public.couranr_complete_intake_run('${run5}','${BIZ_A}','unavailable',null,null,10,null)`);
    check("SI-22", "provider unavailable is its own honest status",
      one(`select interpretation_status from public.couranr_intake_sessions where id='${session}'`),
      "provider_unavailable");

    /* ---- 5. cross-tenant refusals ----------------------------------------- */
    check("SI-23", "tenant B cannot confirm facts on tenant A's session",
      raises(`select public.couranr_confirm_intake_fact(
        '${session}','${BIZ_B}','${USER_B}','fragile','true'::jsonb,'confirmed')`),
      "CR404|intake_session_not_found");
    check("SI-24", "tenant B cannot begin runs on tenant A's session",
      raises(`select public.couranr_begin_intake_run(
        '${session}','${BIZ_B}',2,'p','v0','fake','key-b','[]'::jsonb)`),
      "CR404|intake_session_not_found");

    /* ---- 5b. linking a standalone session to its request ------------------- */
    const standalone = one(`select id from public.couranr_create_intake_session(
      '${BIZ_A}',null,'${USER_A}','a standalone description, request comes later','v0')`);
    const reqA2 = draftFor(BIZ_A, USER_A, "si-req-a2");
    check("SI-37", "a standalone session links to its request once the draft exists",
      one(`select (request_id='${reqA2}')::text from public.couranr_link_intake_session(
             '${standalone}','${BIZ_A}','${reqA2}')`), "true");
    check("SI-38", "... linking is idempotent for the same request",
      raises(`select public.couranr_link_intake_session('${standalone}','${BIZ_A}','${reqA2}')`),
      "NO_ERROR|");
    check("SI-39", "... but cannot be re-pointed at a different request",
      raises(`select public.couranr_link_intake_session('${standalone}','${BIZ_A}','${reqA}')`),
      "CR409|intake_session_already_linked");
    check("SI-40", "... and tenant B cannot link A's session to anything",
      raises(`select public.couranr_link_intake_session('${standalone}','${BIZ_B}','${reqA2}')`),
      "CR404|intake_session_not_found");

    /* ---- 6. commit through the canonical command -------------------------- */
    raw(`select public.couranr_confirm_intake_fact(
      '${session}','${BIZ_A}','${USER_A}','timing_intent','"asap"'::jsonb,'confirmed')`);
    // The commit commands require a CURRENT deterministic policy (evaluated
    // at the current revision) — the application records one before pricing.
    const recordPolicy = (sid, disposition, reasons = "'[]'::jsonb") => raw(`select public.couranr_record_intake_policy(
      '${sid}','${BIZ_A}','${disposition}',${reasons},'[]'::jsonb,'[]'::jsonb,
      'couranr-shipment-policy-v1-2026-09-02','standard_lane',null,null,
      '{"signals":[],"material":false}'::jsonb)`);
    check("SI-24b", "committing before any policy was recorded is refused as STALE policy",
      raises(`select public.couranr_commit_intake_to_request('${session}',2,'${reqA}','${BIZ_A}',
        (select version from public.couranr_delivery_requests where id='${reqA}'),'${USER_A}',false,
        'merchant_portal','not_confirmed','merchant','Recipient','555-0100','r@example.test',
        null,0,'standard',false,'photo_or_pin',
        ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
        3219,900,600,300,'google_routes_v2','available_for_request',null,
        'estimated','${POLICY}',799,2,0,${items(799)},'[]'::jsonb)`),
      "CR409|intake_policy_stale");
    recordPolicy(session, "allowed");
    check("SI-24c", "recording the policy stamps the revision it read and keeps the text scan as evidence",
      one(`select policy_revision||'|'||(restricted_signal_scan->>'material') from public.couranr_intake_sessions where id='${session}'`),
      "2|false");
    const ver = one(`select version from public.couranr_delivery_requests where id='${reqA}'`);
    const commitArgs = (band) => `
      '${session}',2,
      '${reqA}','${BIZ_A}',${ver},'${USER_A}',true,
      'merchant_portal','not_confirmed','merchant','Recipient','555-0100','r@example.test',
      null,0,'standard',false,'photo_or_pin',
      ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
      3219,900,600,300,'google_routes_v2','available_for_request',null,
      'estimated','${POLICY}',1099,2,0,
      jsonb_build_array(
        jsonb_build_object('code','base_delivery','label','Base','quantity',1,'unitAmountCents',799,'amountCents',799),
        jsonb_build_object('code','weight_band','label','Weight handling','quantity',1,'unitAmountCents',300,'amountCents',300)),
      '[]'::jsonb,
      ${band},'asap',null,null,'[]'::jsonb,'none'`;

    check("SI-25", "committing arguments that CONTRADICT a confirmed fact is refused",
      raises(`select public.couranr_commit_intake_to_request(${commitArgs("'0_25_lb'")})`),
      "CR409|intake_fact_mismatch: weight_band");
    check("SI-26", "committing at a stale intake revision is refused",
      raises(`select public.couranr_commit_intake_to_request(${commitArgs("'over_25_to_50_lb'").replace(`'${session}',2,`, `'${session}',1,`)})`),
      "CR409|stale_intake_revision");

    const committed = raises(`select public.couranr_commit_intake_to_request(${commitArgs("'over_25_to_50_lb'")})`);
    check("SI-27", "a truthful commit runs the canonical estimate in the SAME transaction",
      committed, "NO_ERROR|");
    check("SI-28", "... the request row carries the committed band with NULL exact weight",
      one(`select coalesce(weight_lb::text,'-')||'|'||weight_band
             from public.couranr_delivery_requests where id='${reqA}'`),
      "-|over_25_to_50_lb");
    check("SI-29", "... Quote N+1 exists and its snapshot tells the band truth",
      one(`select quote_number||'|'||(shipment_snapshot->>'weightKnowledge')
             from public.couranr_quote_versions where request_id='${reqA}'
             order by quote_number desc limit 1`),
      "2|band");
    check("SI-30", "... and the commit binding is audited",
      one(`select count(*) from public.couranr_intake_fact_events
            where session_id='${session}' and event='committed_to_request'`), "1");

    /* ---- 6b. the merchant changes their mind: retraction ------------------- */
    // The primary-flow dead end: intake confirmed a band, the structured form
    // now says 12 lb exact. Without retraction the commit refuses the exact
    // as contradicting the band the merchant no longer means.
    check("SI-41", "a confirmed fact can be WITHDRAWN — authority unknown, value null, row kept",
      one(`select authority||'|'||value::text||'|'||revision from public.couranr_retract_intake_fact(
             '${session}','${BIZ_A}','${USER_A}','weight_band')`),
      // revision 2: the band was never proposed (SI-13 asked for it), so
      // SI-15's confirmation INSERTED at 1 and the withdrawal bumped it once.
      "unknown|null|2");
    check("SI-42", "... the withdrawal is audited with the value it replaced",
      one(`select from_value::text||'|'||from_authority||'|'||to_authority
             from public.couranr_intake_fact_events
            where session_id='${session}' and fact_key='weight_band' and event='retracted'`),
      '"over_25_to_50_lb"|confirmed|unknown');
    check("SI-43", "... and withdrawing it again is idempotent (no second event)",
      one(`select public.couranr_retract_intake_fact('${session}','${BIZ_A}','${USER_A}','weight_band') is distinct from null
           and (select count(*) from public.couranr_intake_fact_events
                 where session_id='${session}' and fact_key='weight_band' and event='retracted') = 1`),
      "t");
    raw(`select public.couranr_confirm_intake_fact(
      '${session}','${BIZ_A}','${USER_A}','weight_lb_exact','12'::jsonb,'confirmed')`);
    const ver2 = one(`select version from public.couranr_delivery_requests where id='${reqA}'`);
    const commitExact = commitArgs("null")
      .replace(`'${reqA}','${BIZ_A}',${ver},`, `'${reqA}','${BIZ_A}',${ver2},`)
      .replace(`null,0,'standard'`, `12,0,'standard'`);
    check("SI-44", "after the flip, committing 12 lb EXACT with a null band is accepted",
      raises(`select public.couranr_commit_intake_to_request(${commitExact})`), "NO_ERROR|");
    check("SI-45", "... and the request row now carries the exact with NULL band",
      one(`select coalesce(weight_lb::text,'-')||'|'||coalesce(weight_band,'-')
             from public.couranr_delivery_requests where id='${reqA}'`), "12.00|-");
    check("SI-46", "withdrawing a fact that was never stated is not-found, and tenant B cannot withdraw at all",
      raises(`select public.couranr_retract_intake_fact('${session}','${BIZ_A}','${USER_A}','dimensions_in')`)
        + " / " + raises(`select public.couranr_retract_intake_fact('${session}','${BIZ_B}','${USER_B}','weight_lb_exact')`),
      "CR404|intake_fact_not_found / CR404|intake_session_not_found");

    /* ---- 6c. ATOMIC create-from-intake (correction pass §3) ---------------- */
    const createArgs = (sid, rev, disposition, key, { band = "'0_25_lb'", status = "'estimated'", restricted = "'none'" } = {}) => {
      const est = status === "'estimated'";
      return `'${sid}',${rev},${disposition === null ? "null" : `'${disposition}'`},
      '${BIZ_A}','${USER_A}','${key}','merchant_portal','not_confirmed','merchant',
      'Recipient','555-0100','r@example.test',null,0,'standard',false,'photo_or_pin',
      ${addr("place-pickup", "10 Market St")},${addr("place-drop", "20 Main St")},false,
      3219,900,600,300,'google_routes_v2','available_for_request',null,
      ${status},${est ? `'${POLICY}'` : "null"},${est ? 799 : "null"},2,0,${est ? items(799) : "'[]'::jsonb"},
      ${est ? "'[]'::jsonb" : `'["shipment_policy_review"]'::jsonb`},
      ${band},'asap',null,null,'[]'::jsonb,${restricted}`;
    };
    const s2 = one(`select id from public.couranr_create_intake_session(
      '${BIZ_A}',null,'${USER_A}','2 boxes of flower arrangements, under 25 lb','v0')`);
    for (const [k, v] of [["restricted_class", '"none"'], ["weight_band", '"0_25_lb"'], ["timing_intent", '"asap"']]) {
      raw(`select public.couranr_confirm_intake_fact('${s2}','${BIZ_A}','${USER_A}','${k}','${v}'::jsonb,'confirmed')`);
    }
    check("SI-47", "create-from-intake before the policy is recorded is refused — no quote from an unevaluated shipment",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-early")})`),
      "CR409|intake_policy_stale");
    recordPolicy(s2, "allowed");
    check("SI-48", "arguments contradicting a confirmed fact are refused BEFORE anything is created",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-lie", { restricted: "'unknown'", status: "'manual_review_required'" })})`)
        + "|" + one(`select count(*) from public.couranr_delivery_requests where idempotency_key='cfi-lie'`),
      "CR409|intake_fact_mismatch: restricted_class|0");
    const created = one(`select id from public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-ok")})`);
    check("SI-49", "a truthful create mints the request AND Quote 1 AND links the session in ONE transaction",
      one(`select (s.request_id='${created}')::text||'|'||q.quote_number||'|'||(q.shipment_snapshot->>'restrictedClass')||'|'||r.quote_status
             from public.couranr_intake_sessions s
             join public.couranr_delivery_requests r on r.id='${created}'
             join public.couranr_quote_versions q on q.request_id=r.id
            where s.id='${s2}'`), "true|1|none|estimated");
    check("SI-50", "... and the binding is audited with the command and the policy it was priced under",
      one(`select to_value->>'command'||'|'||(to_value->>'policyDisposition')
             from public.couranr_intake_fact_events
            where session_id='${s2}' and event='committed_to_request'`), "create_request_from_intake|allowed");
    check("SI-51", "an idempotent replay returns the same request and appends no second audit row",
      one(`select id from public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-ok")})`) === created
        ? one(`select count(*) from public.couranr_intake_fact_events where session_id='${s2}' and event='committed_to_request'`)
        : "different request", "1");
    check("SI-52", "a session already bound to a request cannot create ANOTHER — and the attempt leaves no request behind",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-second")})`)
        + "|" + one(`select count(*) from public.couranr_delivery_requests where idempotency_key='cfi-second'`),
      "CR409|intake_session_already_linked|0");
    check("SI-53", "tenant B cannot create from tenant A's session",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s2, 1, "allowed", "cfi-b").replace(`'${BIZ_A}','${USER_A}','cfi-b'`, `'${BIZ_B}','${USER_B}','cfi-b'`)})`),
      "CR404|intake_session_not_found");

    /* ---- 6d. the stale-revision RACE: revision N priced, revision N+1 lands first */
    const s3 = one(`select id from public.couranr_create_intake_session(
      '${BIZ_A}',null,'${USER_A}','2 boxes of flower arrangements, under 25 lb','v0')`);
    for (const [k, v] of [["restricted_class", '"none"'], ["weight_band", '"0_25_lb"'], ["timing_intent", '"asap"']]) {
      raw(`select public.couranr_confirm_intake_fact('${s3}','${BIZ_A}','${USER_A}','${k}','${v}'::jsonb,'confirmed')`);
    }
    recordPolicy(s3, "allowed");
    // Tab A has priced revision 1 as `allowed`. Before it commits, the
    // merchant's revision 2 changes a material safety fact.
    raw(`select public.couranr_add_intake_revision(
      '${s3}','${BIZ_A}','${USER_A}','2 boxes of flower arrangements and 12 bottles of beer',1,'merchant_statement')`);
    check("SI-54", "the revision-1 create is refused as STALE — it cannot mint from the obsolete policy",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s3, 1, "allowed", "race-n")})`)
        + "|" + one(`select count(*) from public.couranr_delivery_requests where idempotency_key='race-n'`),
      "CR409|stale_intake_revision|0");
    check("SI-55", "claiming revision 2 with a policy that was evaluated at revision 1 is refused too",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s3, 2, "allowed", "race-n1")})`),
      "CR409|intake_policy_stale");
    raw(`select public.couranr_confirm_intake_fact('${s3}','${BIZ_A}','${USER_A}','restricted_class','"alcohol"'::jsonb,'overridden')`);
    recordPolicy(s3, "prohibited", `'["prohibited_class_confirmed"]'::jsonb`);
    check("SI-56", "with the current policy PROHIBITED, an estimated quote is refused whatever the caller claims",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s3, 2, "allowed", "race-est", { restricted: "'alcohol'" })})`),
      "CR409|intake_policy_mismatch");
    check("SI-57", "... and even an honest 'prohibited' claim cannot carry an estimated quote",
      raises(`select public.couranr_create_request_from_intake(${createArgs(s3, 2, "prohibited", "race-est2", { restricted: "'alcohol'" })})`),
      "CR422|prohibited_requires_invalid_quote");
    const prohibitedReq = one(`select id from public.couranr_create_request_from_intake(${createArgs(s3, 2, "prohibited", "race-inv", { restricted: "'alcohol'", status: "'invalid'" })})`);
    check("SI-58", "the honest outcome — an INVALID quote recording the prohibition — mints and links",
      one(`select r.quote_status||'|'||r.restricted_class||'|'||(s.request_id=r.id)::text
             from public.couranr_delivery_requests r join public.couranr_intake_sessions s on s.id='${s3}'
            where r.id='${prohibitedReq}'`), "invalid|alcohol|true");

    /* ---- 6e. paid-provider budget (correction pass §4) --------------------- */
    const s4 = one(`select id from public.couranr_create_intake_session(
      '${BIZ_A}',null,'${USER_A}','budget probe','v0')`);
    let claimedRuns = 0;
    for (let i = 1; i <= 12; i++) {
      const b = JSON.parse(one(`select public.couranr_begin_intake_run(
        '${s4}','${BIZ_A}',1,'p','v0','anthropic','budget-${i}','[]'::jsonb,'claude-sonnet-5')::text`));
      if (b.claimed) claimedRuns++;
    }
    check("SI-59", "twelve provider invocations per session per hour are claimed", claimedRuns, "12");
    const thirteenth = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${s4}','${BIZ_A}',1,'p','v0','anthropic','budget-13','[]'::jsonb,'claude-sonnet-5')::text`));
    check("SI-60", "the thirteenth is NOT claimed, is recorded as rate_limited, and the session says so",
      `${thirteenth.claimed}|${thirteenth.rateLimited}|${thirteenth.run.status}|` +
        one(`select interpretation_status from public.couranr_intake_sessions where id='${s4}'`),
      "false|true|rate_limited|rate_limited");
    check("SI-61", "a rate-limited attempt never consumed the idempotency key — a later retry can still claim",
      one(`select count(*) from public.couranr_intake_runs where session_id='${s4}' and idempotency_key='budget-13'`), "0");
    check("SI-62", "the requested model is on every run",
      one(`select count(distinct requested_model)||'|'||min(requested_model) from public.couranr_intake_runs where session_id='${s4}'`),
      "1|claude-sonnet-5");
    // Business-level cap: 60 across the account per hour. s4 holds 12; four
    // more sessions of 12 reach 60, and the 61st anywhere is refused.
    for (let n = 5; n <= 8; n++) {
      const sid = one(`select id from public.couranr_create_intake_session('${BIZ_A}',null,'${USER_A}','budget probe ${n}','v0')`);
      for (let i = 1; i <= 12; i++) {
        raw(`select public.couranr_begin_intake_run('${sid}','${BIZ_A}',1,'p','v0','anthropic','bb-${n}-${i}','[]'::jsonb,null)`);
      }
    }
    const s9 = one(`select id from public.couranr_create_intake_session('${BIZ_A}',null,'${USER_A}','budget probe 9','v0')`);
    const sixtyFirst = JSON.parse(one(`select public.couranr_begin_intake_run(
      '${s9}','${BIZ_A}',1,'p','v0','anthropic','bb-9-1','[]'::jsonb,null)::text`));
    check("SI-63", "the sixty-first provider invocation for the BUSINESS in an hour is refused even on a fresh session",
      `${sixtyFirst.claimed}|${sixtyFirst.rateLimited}|${sixtyFirst.businessCallsLastHour}`, "false|true|60");
    const otherTenant = one(`select id from public.couranr_create_intake_session('${BIZ_B}',null,'${USER_B}','other tenant','v0')`);
    check("SI-64", "... and it is per business: another tenant is unaffected",
      JSON.parse(one(`select public.couranr_begin_intake_run(
        '${otherTenant}','${BIZ_B}',1,'p','v0','anthropic','bt-1','[]'::jsonb,null)::text`)).claimed, "true");
    check("SI-65", "runs with provider 'none' never count against the budget",
      JSON.parse(one(`select public.couranr_begin_intake_run(
        '${s9}','${BIZ_A}',1,'p','v0','none','bb-9-none','[]'::jsonb,null)::text`)).claimed, "true");

    /* ---- 6f. provider audit evidence: reported model + tokens ------------- */
    const auditRun = one(`select (public.couranr_begin_intake_run(
      '${otherTenant}','${BIZ_B}',1,'p','v0','anthropic','bt-audit','["shipment_description"]'::jsonb,'claude-sonnet-5'))->'run'->>'id'`);
    raw(`select public.couranr_complete_intake_run('${auditRun}','${BIZ_B}','success',
      '[{"key":"package_count","value":2,"confidence":90,"source":"ai_inference","requiresConfirmation":true}]'::jsonb,
      'hash-audit',640,null,'claude-sonnet-5-20260801',812,143)`);
    check("SI-66", "the run records the requested model, the model the provider reported, and both token counts",
      one(`select requested_model||'|'||provider_model||'|'||input_tokens||'|'||output_tokens||'|'||latency_ms||'|'||output_hash
             from public.couranr_intake_runs where id='${auditRun}'`),
      "claude-sonnet-5|claude-sonnet-5-20260801|812|143|640|hash-audit");

    /* ---- 7. privileges ----------------------------------------------------- */
    check("SI-31", "no intake function is executable by anon or authenticated",
      one(`select coalesce(bool_or(
             has_function_privilege('anon',p.oid,'EXECUTE')
             or has_function_privilege('authenticated',p.oid,'EXECUTE')),false)
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname like 'couranr%intake%'`), "f");
    check("SI-32", "no intake table is readable by anon or authenticated",
      one(`select coalesce(bool_or(
             has_table_privilege('anon',c.oid,'SELECT')
             or has_table_privilege('authenticated',c.oid,'SELECT')
             or has_table_privilege('anon',c.oid,'INSERT')
             or has_table_privilege('authenticated',c.oid,'INSERT')),false)
           from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname like 'couranr_intake%' and c.relkind='r'`), "f");
    check("SI-33", "raw description revisions are APPEND-ONLY even for service_role",
      one(`select has_table_privilege('service_role',
             'public.couranr_intake_description_revisions','UPDATE')::text
           ||'|'||has_table_privilege('service_role',
             'public.couranr_intake_description_revisions','DELETE')::text`),
      "false|false");
    check("SI-34", "fact audit events are APPEND-ONLY even for service_role",
      one(`select has_table_privilege('service_role',
             'public.couranr_intake_fact_events','UPDATE')::text`),
      "false");

    /* ---- 8. rollback hard-refuses once commit evidence exists -------------- */
    const attempted = applyScript(RB);
    check("SI-35", "the rollback HARD-REFUSES once facts were committed to a request",
      attempted.includes("smart_intake_rollback_would_orphan_commercial_provenance"), "true");
    check("SI-36", "... and the intake evidence survives the refusal",
      one(`select count(*) from public.couranr_intake_sessions where id='${session}'`), "1");
  } finally {
    console.log(`\n  Smart Intake V0: ${pass} passed, ${fail} failed\n`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exit(1);
});
