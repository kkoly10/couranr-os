/**
 * EXECUTION VERIFICATION for 20260806220000_couranr_idempotency_records.
 *
 * Applying proves it parses. Reading proves it says what someone meant. Neither
 * proves it runs — and for a substrate whose entire job is "guarantee one
 * effect", the paths that matter are exactly the ones only a real call reaches:
 * the ON CONFLICT mutex, the coalesce in the unique index, the mismatch refusal.
 *
 *   I1   a fresh key returns `proceed`
 *   I2   ... and the row is in_progress with the caller's expiry
 *   I3   a SECOND claim on an unfinished key returns `in_progress`, not proceed
 *   I4   completing records the result
 *   I5   a claim after completion returns `replay` WITH the original result
 *   I6   completing twice returns the ORIGINAL result, not the second one
 *   I7   the SAME key with a DIFFERENT request hash returns `mismatch`
 *   I8   ... and mismatch neither replays nor proceeds — nothing was recorded
 *   I9   the same key under a DIFFERENT actor is independent
 *   I10  the same key for a DIFFERENT purpose is independent
 *   I11  two `system` rows (actor_id NULL) DO collide — the coalesce works
 *   I12  an expired key is reusable and resets to the NEW request hash
 *   I13  a null expiry is refused (the retention window is an owner decision)
 *   I14  completing with no result is refused
 *   I15  completing an unknown record is refused
 *   I16  a user actor with no id is refused by the schema
 *   I17  a system actor carrying an id is refused by the schema
 *   I18  `completed` with no result_ref is refused by the schema
 *   I19  anon/authenticated hold NOTHING on the table
 *   I20  anon/authenticated hold no EXECUTE on either command
 *   I21  CONCURRENCY: two simultaneous claims yield exactly one `proceed`
 *
 * Run:  node e2e/disposable/idempotencySubstrate.mjs
 */
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { up, down, psql, dbUrl } from "./up.mjs";

const execFileAsync = promisify(execFile);

/**
 * Run a statement in its OWN process, so two can genuinely overlap.
 *
 * `psql()` is synchronous and cannot express a race. I21 needs two claims alive
 * at the same moment — the only way to tell an ON CONFLICT mutex apart from two
 * sequential calls that happen to give the right answers.
 */
async function psqlAsync(statement) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/lib/postgresql/16/bin/psql",
      [dbUrl(), "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { timeout: 30_000 },
    );
    return { ok: true, out: String(stdout).trim() };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
}

const KEEP = process.argv.includes("--keep");
let pass = 0;
let fail = 0;

const one = (sql) => psql(sql).trim();
const esc = (s) => String(s).replace(/'/g, "''");

function eq(id, label, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${label}  [${ok ? got : `got ${got}, want ${want}`}]`);
}

/** Run SQL expecting a RAISE; return `SQLSTATE|message`. One psql call: each is its own connection. */
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _p(c text, m text);
     do $p$ begin
       ${stmt}
       insert into _p values ('NO_ERROR','');
     exception when others then insert into _p values (SQLSTATE, SQLERRM);
     end $p$;
     select c || '|' || m from _p;`,
  ).trim();
}

const FUTURE = "now() + interval '1 hour'";

