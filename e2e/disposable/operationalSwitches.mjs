/**
 * Executed probe for the operational switches (FLG-001, GAT-001 gates 10 & 11).
 *
 *   export COURANR_PGBIN=/opt/homebrew/opt/postgresql@17/bin
 *   export COURANR_DISPOSABLE_DIR=/tmp/pgdisp-sw
 *   export COURANR_DISPOSABLE_PORT=55435
 *   node e2e/disposable/operationalSwitches.mjs
 *
 * The rule under test only exists at execution time: a trigger that refuses a
 * transition is invisible to every text assertion, and so is one that refuses
 * the WRONG transition. The cases that matter most here are the negative ones —
 * a pause that also trapped a customer inside their own draft would be a worse
 * bug than no pause at all.
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
const mustRefuse = (q, expected) => {
  const got = refuses(q, expected);
  return { ok: got !== "ACCEPTED" && !got.startsWith("other:"), got };
};

try {
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied\n`);

  /* ------------------------------------------------- FLG-001 defaults ---- */

  const seeded = sql(`select string_agg(switch_key||'='||enabled::text,',' order by switch_key)
                        from public.couranr_operational_switches`);
  t("S1", "the four FLG-001 switches seed at their launch defaults",
    seeded === "ai_auto_reply_enabled=false,ai_global_kill_switch=false,"
            + "overnight_enabled=false,request_intake_paused=false", seeded);

  const closed = mustRefuse(`insert into public.couranr_operational_switches
      (switch_key,enabled) values ('delete_everything',true)`, "couranr_os_key_chk");
  t("S2", "the key vocabulary is closed", closed.got.includes("couranr_os_key_chk"), closed.got);

  /* ------------------------------------------- GAT-001 gate 10: intake --- */

  const biz = sql(`insert into public.business_accounts (name,status) values ('SW probe','active') returning id`);
  const usr = sql(`insert into auth.users (email) values ('sw@example.test') returning id`);
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: biz, actorUserId: usr, marker: "sw-probe", recipientName: "SW recipient",
  });
  const draft = (marker) => sql(`insert into public.couranr_delivery_requests
      (business_account_id,requester_kind,source,request_state,idempotency_key,
       pickup_address,dropoff_address)
    select '${biz}','business','merchant_portal','draft','${marker}',
       pickup_address,dropoff_address
    from public.couranr_delivery_requests where id='${chain.requestId}' returning id`);
  /* couranr_dr_submitted_at_chk requires submitted_at for EVERY non-draft
     state, cancelled included — the schema saying that leaving draft at all is
     a recorded moment. An earlier draft of this probe assumed cancelling was
     exempt and was corrected by the constraint rather than by reasoning. */
  const advance = (rid, to) =>
    `update public.couranr_delivery_requests
        set request_state='${to}', submitted_at=coalesce(submitted_at,now())
      where id='${rid}'`;
  const setSwitch = (k, v) =>
    `select enabled from public.couranr_set_operational_switch('${k}',${v},'${usr}','probe')`;

  const openDraft = draft("sw-open");
  sql(advance(openDraft, "pending_couranr_review"));
  t("S3", "while OPEN, a draft advances into the pipeline normally",
    sql(`select request_state from public.couranr_delivery_requests where id='${openDraft}'`)
      === "pending_couranr_review");

  t("S4", "Operations can throw the pause", sql(setSwitch("request_intake_paused", true)) === "t");

  const blocked = draft("sw-blocked");
  const refused = mustRefuse(advance(blocked, "pending_couranr_review"), "request_intake_paused");
  t("S5", "GATE 10 — while PAUSED, a draft cannot enter the pipeline",
    refused.got === "raised:request_intake_paused" || refused.got === "request_intake_paused",
    refused.got);

  /* THE NEGATIVE CASES THAT MATTER MORE THAN THE POSITIVE ONE. A pause that
     also trapped a customer in their own draft, or silenced someone reporting a
     problem with a delivery already in flight, would be worse than no pause. */
  const abandon = draft("sw-abandon");
  sql(advance(abandon, "cancelled"));
  t("S6", "a customer can still ABANDON their own draft while paused",
    sql(`select request_state from public.couranr_delivery_requests where id='${abandon}'`)
      === "cancelled");

  const inflight = sql(`select request_state from public.couranr_delivery_requests
                         where id='${chain.requestId}'`);
  sql(`update public.couranr_delivery_requests set updated_at=now() where id='${chain.requestId}'`);
  t("S7", "a request already past draft is untouched by the pause",
    sql(`select request_state from public.couranr_delivery_requests
          where id='${chain.requestId}'`) === inflight, inflight);

  t("S8", "unpausing restores intake", sql(setSwitch("request_intake_paused", false)) === "f");
  const after = draft("sw-after");
  sql(advance(after, "pending_couranr_review"));
  t("S9", "and a draft advances again",
    sql(`select request_state from public.couranr_delivery_requests where id='${after}'`)
      === "pending_couranr_review");

  /* ------------------------------------------------------- the record ---- */

  const events = sql(`select count(*)::text from public.couranr_operational_switch_events
                       where switch_key='request_intake_paused'`);
  t("S10", "every throw is recorded", events === "2", events);

  sql(setSwitch("ai_global_kill_switch", false));
  const noop = sql(`select count(*)::text from public.couranr_operational_switch_events
                     where switch_key='ai_global_kill_switch'`);
  t("S11", "a call that changes NOTHING is still recorded",
    noop === "1", noop);

  const unknown = mustRefuse(setSwitch("not_a_switch", true), "switch_unknown");
  t("S12", "an unknown key is refused, never created",
    unknown.got === "raised:switch_unknown" || unknown.got === "switch_unknown", unknown.got);

  /* THE IDEMPOTENCY TRAP. Re-running the seed must never reset a switch
     Operations has thrown — a migration that silently reopens a paused intake
     is the worst possible kind of idempotent. */
  sql(setSwitch("request_intake_paused", true));
  sql(`insert into public.couranr_operational_switches (switch_key, enabled, reason) values
        ('request_intake_paused', false, 'FLG-001 default_at_launch')
       on conflict (switch_key) do nothing`);
  t("S13", "re-running the seed does NOT reopen a paused intake",
    sql(`select enabled from public.couranr_operational_switches
          where switch_key='request_intake_paused'`) === "t");
  sql(setSwitch("request_intake_paused", false));

  /* ------------------------------------------------------------ sealed --- */

  const grants = sql(`select
      has_function_privilege('anon','public.couranr_set_operational_switch(text,boolean,uuid,text)','execute')::text
    ||'/'|| has_function_privilege('authenticated','public.couranr_set_operational_switch(text,boolean,uuid,text)','execute')::text
    ||'/'|| has_function_privilege('service_role','public.couranr_set_operational_switch(text,boolean,uuid,text)','execute')::text`);
  t("S14", "no browser role may throw a switch; service_role may",
    grants === "false/false/true", grants);

  const tbl = sql(`select
      has_table_privilege('anon','public.couranr_operational_switches','select')::text
    ||'/'|| has_table_privilege('authenticated','public.couranr_operational_switches','update')::text`);
  t("S15", "no browser role can read or rewrite the switches directly",
    tbl === "false/false", tbl);

  const overloads = sql(`select count(*)::text from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='couranr_set_operational_switch'`);
  t("S16", "exactly one function of this name exists", overloads === "1", overloads);

} catch (e) {
  console.error("\n  SUITE ERROR:", String(e.stderr || e.message).slice(0, 900));
  fail += 1;
} finally {
  down({ quiet: true });
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
