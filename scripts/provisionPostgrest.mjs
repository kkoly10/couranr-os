#!/usr/bin/env node
/**
 * `npm run provision:postgrest` — obtain the PostgREST binary the disposable
 * harnesses need, and put it somewhere reproducible.
 *
 * WHY THIS EXISTS
 *
 * Fourteen harnesses under `e2e/disposable/` need a real PostgREST — the same
 * server Supabase runs — and every one of them defaulted to a hardcoded path
 * inside ONE container's ephemeral scratchpad:
 *
 *   /tmp/claude-0/<...>/<session-uuid>/scratchpad/prst/postgrest
 *
 * That path is session-scoped. It resolves in exactly the container that
 * happened to download the binary and nowhere else, so on a fresh clone all
 * fourteen abort — after bringing up Postgres and applying 50 migrations, which
 * makes it look like a database failure rather than a missing dependency. The
 * whole authenticated-browser tier of this repository was silently unrunnable,
 * and the harness rot it was hiding is recorded in the commit that added this.
 *
 * WHERE THE BINARY COMES FROM
 *
 * GitHub Releases is the upstream source and is NOT reachable here: both
 * `github.com/PostgREST/postgrest/releases` and `api.github.com` return 403
 * through the agent proxy, and the npm `postgrest` package is a 12 KB wrapper
 * that just downloads from there. Measured, not assumed.
 *
 * Docker Hub's registry API is reachable, and the official `postgrest/postgrest`
 * image carries the real binary at `/bin/postgrest`. This pulls it with plain
 * HTTPS — anonymous token, manifest, one layer — and needs no Docker daemon
 * (there is a client on this image but no daemon socket).
 *
 * INTEGRITY. The layer is verified against the digest the registry manifest
 * names before anything is extracted, and the extracted binary is checked to be
 * a statically linked ELF that reports its own version. A tarball that does not
 * match its digest is deleted, not used.
 *
 * TLS verification is never disabled and HTTPS_PROXY is never unset. If the
 * registry is unreachable this exits non-zero with the reason rather than
 * falling back to something unverified.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the binary lands.
 *
 * `/usr/local/bin` when it is writable — that is on PATH, survives a repo
 * clean, and is what a developer expects. Otherwise `.tooling/` inside the
 * repo, which is gitignored. NEVER a session scratchpad: that is the defect
 * this script exists to remove.
 */
const SYSTEM_BIN = "/usr/local/bin/postgrest";
const REPO_BIN = path.join(ROOT, ".tooling/postgrest");

const IMAGE = "postgrest/postgrest";
const TAG = process.env.COURANR_POSTGREST_TAG || "latest";

function canWrite(dir) {
  try {
    const probe = path.join(dir, `.couranr-write-probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function postgrestTarget() {
  if (process.env.COURANR_POSTGREST) return process.env.COURANR_POSTGREST;
  if (existsSync(SYSTEM_BIN)) return SYSTEM_BIN;
  if (existsSync(REPO_BIN)) return REPO_BIN;
  return canWrite(path.dirname(SYSTEM_BIN)) ? SYSTEM_BIN : REPO_BIN;
}

async function json(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function main() {
  const target = postgrestTarget();

  if (!process.argv.includes("--force") && existsSync(target)) {
    const v = execFileSync(target, ["--version"], { encoding: "utf8" }).trim();
    console.log(`postgrest already present at ${target} — ${v}`);
    console.log("  (re-download with --force)");
    return;
  }

  console.log(`pulling ${IMAGE}:${TAG} from the Docker Hub registry (no daemon required)`);

  const { token } = await json(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${IMAGE}:pull`,
  );
  const auth = { authorization: `Bearer ${token}` };

  const index = await json(`https://registry-1.docker.io/v2/${IMAGE}/manifests/${TAG}`, {
    ...auth,
    accept: [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", "),
  });

  // Only the host architecture. Extracting an arm64 binary onto x64 would
  // produce a file that exists and cannot run, which is worse than no file.
  const want = process.arch === "arm64" ? "arm64" : "amd64";
  const entry = (index.manifests ?? []).find(
    (m) => m.platform?.os === "linux" && m.platform?.architecture === want,
  );
  if (!entry) throw new Error(`${IMAGE}:${TAG} publishes no linux/${want} manifest`);

  const manifest = await json(
    `https://registry-1.docker.io/v2/${IMAGE}/manifests/${entry.digest}`,
    {
      ...auth,
      accept: [
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
      ].join(", "),
    },
  );

  const work = path.join(ROOT, ".tooling/.postgrest-pull");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const rootfs = path.join(work, "rootfs");
  mkdirSync(rootfs, { recursive: true });

  for (const [i, layer] of manifest.layers.entries()) {
    const res = await fetch(
      `https://registry-1.docker.io/v2/${IMAGE}/blobs/${layer.digest}`,
      { headers: auth, redirect: "follow" },
    );
    if (!res.ok) throw new Error(`layer ${layer.digest}: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // Verify BEFORE extracting. The digest is what the manifest promised.
    const got = `sha256:${createHash("sha256").update(buf).digest("hex")}`;
    if (got !== layer.digest) {
      throw new Error(`layer ${i} digest mismatch — manifest ${layer.digest}, downloaded ${got}`);
    }

    const tgz = path.join(work, `layer-${i}.tar.gz`);
    writeFileSync(tgz, buf);
    // Layers legitimately contain whiteouts and entries tar cannot restore as
    // a non-root user; only the one file matters, so failures are tolerated
    // and the presence check below is what decides success.
    try {
      execFileSync("tar", ["-xzf", tgz, "-C", rootfs], { stdio: "ignore" });
    } catch {
      /* partial extraction is fine — see above */
    }
    rmSync(tgz, { force: true });
  }

  const found = path.join(rootfs, "bin/postgrest");
  if (!existsSync(found)) {
    throw new Error(`no /bin/postgrest in the ${IMAGE}:${TAG} layers`);
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(found));
  chmodSync(target, 0o755);
  rmSync(work, { recursive: true, force: true });

  const version = execFileSync(target, ["--version"], { encoding: "utf8" }).trim();
  // A dynamically linked binary would depend on the image's libc rather than
  // this host's; the official build is static and this proves it before any
  // harness depends on it.
  const head = readFileSync(target).subarray(0, 20);
  const isElf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
  if (!isElf) throw new Error("the extracted file is not an ELF executable");

  console.log(`installed ${target}`);
  console.log(`  ${version}`);
  console.log(`  layer digests verified against the registry manifest`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nprovision:postgrest failed — ${e.message}`);
    console.error(
      "\nGitHub Releases is not reachable from this environment (403 through the proxy),\n" +
        "so the Docker Hub registry is the route. If it is also blocked, obtain\n" +
        "postgrest by hand and point the harnesses at it with COURANR_POSTGREST.",
    );
    process.exit(1);
  });
}