async function main() {
  up();
  try {
    console.log("\n  idempotency substrate — execution verification\n");

    const u1 = one(`insert into auth.users (email) values ('i1+${crypto.randomUUID().slice(0,8)}@e2e.test') returning id`);
    const u2 = one(`insert into auth.users (email) values ('i2+${crypto.randomUUID().slice(0,8)}@e2e.test') returning id`);

    const K = `key-${crypto.randomUUID()}`;
    const P = "payment_intent_creation";
    const claim = (key, hash, actor = u1, purpose = P, atype = "user", exp = FUTURE) => {
      const aid = actor ? `'${actor}'` : "null";
      return `(private.couranr_begin_idempotent('${purpose}','${atype}',${aid},'${esc(key)}','${esc(hash)}',${exp}))`;
    };

    eq("I1", "a fresh key returns proceed", one(`select ${claim(K, "h1")}.decision`), "proceed");
    eq(
      "I2", "... row is in_progress with the caller's expiry",
      // `::text` on a boolean renders "true"; psql renders a BARE boolean as
      // "t". Building the flag explicitly avoids depending on either.
      one(`select state || '|' || case when expires_at > now() then 't' else 'f' end
             from private.idempotency_records where idempotency_key='${K}'`),
      "in_progress|t",
    );
    eq("I3", "a SECOND claim on an unfinished key is in_progress",
       one(`select ${claim(K, "h1")}.decision`), "in_progress");

    const recId = one(`select id from private.idempotency_records where idempotency_key='${K}'`);
    eq("I4", "completing records the result",
       one(`select (private.couranr_complete_idempotent('${recId}','{"obligationId":"first"}'::jsonb)).result_ref->>'obligationId'`),
       "first");
    eq("I5", "a claim after completion replays the ORIGINAL result",
       one(`select ${claim(K, "h1")}.result_ref->>'obligationId'`), "first");
    eq("I6", "completing twice returns the ORIGINAL, not the second",
       one(`select (private.couranr_complete_idempotent('${recId}','{"obligationId":"second"}'::jsonb)).result_ref->>'obligationId'`),
       "first");

    // ---- the safety property ------------------------------------------
    eq("I7", "same key, DIFFERENT request hash -> mismatch",
       one(`select ${claim(K, "DIFFERENT")}.decision`), "mismatch");
    eq(
      "I8", "... and mismatch recorded nothing new",
      one(`select count(*) from private.idempotency_records where idempotency_key='${K}'`), "1",
    );

    // ---- scoping -------------------------------------------------------
    eq("I9", "the same key under a DIFFERENT actor is independent",
       one(`select ${claim(K, "h1", u2)}.decision`), "proceed");
    eq("I10", "the same key for a DIFFERENT purpose is independent",
       one(`select ${claim(K, "h1", u1, "capture")}.decision`), "proceed");

    const SK = `sys-${crypto.randomUUID()}`;
    eq("I11a", "a system claim (actor_id null) proceeds",
       one(`select ${claim(SK, "h1", null, "capture", "system")}.decision`), "proceed");
    eq("I11", "a SECOND system claim COLLIDES — the coalesce in the index works",
       one(`select ${claim(SK, "h1", null, "capture", "system")}.decision`), "in_progress");

    // ---- expiry --------------------------------------------------------
    const EK = `exp-${crypto.randomUUID()}`;
    psql(`select ${claim(EK, "old", u1, P, "user", "now() + interval '1 hour'")}`);
    psql(`update private.idempotency_records set expires_at = now() - interval '1 minute'
           where idempotency_key='${EK}'`);
    eq("I12a", "an EXPIRED key is reusable", one(`select ${claim(EK, "new")}.decision`), "proceed");
    eq("I12", "... and reset to the NEW request hash",
       one(`select request_hash from private.idempotency_records where idempotency_key='${EK}'`), "new");

    // ---- refusals ------------------------------------------------------
    eq("I13", "a null expiry is refused",
       raises(`select ${claim(`n-${crypto.randomUUID()}`, "h", u1, P, "user", "null")}`),
       "CR400|idempotency_expiry_required");
    eq("I14", "completing with no result is refused",
       raises(`select private.couranr_complete_idempotent('${recId}', null)`),
       "CR400|idempotency_result_required");
    eq("I15", "completing an unknown record is refused",
       raises(`select private.couranr_complete_idempotent('00000000-0000-0000-0000-000000000001'::uuid,'{}'::jsonb)`),
       "CR404|idempotency_record_not_found");

    // ---- schema-level guards (only fire on write) ----------------------
    const ins = (cols, vals) =>
      raises(`insert into private.idempotency_records (${cols}) values (${vals})`).split("|")[0];
    eq("I16", "a user actor with no id is refused by the schema",
       ins("purpose,actor_type,actor_id,idempotency_key,request_hash,expires_at",
           `'p','user',null,'k','h',now()+interval '1 hour'`), "23514");
    eq("I17", "a system actor carrying an id is refused by the schema",
       ins("purpose,actor_type,actor_id,idempotency_key,request_hash,expires_at",
           `'p','system','${u1}','k2','h',now()+interval '1 hour'`), "23514");
    eq("I18", "completed with no result_ref is refused by the schema",
       ins("purpose,actor_type,actor_id,idempotency_key,request_hash,state,expires_at",
           `'p','user','${u1}','k3','h','completed',now()+interval '1 hour'`), "23514");

    // ---- privileges ----------------------------------------------------
    eq("I19", "no browser role holds ANY privilege on the table",
       one(`select bool_or(has_table_privilege(r,'private.idempotency_records',p))
              from unnest(array['anon','authenticated']) r,
                   unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`), "f");
    eq("I20", "no browser role holds EXECUTE on either command",
       one(`select bool_or(has_function_privilege(r,f,'EXECUTE'))
              from unnest(array['anon','authenticated']) r,
                   unnest(array[
                     'private.couranr_begin_idempotent(text,text,uuid,text,text,timestamptz)',
                     'private.couranr_complete_idempotent(uuid,jsonb)']) f`), "f");

    /*
     * I21 — THE MUTEX, under genuine concurrency.
     *
     * Everything above runs sequentially, and a substrate whose whole purpose
     * is "guarantee one effect" cannot be called verified on sequential calls
     * alone: two callers arriving together is the case it exists for. Two real
     * processes, one key, and exactly one of them may be told to proceed.
     */
    const CK = `race-${crypto.randomUUID()}`;
    const both = await Promise.all([
      psqlAsync(`select ${claim(CK, "same")}.decision`),
      psqlAsync(`select ${claim(CK, "same")}.decision`),
    ]);
    const decisions = both.map((r) => (r.ok ? r.out : `ERR:${r.err.slice(0, 60)}`)).sort();
    eq("I21", "two SIMULTANEOUS claims yield exactly one proceed",
       decisions.filter((d) => d === "proceed").length, 1);
    eq("I21b", "... and the loser is told in_progress, not an error",
       decisions.filter((d) => d === "in_progress").length, 1);
    eq("I21c", "... and only ONE row exists for that key",
       one(`select count(*) from private.idempotency_records where idempotency_key='${CK}'`), "1");

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
  } finally {
    if (!KEEP) down();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
