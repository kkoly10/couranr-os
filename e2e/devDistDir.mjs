/**
 * An isolated Next output directory for any harness that starts a Next server,
 * removed on every exit path this process can observe.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * `next dev` generates route types into `<distDir>/dev/types/`, and `validator.ts`
 * there is written incrementally. Three harnesses started `next dev` with NO
 * distDir override, so it went to the developer's `.next`, and all three kill
 * the server with SIGKILL — which lands mid-write. `tsconfig.json` includes
 * `.next/dev/types/**\/*.ts`, so the next `npm run typecheck` or `npm run build`
 * failed on a truncated file nobody edited:
 *
 *     .next/dev/types/validator.ts(2456,32): error TS1005: ';' expected.
 *
 * Measured, not reasoned: it took `rm -rf .next` to clear, and it turned a
 * green tiers-1-2 gate red in the middle of a verification run.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH HALVES
 * ---------------------------------------------------------------------------
 *
 * Isolation alone would be enough for `.next`, and cleanup alone would be
 * enough on the paths a process can observe. Neither is enough by itself:
 *
 *   * Isolation keeps the developer's `.next` untouched, so a harness that dies
 *     without running a handler cannot leave a truncated validator in the path
 *     a normal `npm run typecheck` reads. Measured: with COURANR_DIST_DIR set,
 *     `.next` is never created at all.
 *
 *   * Cleanup is what keeps the working tree deterministic run to run,
 *     including the failure path, which is the one that actually leaves debris.
 *
 * AND A THIRD THING, found by running it rather than by reasoning: **Next
 * rewrites `tsconfig.json`**. Starting a server with a new `distDir` appends
 * that directory's `types/**\/*.ts` and `dev/types/**\/*.ts` to `include`, so
 * an isolated directory becomes type-checked the moment the server starts.
 * Isolation by directory name can therefore never hold on its own — the first
 * version of this module claimed it did, and `git diff tsconfig.json` after a
 * single run disproved it. Cleanup restores the file, surgically: it removes
 * only include entries naming THIS dist dir, and only writes when the result is
 * byte-identical to the snapshot taken at claim time. A concurrent edit by
 * anything else is left alone and reported.
 *
 * `tsconfig.json` is NOT relaxed to ignore generated types. `.next/types` and
 * `.next-disposable/types` stay type-checked; a real build's route types are
 * still a gate. What changes is only WHERE a dev server writes, and that the
 * entry it adds for itself does not outlive it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT COVER
 * ---------------------------------------------------------------------------
 *
 * SIGKILL to the harness itself. No handler runs, so both the directory and the
 * `tsconfig.json` entry Next added for it survive. `.next` is still untouched,
 * so an ordinary typecheck is unaffected unless the killed server also left a
 * partial file in its own directory. Nothing in a JS process can cover SIGKILL;
 * this is stated rather than papered over.
 */
import { readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One gitignored parent for every harness dist dir, so `.gitignore` needs one
 * entry and a stray directory is obvious for what it is.
 */
export const DEV_DIST_ROOT = ".next-devharness";

/**
 * Claims `<root>/.next-devharness/<name>` for this process and registers its
 * removal.
 *
 * Returns `{ rel, abs, cleanup }`. Pass `rel` as `COURANR_DIST_DIR` in the
 * server's env — `next.config.js` maps that to `distDir` — and call `cleanup()`
 * in the harness's own `finally` so the directory is gone before the process
 * reports its result.
 */
export function claimDevDistDir(name) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`claimDevDistDir: name must be kebab-case, got ${JSON.stringify(name)}`);
  }
  const rel = `${DEV_DIST_ROOT}/${name}`;
  const abs = path.join(ROOT, rel);
  const tsconfigPath = path.join(ROOT, "tsconfig.json");

  // Snapshot BEFORE the server starts, so the restore target is the committed
  // file rather than whatever Next has already appended.
  let tsconfigSnapshot = null;
  try {
    tsconfigSnapshot = readFileSync(tsconfigPath, "utf8");
  } catch {
    /* no tsconfig to protect */
  }

  const restoreTsconfig = () => {
    if (tsconfigSnapshot === null) return;
    let current;
    try {
      current = readFileSync(tsconfigPath, "utf8");
    } catch {
      return;
    }
    if (current === tsconfigSnapshot) return;
    // Drop only the include lines that name THIS dist dir, then repair the
    // comma on the new last entry. Anything else that changed is somebody
    // else's edit and must survive.
    const kept = current
      .split("\n")
      .filter((line) => !new RegExp(`^\\s*"${rel}/[^"]*",?\\s*$`).test(line));
    const repaired = kept
      .join("\n")
      .replace(/,(\s*\n\s*\])/g, "$1");
    if (repaired === tsconfigSnapshot) {
      writeFileSync(tsconfigPath, tsconfigSnapshot);
      return;
    }
    console.warn(
      `  note: tsconfig.json changed in a way this harness did not make; leaving it alone. ` +
        `If a later typecheck fails on ${rel}, remove that include entry by hand.`,
    );
  };

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      rmSync(abs, { recursive: true, force: true });
      // And the shared parent, but only while it is empty — a concurrent
      // harness's directory must survive. rmdir refuses a non-empty directory,
      // which is exactly the check wanted, so the throw is the guard.
      rmdirSync(path.join(ROOT, DEV_DIST_ROOT));
    } catch {
      /* a leftover directory is inert once its tsconfig entry is gone */
    }
    restoreTsconfig();
  };

  // `exit` covers the normal return, an explicit process.exit(n), AND an
  // uncaught exception (Node prints it, then exits, and exit listeners run).
  process.once("exit", cleanup);

  // A signal terminates without running `exit` listeners, so it needs its own
  // handler. Registering one REPLACES the default terminate, so it is only
  // added when nothing else is listening — otherwise this module would suppress
  // a harness's own teardown, or hang a process that expected to die here.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    if (process.listenerCount(sig) === 0) {
      process.once(sig, () => {
        cleanup();
        process.exit(130);
      });
    }
  }

  return { rel, abs, cleanup };
}
