/**
 * The Phase 8 acceptance matrix, RE-RUNNABLE, against a disposable database.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FIXES
 * ---------------------------------------------------------------------------
 *
 * `e2e/phase8Acceptance.mjs` passed 26/26 once against the connected project
 * and then had to be disarmed. Its own preflight refuses to seed what it cannot
 * remove, and `service_role` holds DELETE on no `couranr_*` table — they are
 * append-only by design — so the matrix could not be run a second time. Two
 * fixture chains had already been left beside 42 real orders and were purged by
 * hand.
 *
 * The wrong fixes were available and are not taken: granting production DELETE,
 * or applying `PROPOSED_couranr_e2e_cleanup.sql.review`. Both widen a
 * deliberately narrow grant to make a test easier.
 *
 * This is the right one. The matrix runs against a PostgreSQL created empty,
 * carrying every forward migration, fronted by a real PostgREST and a real Next
 * server — and destroyed afterwards, so cleanup is `rm -rf` rather than a
 * privilege. Nothing about the CHECKS changes: `phase8Acceptance.mjs` runs its
 * own assertions unmodified, in the same order, against the same functions.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 * It exercises the disposable stack, not the connected project. The schema is
 * the same — every forward migration, plus `bootstrap.sql` reproducing
 * `pg_default_acl` and `service_role BYPASSRLS`, without which a privilege
 * assertion means nothing — but a defect that exists only in the project's
 * out-of-band state would not be found here. Say so wherever a run is cited.
 *
 * Run:  node e2e/disposable/acceptanceMatrix.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import {
  startPostgrest,
  startGateway,
  waitForPostgrest,
  SERVICE_ROLE_JWT,
  ANON_JWT,
} from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = ".next-disposable";
const PORT = 3313;
const BASE = `http://127.0.0.1:${PORT}`;
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const sql = (q) => psql(q).trim();

async function run() {
  console.log("Phase 8 acceptance matrix — disposable, re-runnable\n");

  let pgrst;
  let gateway;
  let devServer;
  let outcome = { total: 0, failed: 1 };

  try {
    console.log("  bringing up the disposable database...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);

    pgrst = startPostgrest({
      dbUrl: dbUrl(),
      binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();
    console.log(`  gateway at ${gateway.url}`);

    // The matrix needs two profiles that a fresh database does not have:
    // `makeDelivery` picks any profile to own its request, and A6 plants a
    // colliding internal note as an `admin`. Seeded here rather than inside the
    // matrix so the matrix keeps working unchanged against the project, where
    // both already exist.
    const ownerId = sql(
      `insert into auth.users (email) values ('p8acc-owner@couranr.invalid') returning id`
    );
    sql(
      `insert into public.profiles (id, email, role)
       values ('${ownerId}', 'p8acc-owner@couranr.invalid', 'customer')`
    );
    const adminId = sql(
      `insert into auth.users (email) values ('p8acc-ops@couranr.invalid') returning id`
    );
    sql(
      `insert into public.profiles (id, email, role)
       values ('${adminId}', 'p8acc-ops@couranr.invalid', 'admin')`
    );
    console.log("  seeded one customer profile and one admin profile");

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
    };

    const reuse = process.env.COURANR_REUSE_BUILD === "1";
    if (reuse && !process.env.COURANR_DISPOSABLE_JWT_SECRET) {
      throw new Error(
        "COURANR_REUSE_BUILD=1 requires COURANR_DISPOSABLE_JWT_SECRET — the anon key is inlined at build time"
      );
    }
    if (!reuse) {
      rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
      // ALSO the default .next. tsconfig includes `.next/types/**/*.ts`, so a
      // build into a DIFFERENT distDir still type-checks whatever route types a
      // previous build left there — and never regenerates them. A stale
      // `.next/types/app/page.ts` for a route that has since moved into the
      // (couranr) group fails the disposable build with TS2307 on a file nobody
      // edited. Measured: `rm -rf .next` is the difference between red and green.
      rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
      console.log("  building the application against the disposable stack...");
      execFileSync("npx", ["next", "build"], {
        cwd: ROOT,
        env: { ...env, COURANR_DIST_DIR: DIST },
        stdio: "ignore",
        timeout: 900_000,
      });
    } else {
      console.log("  REUSING the previous build (COURANR_REUSE_BUILD=1)");
    }

    console.log("  starting the application against it...");
    devServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      detached: true,
    });
    const deadline = Date.now() + 120_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        const r = await fetch(BASE, { redirect: "manual" });
        live = r.status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!live) throw new Error("the application did not start");

    console.log("\n  running the matrix...\n");
    process.env.E2E_SUPABASE_URL = gateway.url;
    process.env.E2E_SUPABASE_SERVICE_KEY = SERVICE_ROLE_JWT;
    process.env.E2E_BASE_URL = BASE;
    process.env.E2E_DISPOSABLE = "1";

    const { main } = await import("../phase8Acceptance.mjs");
    outcome = await main();
  } catch (e) {
    console.error(`\n  RUN FAILED: ${(e.stack || e.message || e).toString().slice(0, 600)}`);
  } finally {
    if (devServer) {
      try {
        process.kill(-devServer.pid, "SIGTERM");
      } catch {
        devServer.kill("SIGTERM");
      }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) {
      try {
        process.kill(pgrst.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    down({ quiet: true });
    console.log("\n  disposable database destroyed");
  }

  if (outcome.failed > 0) process.exitCode = 1;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    down({ quiet: true });
    process.exit(130);
  });
}

run().catch((e) => {
  console.error(e.stack || e.message || e);
  down({ quiet: true });
  process.exitCode = 1;
});
