/**
 * Seeds and tears down the synthetic identities the browser suite drives.
 *
 *   node e2e/seed.mjs seed     # create fixtures with a fresh run password
 *   node e2e/seed.mjs report   # list what exists, change nothing
 *   node e2e/seed.mjs clean    # remove every synthetic user and row it can
 *
 * Credentials: the run password is generated here with `crypto.randomBytes`,
 * written only to `e2e/.state.json` at mode 0600, and deleted by `clean`. No
 * usable password exists in source control.
 *
 * The secret key never leaves Node — see admin.mjs.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E2E_MARKER, E2E_META, USERS, WORKSPACE_SEED } from "./fixtures.mjs";
import { KEY_SOURCE, SUPABASE_URL, admin, deleteUser, listSyntheticUsers } from "./admin.mjs";

const STATE = new URL("./.state.json", import.meta.url);

/**
 * 32 bytes of CSPRNG entropy, base64url. Long and random enough that the
 * `admin` fixture is not a standing risk while it exists, and it exists for
 * minutes rather than indefinitely.
 */
function generatePassword() {
  return `E2E-${randomBytes(32).toString("base64url")}-Aa1!`;
}

const runScoped = (email, tag) => email.replace("@", `+${tag}@`);

/* ------------------------------------------------------------------ seed */

async function ensureUser(spec, password) {
  const existing = (await listSyntheticUsers()).find(
    (u) => (u.email ?? "").toLowerCase() === spec.email.toLowerCase()
  );

  if (existing) {
    // Force password and confirmation back to this run's values, so a
    // half-modified account from an earlier run cannot change a result.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: spec.confirmed,
    });
    if (error) throw new Error(`updateUser ${spec.key}: ${error.message}`);
    return { id: existing.id, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    password,
    email_confirm: spec.confirmed,
    user_metadata: { ...E2E_META, fixture: spec.key },
  });
  if (error) throw new Error(`createUser ${spec.key}: ${error.message}`);
  return { id: data.user.id, created: true };
}

/** The on_auth_user_created trigger already made a profile with role 'customer'. */
async function setProfileRole(userId, role) {
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(`setProfileRole: ${error.message}`);
}

async function ensureAccount(spec, userId) {
  const { data: found, error: e1 } = await admin
    .from("business_accounts")
    .select("id")
    .eq("name", spec.businessName);
  if (e1) throw new Error(`lookup account: ${e1.message}`);

  let accountId = found?.[0]?.id;
  if (!accountId) {
    const { data, error } = await admin
      .from("business_accounts")
      .insert({
        name: spec.businessName,
        slug: `e2e-${spec.key}-${Date.now().toString(36)}`,
        status: "active",
        created_by: userId,
        notes: `${E2E_MARKER} synthetic fixture`,
      })
      .select("id");
    if (error) throw new Error(`insert account: ${error.message}`);
    accountId = data[0].id;
  }

  const { data: mem, error: e2 } = await admin
    .from("business_members")
    .select("id")
    .eq("business_account_id", accountId)
    .eq("user_id", userId);
  if (e2) throw new Error(`lookup member: ${e2.message}`);
  if (mem.length === 0) {
    const { error } = await admin.from("business_members").insert({
      business_account_id: accountId,
      user_id: userId,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    });
    if (error) throw new Error(`insert member: ${error.message}`);
  }

  return accountId;
}

async function seed() {
  const tag = `r${Date.now().toString(36)}`;
  const password = generatePassword();
  const users = {};

  for (const base of Object.values(USERS)) {
    const spec = base.pristine ? { ...base, email: runScoped(base.email, tag) } : base;
    const { id, created } = await ensureUser(spec, password);
    await setProfileRole(id, spec.profileRole);
    const accountId = spec.seedAccount ? await ensureAccount(spec, id) : null;
    users[spec.key] = { email: spec.email, userId: id, accountId };
    console.log(
      `  ${created ? "created  " : "refreshed"}  ${spec.key.padEnd(13)} ${spec.email}` +
        `  role=${spec.profileRole}${spec.privileged ? " [PRIVILEGED]" : ""}` +
        `${spec.pristine ? "  (run-unique)" : ""}${spec.confirmed ? "" : "  (UNCONFIRMED by design)"}`
    );
  }

  // The password lives ONLY here, and only for this run.
  writeFileSync(STATE, JSON.stringify({ tag, password, users }, null, 2), { mode: 0o600 });
  chmodSync(STATE, 0o600);
  console.log(`  wrote e2e/.state.json (mode 0600) — run password is generated, never committed`);
  return users;
}

