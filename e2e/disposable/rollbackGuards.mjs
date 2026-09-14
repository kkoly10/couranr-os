/**
 * EXECUTION VERIFICATION for the rollback fixes:
 *   20260905080000 (credit fn) + 20260905081000 (idempotency index) round-trip,
 *   and the refuse-on-evidence guard added to
 *   20260905023000_couranr_activation_contact_verification.rollback.sql
 *
 *   RG-1  index rollback restores NULLS DISTINCT; re-applying the forward
 *         migration restores NULLS NOT DISTINCT (full round-trip)
 *   RG-2  credit fn rollback restores the pre-fix body (else v_ob.id); the
 *         forward migration restores the fixed body (else null)
 *   RG-3  the activation-contact rollback, run against a DB that already holds
 *         contact-verification evidence, RAISES the refusal (it does NOT abort
 *         with check_violation 23514) — the bug the fix closes
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { up, psql } from "./up.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = (n) => path.join(ROOT, "supabase/migrations", n);
const RB = (n) => path.join(ROOT, "supabase/rollbacks", n);
let pass = 0;
let fail = 0;
const one = (sql) => psql(sql).trim();
const apply = (file) => psql(readFileSync(file, "utf8"));
function ok(id, label, got) { pass += 1; console.log(`  PASS  ${id}  ${label}${got === undefined ? "" : `  [${got}]`}`); }
function bad(id, label, got) { fail += 1; console.log(`  FAIL  ${id}  ${label}  [${got}]`); }
function eq(id, label, got, want) { String(got) === String(want) ? ok(id, label, got) : bad(id, label, `got ${got}, want ${want}`); }

const idxNullsNotDistinct = () =>
  one(`select ix.indnullsnotdistinct::text from pg_index ix
        join pg_class i on i.oid = ix.indexrelid where i.relname = 'couranr_cvm_idempotency_uniq'`);
const confirmBodyHasNullArm = () =>
  one(`select (pg_get_functiondef('public.couranr_confirm_service_plan(uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb)'::regprocedure)
               like '%else null end%')::text`);

function expectRefusal(id, label, file, needle) {
  try {
    apply(file);
    bad(id, label, "rollback applied without raising");
  } catch (e) {
    const msg = String(e.stderr || e.message || "");
    msg.includes(needle) ? ok(id, label, needle) : bad(id, label, msg.replace(/\s+/g, " ").slice(0, 140));
  }
}

async function main() {
  up();
  try {
    console.log("\n  rollback guards + migration round-trip — execution verification\n");

    /* ── RG-1: idempotency index round-trip ── */
    eq("RG-1a", "forward migration leaves the index NULLS NOT DISTINCT", idxNullsNotDistinct(), "true");
    apply(RB("20260905081000_couranr_cvm_idempotency_nulls_not_distinct.rollback.sql"));
    eq("RG-1b", "rollback restores NULLS DISTINCT", idxNullsNotDistinct(), "false");
    apply(MIG("20260905081000_couranr_cvm_idempotency_nulls_not_distinct.sql"));
    eq("RG-1c", "re-applying the forward migration restores NULLS NOT DISTINCT", idxNullsNotDistinct(), "true");

    /* ── RG-2: credit fn round-trip ── */
    eq("RG-2a", "forward migration leaves the fixed body (else null)", confirmBodyHasNullArm(), "true");
    apply(RB("20260905080000_couranr_confirm_service_plan_credit_settlement_fix.rollback.sql"));
    eq("RG-2b", "rollback restores the pre-fix body (no 'else null' arm)", confirmBodyHasNullArm(), "false");
    apply(MIG("20260905080000_couranr_confirm_service_plan_credit_settlement_fix.sql"));
    eq("RG-2c", "re-applying the forward migration restores the fixed body", confirmBodyHasNullArm(), "true");

    /* ── RG-3: activation-contact rollback refuses on evidence ── */
    const biz = one(
      `insert into public.business_accounts (name, slug, status)
       values ('RB Co', 'rb-co-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`);
    // A single 'system'/invalidate_contact_verification event is exactly the
    // append-only evidence the widened CHECK was for; the narrow re-add would
    // reject it with 23514, which is what the guard now refuses ahead of.
    one(`insert into public.couranr_activation_events (business_account_id, actor_type, command)
         values ('${biz}', 'system', 'invalidate_contact_verification') returning id`);
    expectRefusal(
      "RG-3",
      "activation-contact rollback RAISES the refusal on existing evidence (not 23514)",
      RB("20260905023000_couranr_activation_contact_verification.rollback.sql"),
      "refusing to restore pre-contact-verification"
    );

    console.log(`\n  rollback guards: ${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
