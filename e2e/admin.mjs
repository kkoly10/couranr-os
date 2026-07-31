/**
 * Node-only privileged Supabase access for the browser harness.
 *
 * THE SECRET NEVER LEAVES THIS PROCESS. It is not passed to Chromium, not
 * exposed to `page.evaluate`, not placed in a URL, not logged, and not written
 * to `e2e/.state.json`. The browser only ever sees the publishable key, which
 * the page itself carries; `supabaseRelay.mjs` forwards the page's own headers
 * and never injects a credential of its own.
 *
 * Uses `@supabase/supabase-js` admin methods rather than hand-built
 * Authorization headers. Under the modern key contract a secret key is an API
 * key, not a user JWT — supabase-js sends it in the `apikey` header, which is
 * what the Data API expects. Hand-rolling `Authorization: Bearer <secret>` is
 * the pattern to avoid.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fileEnv() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    /* process.env only */
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const FILE = fileEnv();
const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n] ?? FILE[n];
    if (v) return v;
  }
  return undefined;
};

export const SUPABASE_URL = pick("NEXT_PUBLIC_SUPABASE_URL");

/**
 * The harness gets its OWN key, separate from the application backend's, so it
 * can be rotated or revoked without touching production. Legacy names are
 * accepted only during the migration window.
 */
const E2E_SECRET = pick(
  "SUPABASE_E2E_SECRET_KEY",
  // --- temporary migration fallbacks; remove once Vercel is on the new names
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
);

export const PUBLISHABLE_KEY = pick(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
);

if (!SUPABASE_URL || !E2E_SECRET) {
  // Names only, never values.
  console.error(
    "[e2e] missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_E2E_SECRET_KEY " +
      "(migration fallbacks: SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY)"
  );
  process.exit(2);
}

/** Which name actually supplied the key — reported WITHOUT the value. */
export const KEY_SOURCE = process.env.SUPABASE_E2E_SECRET_KEY ?? FILE.SUPABASE_E2E_SECRET_KEY
  ? "SUPABASE_E2E_SECRET_KEY"
  : process.env.SUPABASE_SECRET_KEY ?? FILE.SUPABASE_SECRET_KEY
    ? "SUPABASE_SECRET_KEY (migration fallback)"
    : "SUPABASE_SERVICE_ROLE_KEY (legacy fallback)";

export const admin = createClient(SUPABASE_URL, E2E_SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------------ users */

/**
 * Every synthetic user, found by metadata OR email prefix.
 *
 * Both, deliberately. Metadata alone misses a user whose creation raced the
 * metadata write; the prefix alone misses nothing today but would if a fixture
 * were ever created by hand. Run-unique `+tag` addresses match the prefix, so
 * no static list of fixture emails is involved anywhere in discovery.
 */
export async function listSyntheticUsers() {
  const found = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      const byMeta = u.user_metadata?.e2e === true || u.user_metadata?.marker === "couranr-e2e";
      const byPrefix = (u.email ?? "").toLowerCase().startsWith("couranr-e2e");
      if (byMeta || byPrefix) found.set(u.id, u);
    }
    if (users.length < 200) break;
  }
  return [...found.values()];
}

export async function deleteUser(id) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
}