/* --------------------------------------------------------------- cleanup */

/**
 * Removes every synthetic user and every row this identity is permitted to
 * remove, and reports honestly about what it could not.
 *
 * It does NOT print "done" over swallowed failures. `service_role` has no
 * DELETE on couranr_merchant_workspaces or couranr_delivery_requests by design,
 * and business_accounts is shielded by a RESTRICT foreign key, so those must be
 * reported as requiring manual cleanup rather than silently skipped.
 */
export async function cleanupAll({ quiet = false } = {}) {
  const report = {
    authUsersRemoved: [],
    dbRowsRemoved: {},
    couldNotRemove: [],
    manualCleanupRequired: [],
    errors: [],
    // Residue that exists BECAUSE of the append-only design, not because
    // cleanup misbehaved. Kept separate so a real cleanup bug is never hidden
    // behind an expected limitation.
    appendOnlyResidue: [],
    privilegedRemaining: [],
  };
  const APPEND_ONLY = /permission denied for table (couranr_merchant_workspaces|couranr_delivery_requests|couranr_delivery_request_events)|violates foreign key constraint "couranr_mw_account_fk"/;
  const log = (m) => { if (!quiet) console.log(m); };

  // 1. Rows hanging off the marked business accounts, deepest first.
  let accounts = [];
  try {
    const { data, error } = await admin
      .from("business_accounts")
      .select("id,name")
      .like("name", "%[E2E]%");
    if (error) throw new Error(error.message);
    accounts = data ?? [];
  } catch (e) {
    report.errors.push(`list business_accounts: ${e.message}`);
  }

  for (const acct of accounts) {
    for (const table of [
      "couranr_delivery_requests",
      "couranr_merchant_workspaces",
      "business_members",
      "business_accounts",
    ]) {
      // SELECT is granted even where DELETE is not, so ask whether there is
      // anything to remove BEFORE attempting it. Without this the denied DELETE
      // reports residue for a table that is already empty, which overstates
      // what actually needs the privileged path.
      if (table !== "business_accounts") {
        const { count: present, error: countErr } = await admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("business_account_id", acct.id);
        if (!countErr && (present ?? 0) === 0) {
          report.dbRowsRemoved[table] = report.dbRowsRemoved[table] ?? 0;
          continue; // nothing there; a denied DELETE would be a phantom finding
        }
      }

      const q = admin.from(table).delete();
      const { error, count } =
        table === "business_accounts"
          ? await q.eq("id", acct.id).select("id", { count: "exact" })
          : await q.eq("business_account_id", acct.id).select("id", { count: "exact" });

      if (error) {
        const expected = APPEND_ONLY.test(error.message);
        (expected ? report.appendOnlyResidue : report.couldNotRemove).push(
          `${table} (account ${acct.name}): ${error.message}`
        );
        report.manualCleanupRequired.push(
          `${table} rows for business_account ${acct.id} — privileged path required` +
            (expected ? " (append-only by design; see PROPOSED_couranr_e2e_cleanup.sql.review)" : "")
        );
      } else {
        report.dbRowsRemoved[table] = (report.dbRowsRemoved[table] ?? 0) + (count ?? 0);
      }
    }
  }

  // 2. Every synthetic auth user, found by metadata OR prefix — never by a
  //    static list, so run-unique addresses and privileged fixtures are caught.
  let synthetic = [];
  try {
    synthetic = await listSyntheticUsers();
  } catch (e) {
    report.errors.push(`listSyntheticUsers: ${e.message}`);
  }
  for (const u of synthetic) {
    try {
      await deleteUser(u.id);
      report.authUsersRemoved.push(u.email ?? u.id);
    } catch (e) {
      // A user pinned by an append-only row is the same expected limitation.
      const pinned = /Database error deleting user/.test(e.message);
      (pinned ? report.appendOnlyResidue : report.couldNotRemove).push(
        `auth user ${u.email ?? u.id}: ${e.message}`
      );
      report.manualCleanupRequired.push(`auth user ${u.email ?? u.id} — privileged path required`);
    }
  }

  // 3. Residue check — the authority on whether cleanup actually worked.
  try {
    const left = await listSyntheticUsers();
    // PRIVILEGED fixtures surviving is never acceptable and never "expected".
    report.privilegedRemaining = left
      .filter((u) => ["ops", "driver"].includes(u.user_metadata?.fixture))
      .map((u) => u.email ?? u.id);
    if (report.privilegedRemaining.length > 0) {
      report.couldNotRemove.push(
        `PRIVILEGED fixture(s) still present: ${report.privilegedRemaining.join(", ")}`
      );
    }
    const benign = left.length - report.privilegedRemaining.length;
    if (benign > 0) report.appendOnlyResidue.push(`${benign} non-privileged synthetic user(s) still present`);
  } catch (e) {
    report.errors.push(`residue check: ${e.message}`);
  }

  if (existsSync(fileURLToPath(STATE))) rmSync(fileURLToPath(STATE), { force: true });

  // `ok` = cleanup itself behaved. `fullyClean` = nothing at all is left.
  report.ok = report.couldNotRemove.length === 0 && report.errors.length === 0;
  report.privilegedClean = report.privilegedRemaining.length === 0;
  report.fullyClean = report.ok && report.appendOnlyResidue.length === 0;

  log("\n  cleanup report");
  log(`    auth users removed      : ${report.authUsersRemoved.length}` +
      (report.authUsersRemoved.length ? ` (${report.authUsersRemoved.join(", ")})` : ""));
  const rows = Object.entries(report.dbRowsRemoved).filter(([, n]) => n > 0);
  log(`    database rows removed   : ${rows.length ? rows.map(([t, n]) => `${t}=${n}`).join(", ") : "0"}`);
  log(`    could NOT be removed    : ${report.couldNotRemove.length}` +
      (report.couldNotRemove.length ? "  <-- REAL cleanup failure" : ""));
  for (const c of report.couldNotRemove) log(`        - ${c}`);
  log(`    append-only residue     : ${report.appendOnlyResidue.length}` +
      (report.appendOnlyResidue.length ? "  (expected: no DELETE grant by design)" : ""));
  for (const c of report.appendOnlyResidue) log(`        - ${c}`);
  log(`    PRIVILEGED fixtures left: ${report.privilegedRemaining.length}` +
      (report.privilegedRemaining.length ? "  <-- SECURITY FAILURE" : "  (none — good)"));
  log(`    manual cleanup required : ${report.manualCleanupRequired.length}`);
  for (const m of report.manualCleanupRequired) log(`        - ${m}`);
  if (report.errors.length) { log(`    errors:`); for (const e of report.errors) log(`        - ${e}`); }
  log(`    state file              : removed`);
  log(`    RESULT                  : ${report.fullyClean ? "fully clean" : report.ok ? "clean apart from append-only residue" : "INCOMPLETE"}`);

  return report;
}

