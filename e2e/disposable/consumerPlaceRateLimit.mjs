/**
 * EXECUTION VERIFICATION for the consumer Places per-session rate limit:
 *   20260908181500_couranr_consumer_place_search_rate_limit
 *
 * A migration that applies proves it parses; only CALLING
 * couranr_claim_consumer_place_search against a real guest-session row proves
 * the throttle works. These exercise the cap, the window rollover, the uniform
 * refusal on unknown/expired/revoked sessions, the FOR-UPDATE serialization,
 * and the service_role-only authority.
 */
import crypto from "node:crypto";
import { up, psql } from "./up.mjs";

let pass = 0, fail = 0;
const one = (sql) => psql(sql).trim();
const hash = () => crypto.randomBytes(32).toString("hex");
function ok(id, l, g) { pass += 1; console.log(`  PASS  ${id}  ${l}${g === undefined ? "" : `  [${g}]`}`); }
function bad(id, l, g) { fail += 1; console.log(`  FAIL  ${id}  ${l}  [${g}]`); }
function eq(id, l, g, w) { String(g) === String(w) ? ok(id, l, g) : bad(id, l, `got ${g}, want ${w}`); }
function expectError(id, l, sql, codeSub) {
  try {
    psql(sql);
    bad(id, l, "no error raised");
  } catch (e) {
    const m = String(e?.message ?? e);
    m.includes(codeSub) ? ok(id, l) : bad(id, l, m.split("\n").find((x) => x.includes("ERROR")) ?? m.slice(0, 120));
  }
}

const FN = "public.couranr_claim_consumer_place_search(uuid)";
const claim = (sid) => one(`select public.couranr_claim_consumer_place_search('${sid}')`);
const countOf = (sid) =>
  one(`select places_request_count from public.couranr_consumer_guest_sessions where id='${sid}'`);
const newSession = () =>
  one(`select (public.couranr_create_consumer_guest_session('${hash()}',1440)).id`);

function main() {
  up();
  console.log("\n  Consumer Places per-session rate limit — execution verification\n");

  /* ── RL-1: the cap. 30 allowed, the 31st refused, count pinned at 30 ── */
  const s1 = newSession();
  let allowed = 0;
  for (let i = 0; i < 30; i += 1) if (claim(s1) === "t") allowed += 1;
  eq("RL-1a", "30 claims in the window are all allowed", allowed, 30);
  eq("RL-1b", "the 31st claim is refused", claim(s1), "f");
  eq("RL-1c", "a refused claim does NOT increment the counter", countOf(s1), "30");

  /* ── RL-2: a rolled-over window resets the count ── */
  psql(`update public.couranr_consumer_guest_sessions
          set places_window_started_at = now() - interval '2 hours' where id='${s1}'`);
  eq("RL-2a", "a claim in a rolled-over window is allowed again", claim(s1), "t");
  eq("RL-2b", "the counter restarted at 1", countOf(s1), "1");

  /* ── RL-3: a fresh session opens its own window at 1 ── */
  const s2 = newSession();
  eq("RL-3a", "a fresh session's first claim is allowed", claim(s2), "t");
  eq("RL-3b", "its count is 1, independent of other sessions", countOf(s2), "1");
  eq("RL-3c", "the other session is untouched by it", countOf(s1), "1");

  /* ── RL-4/5/6: uniform CR404 on unknown / expired / revoked ── */
  expectError("RL-4", "an unknown session raises consumer_guest_session_not_found",
    `select public.couranr_claim_consumer_place_search('00000000-0000-4000-8000-000000000000')`,
    "consumer_guest_session_not_found");

  const s3 = one(`insert into public.couranr_consumer_guest_sessions (token_hash,created_at,expires_at)
                  values ('${hash()}', now()-interval '2 hours', now()-interval '1 hour') returning id`);
  expectError("RL-5", "an expired session raises consumer_guest_session_not_found",
    `select public.couranr_claim_consumer_place_search('${s3}')`, "consumer_guest_session_not_found");

  const s4 = newSession();
  psql(`update public.couranr_consumer_guest_sessions set revoked_at=now() where id='${s4}'`);
  expectError("RL-6", "a revoked session raises consumer_guest_session_not_found",
    `select public.couranr_claim_consumer_place_search('${s4}')`, "consumer_guest_session_not_found");

  /* ── RL-7: FOR UPDATE serialization at the boundary — one crosses, one does not ── */
  const s5 = newSession();
  psql(`update public.couranr_consumer_guest_sessions
          set places_window_started_at = now(), places_request_count = 29 where id='${s5}'`);
  eq("RL-7a", "claim at 29 crosses to the cap (allowed)", claim(s5), "t");
  eq("RL-7b", "the next claim at the cap is refused", claim(s5), "f");
  eq("RL-7c", "count never exceeds the cap", countOf(s5), "30");

  /* ── RL-8: authority — no customer role widened ── */
  eq("RL-8", "anon/authenticated hold no EXECUTE; service_role only",
    one(`select has_function_privilege('anon','${FN}','EXECUTE')||','||has_function_privilege('authenticated','${FN}','EXECUTE')||','||has_function_privilege('service_role','${FN}','EXECUTE')`),
    "false,false,true");

  console.log(`\n  place-search rate limit: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}

main();
