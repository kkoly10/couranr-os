#!/usr/bin/env node
/**
 * `npm run ci:local` — the whole gate, run HERE, because GitHub Actions is not
 * a dependable gate on this repository.
 *
 * WHY THIS EXISTS. The account's Actions allowance is exhausted most months.
 * When it is, workflow runs fail for BILLING reasons that look exactly like
 * code failures in the checks UI, or they do not start at all — and a check
 * that never ran looks the same as a check that passed if you only glance at
 * the PR. Neither state says anything about the code. So CI is treated here as
 * a courtesy signal, never as the gate, and this script is the gate.
 *
 * It runs a superset of `.github/workflows/ci.yml`. Everything that workflow
 * does is TIER 1 below. Everything else is work CI could not do even with
 * budget: the repository's own `check:*` gates, the disposable-PostgreSQL
 * suites, and the browser gates, which need Supabase and Stripe credentials the
 * runner does not have.
 *
 * TWO RULES IT ENFORCES ON ITSELF, both from defects this repository already
 * shipped:
 *
 *   1. NEVER SILENTLY SKIP. Every stage either runs or is reported as skipped
 *      WITH ITS REASON, and the final summary prints the skipped list before
 *      the verdict. A gate that quietly does nothing is worse than no gate,
 *      because it reads as a pass.
 *
 *   2. READ THE COUNTS, NOT JUST THE EXIT CODE. A stale `node_modules` once
 *      dropped 84 test files while vitest still printed "passed" and exited 0.
 *      The test stage parses `Test Files X passed (Y)` and fails unless X === Y.
 *
 * Usage:
 *   npm run ci:local              tiers 1–2 — no external process needed
 *   npm run ci:local -- --db      adds the disposable-PostgreSQL suites
 *   npm run ci:local -- --browser adds the Playwright gates (needs a build)
 *   npm run ci:local -- --all     everything
 *   npm run ci:local -- --list    print the stages and exit
 *   npm run ci:local -- --self-test  prove this script can go red
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

/** The same resolution order `scripts/provisionPostgrest.mjs` uses. */
function postgrestPresent() {
  const candidates = [
    process.env.COURANR_POSTGREST,
    "/usr/local/bin/postgrest",
    path.join(ROOT, ".tooling/postgrest"),
  ].filter(Boolean);
  return candidates.some((c) => existsSync(c));
}
const want = {
  db: argv.includes("--db") || argv.includes("--all"),
  browser: argv.includes("--browser") || argv.includes("--all"),
};

/**
 * A stage is `{ tier, name, run, why, needs }`.
 *
 * `needs` returns null when the stage can run, or a STRING REASON when it
 * cannot. The reason is printed; the stage is never dropped without one.
 */