async function report_() {
  const users = await listSyntheticUsers();
  if (users.length === 0) console.log("  no synthetic users present");
  for (const u of users) {
    const { data: p } = await admin.from("profiles").select("role").eq("id", u.id);
    const { data: m } = await admin.from("business_members").select("id").eq("user_id", u.id);
    console.log(
      `  ${(u.email ?? u.id).padEnd(52)} role=${p?.[0]?.role ?? "-"}` +
        `  confirmed=${Boolean(u.email_confirmed_at)}  memberships=${m?.length ?? "?"}`
    );
  }
  const { data: a } = await admin.from("business_accounts").select("id,name");
  console.log(`  business_accounts: ${a?.length ?? 0}${a?.length ? ` (${a.map((x) => x.name).join(", ")})` : ""}`);
}

/* ------------------------------------------------------------------ main */

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const cmd = process.argv[2] ?? "report";
  console.log(`[e2e seed] ${cmd} against ${SUPABASE_URL}  (key from ${KEY_SOURCE})`);

  const run = { seed, report: report_, clean: () => cleanupAll() }[cmd];
  if (!run) {
    console.error(`unknown command "${cmd}" — use seed | report | clean`);
    process.exit(1);
  }

  run().then(
    (r) => {
      // A cleanup that could not finish must NOT exit 0.
      if (cmd === "clean" && r && (r.ok === false || r.privilegedClean === false)) {
        console.error("[e2e seed] cleanup INCOMPLETE — see manual cleanup above");
        process.exit(1);
      }
      console.log("[e2e seed] done");
    },
    (e) => {
      console.error("[e2e seed] FAILED:", e.message);
      process.exit(1);
    }
  );
}
