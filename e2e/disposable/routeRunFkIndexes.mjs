/** RR-003 production-advisor follow-up: index-only, data-preserving migration. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const name = "20261001011500_couranr_route_run_fk_covering_indexes";
const forward = readFileSync(resolve(root, `supabase/migrations/${name}.sql`), "utf8");
const rollback = readFileSync(resolve(root, `supabase/rollbacks/${name}.rollback.sql`), "utf8");
const one = (query) => psql(query).trim();
const indexNames = [
  "couranr_bpsa_completed_by_fk_idx", "couranr_bpsa_actor_fk_idx",
  "couranr_rrrese_actor_fk_idx", "couranr_rrres_version_fk_idx",
  "couranr_rrsette_actor_fk_idx", "couranr_rrsetti_quote_fk_idx",
  "couranr_rrsett_business_fk_idx", "couranr_rrsett_confirmer_fk_idx",
  "couranr_rrsett_uncertain_obligation_fk_idx", "couranr_rrsett_version_fk_idx",
];
let checks = 0;
function check(label, actual, expected) {
  assert.equal(actual, expected, label);
  checks++;
  console.log(`PASS ${label}`);
}
const indexCount = () => one(`select count(*) from pg_class c join pg_namespace n
  on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i'
  and c.relname=any(array[${indexNames.map((value) => `'${value}'`).join(",")}])`);

try {
  up({ quiet: true, throughMigration: `${name}.sql` });
  check("all ten FK covering indexes exist", indexCount(), "10");
  one(rollback);
  check("index-only rollback preserves commercial schema", one(`select
    to_regclass('public.couranr_route_run_settlements') is not null
    and to_regclass('public.couranr_route_run_executions') is not null`), "t");
  check("rollback removes only the new indexes", indexCount(), "0");
  one(forward);
  check("forward reapply restores all ten indexes", indexCount(), "10");
  let replayError = "";
  try { one(forward); } catch (error) { replayError = String(error.stderr ?? error.message); }
  check("replay hard-refuses instead of silently skipping", replayError.includes(
    "route_fk_indexes_already_present_or_partially_applied"), true);
  check("browser role gains no settlement table access", one(`select
    has_table_privilege('anon','public.couranr_route_run_settlements','select')
    or has_table_privilege('authenticated','public.couranr_route_run_settlements','insert')`), "f");
  console.log(`RR-003 FK Indexes ${checks}/${checks} PASS (disposable PostgreSQL).`);
} finally {
  down();
}