const STAGES = [
  /* ── TIER 1 — exactly what .github/workflows/ci.yml runs ─────────────── */
  {
    tier: 1,
    name: "lockfile in sync",
    // CI runs `npm ci`, whose whole point is that a desynced lockfile fails
    // rather than being silently resolved away. `--dry-run` asks the same
    // question without spending two minutes rewriting node_modules.
    run: ["npm", ["ci", "--dry-run", "--ignore-scripts"]],
    why: "ci.yml: npm ci",
  },
  { tier: 1, name: "lint", run: ["npm", ["run", "lint"]], why: "ci.yml: npm run lint" },
  { tier: 1, name: "typecheck", run: ["npm", ["run", "typecheck"]], why: "ci.yml: npm run typecheck" },
  {
    tier: 1,
    name: "unit tests",
    run: ["npm", ["run", "test:run"]],
    why: "ci.yml: npm run test:run",
    // See rule 2 in this file's header.
    assert: (out) => {
      const m = out.match(/Test Files\s+(\d+) passed \((\d+)\)/);
      if (!m) return "could not find vitest's `Test Files X passed (Y)` line — did the run abort?";
      const [, passed, total] = m;
      if (passed !== total) return `${passed} of ${total} test FILES passed — ${Number(total) - Number(passed)} did not run or failed`;
      return null;
    },
  },
  { tier: 1, name: "build", run: ["npm", ["run", "build"]], why: "ci.yml: npm run build" },

  /* ── TIER 2 — gates CI does not run at all ───────────────────────────── */
  { tier: 2, name: "typecheck:canonical", run: ["npm", ["run", "typecheck:canonical"]], why: "strict mode for the canonical trees" },
  { tier: 2, name: "check:routes", run: ["npm", ["run", "check:routes"]], why: "no ungated canonical API route" },
  { tier: 2, name: "check:legacy-imports", run: ["npm", ["run", "check:legacy-imports"]], why: "canonical code imports no legacy module" },
  { tier: 2, name: "check:mocks", run: ["npm", ["run", "check:mocks"]], why: "every root PNG accounted for" },
  { tier: 2, name: "check:images", run: ["npm", ["run", "check:images"]], why: "every marketing derivative is current with its accepted source" },
  { tier: 2, name: "check:migrations", run: ["npm", ["run", "check:migrations"]], why: "no destructive migration" },
  { tier: 2, name: "check:visual-system", run: ["npm", ["run", "check:visual-system"]], why: "§27.0/§27.1 re-derived from the spec" },
  { tier: 2, name: "check:visual-registry", run: ["npm", ["run", "check:visual-registry"]], why: "66/66 screens, dimensions match their files" },
  { tier: 2, name: "check:drift-ledger", run: ["npm", ["run", "check:drift-ledger"]], why: "the PUB-001 region ledger is well-formed" },
  {
    tier: 2,
    name: "check:gates:controls",
    run: ["npm", ["run", "check:gates:controls"]],
    why: "every gate proves it can go RED — the check on the checks",
  },

  /* ── TIER 3 — disposable PostgreSQL ──────────────────────────────────── */
  ...[
    ["db:test", "every couranr_* command executed against a real row"],
    ["check:rls", "table privileges, not just policies"],
    ["test:deploy-safety", "deployment safety substrate"],
    ["test:release", "release authorization"],
    ["test:release:route", "release route"],
    ["test:idempotency", "idempotency substrate"],
    ["test:acceptance", "acceptance matrix"],
    ["test:messaging", "authenticated messaging"],
    ["test:auth-gateway", "auth gateway"],
    ["test:cus-fragments", "customer help fragments"],
  ].map(([script, why]) => ({
    tier: 3,
    name: script,
    run: ["npm", ["run", script]],
    why,
    needs: () => {
      if (!want.db) return "tier 3 not requested — pass --db or --all";
      // Every tier-3 suite spawns PostgREST. Without the binary each one dies
      // on an identical unhandled ENOENT — five stack traces that look like
      // five code failures and are one missing prerequisite. This container is
      // recycled without warning and the binary does not survive it.
      if (!postgrestPresent()) {
        return "postgrest binary is missing — run `npm run provision:postgrest` first";
      }
      return null;
    },
  })),

  /* ── TIER 4 — real browser ───────────────────────────────────────────── */
  {
    tier: 4,
    name: "retire stale servers",
    /* Every browser gate below "reuses the server already answering" on its
       port. That is a real trap, not a hypothetical: a long-lived `next start`
       holds the build it booted with IN MEMORY, so after tier 1 rebuilds
       `.next` the gates can measure the PREVIOUS build and pass. It cost a
       session once — an incremental build left the prerendered HTML pointing
       at CSS chunk names that no longer existed, the page rendered nearly
       unstyled, and the gates were still green because they were talking to
       the old server. So: nothing is left running into tier 4. */
    run: [
      "bash",
      [
        "-c",
        "pids=$(ps -eo pid,args | grep 'next-server' | grep -v grep | awk '{print $1}'); " +
          'if [ -n "$pids" ]; then echo "killing stale next-server: $pids"; kill $pids; sleep 2; ' +
          'else echo "no stale next-server running"; fi',
      ],
    ],
    why: "a live `next start` serves the build it booted with, not the one just built",
    needs: () => (want.browser ? null : "tier 4 not requested — pass --browser or --all"),
  },
  ...[
    ["test:pub001", "PUB-001 Gate B (six widths) and Gate C (axe, contrast)"],
    ["test:pub-family", "the same for PUB-008/009/010/011"],
    ["test:shell-chrome", "shell chrome across surfaces"],
    ["test:fonts", "the governed fonts actually render"],
  ].map(([script, why]) => ({
    tier: 4,
    name: script,
    run: ["npm", ["run", script]],
    why,
    needs: () => {
      if (!want.browser) return "tier 4 not requested — pass --browser or --all";
      if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
        return "no production build in .next — these gates serve `next start`, so run the build stage first";
      }
      return null;
    },
  })),
];

const TIERS = {
  1: "what GitHub Actions runs",
  2: "gates GitHub Actions does not run",
  3: "disposable PostgreSQL",
  4: "real browser",
};

if (argv.includes("--list")) {
  for (const t of [1, 2, 3, 4]) {
    console.log(`\nTIER ${t} — ${TIERS[t]}`);
    for (const s of STAGES.filter((s) => s.tier === t)) console.log(`  ${s.name.padEnd(24)} ${s.why}`);
  }
  process.exit(0);
}

if (argv.includes("--self-test")) {
  /* This script is a gate, so it has to prove it can go red — the same rule it
     runs `check:gates:controls` to enforce on everything else. */
  let bad = 0;
  const control = (what, got, expectFail) => {
    const failed = got !== null && got !== undefined;
    if (failed !== expectFail) {
      console.error(`ci:local self-test FAILED — ${what}: expected ${expectFail ? "a failure" : "a pass"}, got ${JSON.stringify(got)}`);
      bad++;
    } else {
      console.log(`ci:local self-test ok — ${what}${failed ? `: "${String(got).slice(0, 80)}"` : ""}`);
    }
  };

  const assertTests = STAGES.find((s) => s.name === "unit tests").assert;
  control("a vitest run that dropped test FILES is rejected", assertTests("Test Files  51 passed (53)"), true);
  control("a vitest run with every file passing is accepted", assertTests("Test Files  53 passed (53)"), false);
  control("a vitest run with no summary line at all is rejected", assertTests("boom"), true);

  // And a stage whose command exits non-zero must be recorded as a failure
  // rather than shrugged off.
  const r = spawnSync("node", ["-e", "process.exit(3)"], { cwd: ROOT, encoding: "utf8" });
  control("a stage that exits non-zero is a failure", r.status === 0 ? null : `exit ${r.status}`, true);

  process.exit(bad ? 1 : 0);
}

const ciYml = path.join(ROOT, ".github/workflows/ci.yml");
if (existsSync(ciYml)) {
  /* If ci.yml grows a step this script does not mirror, tier 1 has silently
     stopped being "what CI runs". Cheap to check, and the failure mode it
     guards is a local gate that believes it is a superset when it is not. */
  const steps = [...readFileSync(ciYml, "utf8").matchAll(/run:\s*(npm[^\n]*)/g)].map((m) => m[1].trim());
  const mirrored = STAGES.filter((s) => s.tier === 1).map((s) => s.why.replace(/^ci\.yml:\s*/, ""));
  const missing = steps.filter((s) => !mirrored.includes(s));
  if (missing.length) {
    console.log(`note: ci.yml runs ${missing.length} step(s) tier 1 does not mirror: ${missing.join(", ")}\n`);
  }
}

const started = Date.now();
const results = [];
const skipped = [];

for (const stage of STAGES) {
  const reason = stage.needs?.();
  if (reason) {
    skipped.push({ name: stage.name, reason });
    continue;
  }
  const [cmd, args] = stage.run;
  process.stdout.write(`── tier ${stage.tier} · ${stage.name} … `);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  let failure = r.status === 0 ? null : `exit ${r.status}`;
  if (!failure && stage.assert) failure = stage.assert(out);
  if (failure) {
    console.log(`FAIL (${secs}s) — ${failure}`);
    // The tail is where every runner in this repo puts its verdict.
    console.log(out.trim().split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
    results.push({ ...stage, ok: false, failure, secs });
  } else {
    console.log(`ok (${secs}s)`);
    results.push({ ...stage, ok: true, secs });
  }
}

const failed = results.filter((r) => !r.ok);
const elapsed = ((Date.now() - started) / 1000).toFixed(0);

console.log(`\n${"─".repeat(72)}`);
if (skipped.length) {
  console.log(`NOT RUN — ${skipped.length} stage(s). Green below does NOT cover these:`);
  for (const s of skipped) console.log(`  · ${s.name.padEnd(24)} ${s.reason}`);
  console.log("");
}
console.log(
  `ci:local — ${results.length - failed.length}/${results.length} stage(s) passed in ${elapsed}s` +
    (failed.length ? `\nFAILED: ${failed.map((f) => f.name).join(", ")}` : ""),
);
if (!failed.length && skipped.length) {
  console.log("Report what ran AND what did not; do not report this as a full pass.");
}
process.exit(failed.length ? 1 : 0);
