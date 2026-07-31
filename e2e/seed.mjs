/**
 * Seeds and tears down the synthetic identities the browser suite drives.
 *
 *   node e2e/seed.mjs seed     # create/refresh every fixture (idempotent)
 *   node e2e/seed.mjs report   # list what currently exists, change nothing
 *   node e2e/seed.mjs clean    # remove every marked row
 *
 * Uses the service-role key because it is the only identity that can create an
 * auth user or write a profile row. That key bypasses RLS entirely, so every
 * statement below is scoped by hand and every destructive statement is
 * additionally constrained to the E2E marker.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { E2E_MARKER, PASSWORD, USERS, WORKSPACE_SEED } from "./fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads .env.local without adding a dotenv dependency to the tree. */
function loadEnv() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    /* fall through to process.env */
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? out.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? out.SUPABASE_SERVICE_ROLE_KEY,
  };
}

const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = loadEnv();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function api(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

/** PostgREST helper against the public schema. */
const rest = (p, init) => api(`/rest/v1/${p}`, init);

/* ------------------------------------------------------------------ users */

async function findUserByEmail(email) {
  // The admin list endpoint filters on email exactly.
  const page = await api(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = Array.isArray(page) ? page : (page.users ?? []);
  return users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureUser(spec) {
  const existing = await findUserByEmail(spec.email);
  if (existing) {
    // Force the password and confirmation state back to the fixture's, so a
    // half-modified account from an earlier run cannot silently change a result.
    await api(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        password: PASSWORD,
        email_confirm: spec.confirmed,
      }),
    });
    return { id: existing.id, created: false };
  }
  const made = await api(`/auth/v1/admin/users`, {
    method: "POST",
    body: JSON.stringify({
      email: spec.email,
      password: PASSWORD,
      email_confirm: spec.confirmed,
      user_metadata: { e2e: true, marker: E2E_MARKER },
    }),
  });
  return { id: made.id, created: true };
}

/**
 * The on_auth_user_created trigger already inserted a profile with the default
 * role of 'customer'. Only drive it to the fixture's role.
 */
async function setProfileRole(userId, role) {
  await rest(`profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ role }),
  });
}

/* -------------------------------------------------------------- workspace */

async function ensureWorkspace(spec, userId) {
  const existing = await rest(
    `business_accounts?select=id,name&name=eq.${encodeURIComponent(spec.businessName)}`
  );
  let accountId = existing[0]?.id;

  if (!accountId) {
    const made = await rest(`business_accounts`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: spec.businessName,
        slug: `e2e-${spec.key}-${Date.now().toString(36)}`,
        status: "active",
        created_by: userId,
        notes: `${E2E_MARKER} synthetic fixture`,
      }),
    });
    accountId = made[0].id;
  }

  const member = await rest(
    `business_members?select=id&business_account_id=eq.${accountId}&user_id=eq.${userId}`
  );
  if (member.length === 0) {
    await rest(`business_members`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        business_account_id: accountId,
        user_id: userId,
        role: "owner",
        status: "active",
        joined_at: new Date().toISOString(),
      }),
    });
  }

  const ws = await rest(
    `couranr_merchant_workspaces?select=id&business_account_id=eq.${accountId}`
  );
  if (ws.length === 0) {
    await rest(`couranr_merchant_workspaces`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        business_account_id: accountId,
        created_by: userId,
        idempotency_key: `${E2E_MARKER}-${spec.key}-workspace`,
        business_category: WORKSPACE_SEED.businessCategory,
        pickup_address: WORKSPACE_SEED.pickupAddress,
        contact_phone: WORKSPACE_SEED.contactPhone,
        payer_default: WORKSPACE_SEED.payerDefault,
        policies_accepted_at: new Date().toISOString(),
        policies_version: WORKSPACE_SEED.policiesVersion,
      }),
    });
  }
  return accountId;
}

/* ---------------------------------------------------------------- actions */

/**
 * A run-unique address for a fixture that must start with no workspace.
 *
 * Deletion is not an option here: `service_role` has no DELETE on
 * couranr_merchant_workspaces or couranr_delivery_requests by design, and
 * business_accounts is protected from them by a RESTRICT foreign key. Minting a
 * new identity is cheaper than widening a deliberately narrow grant.
 */
function runScopedEmail(spec, tag) {
  return spec.email.replace("@", `+${tag}@`);
}

async function seed() {
  const result = {};
  const tag = `r${Date.now().toString(36)}`;
  for (const base of Object.values(USERS)) {
    // A pristine fixture gets a fresh address every run; the rest are stable.
    const spec = base.pristine ? { ...base, email: runScopedEmail(base, tag) } : base;
    const { id, created } = await ensureUser(spec);
    await setProfileRole(id, spec.profileRole);
    let accountId = null;
    if (spec.seedWorkspace) accountId = await ensureWorkspace(spec, id);
    result[spec.key] = { email: spec.email, userId: id, created, accountId };
    console.log(
      `  ${created ? "created" : "refreshed"}  ${spec.key.padEnd(13)} ${spec.email}` +
        `  role=${spec.profileRole}${accountId ? `  account=${accountId}` : ""}` +
        `${spec.confirmed ? "" : "  (UNCONFIRMED by design)"}`
    );
  }
  // run.mjs reads this so its assertions can scope by the real user ids.
  writeFileSync(
    new URL("./.state.json", import.meta.url),
    JSON.stringify({ tag, users: result }, null, 2)
  );
  console.log("  wrote e2e/.state.json");
  return result;
}

/**
 * Deletes ONLY rows carrying the marker. The delivery-request rows created by
 * the suite hang off the marked business account, so they go first.
 */
async function clean() {
  const accounts = await rest(
    `business_accounts?select=id,name&name=like.${encodeURIComponent("*[E2E]*")}`
  ).catch(() => []);

  for (const acct of accounts) {
    for (const table of [
      "couranr_delivery_request_events",
      "couranr_delivery_requests",
      "couranr_merchant_workspaces",
      "business_members",
    ]) {
      await rest(`${table}?business_account_id=eq.${acct.id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }).catch((e) => console.log(`    (skip ${table}: ${e.message.slice(0, 80)})`));
    }
    await rest(`business_accounts?id=eq.${acct.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    console.log(`  removed account ${acct.name}`);
  }

  for (const spec of Object.values(USERS)) {
    const u = await findUserByEmail(spec.email);
    if (!u) continue;
    await api(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    console.log(`  removed user ${spec.email}`);
  }
}

async function report() {
  for (const spec of Object.values(USERS)) {
    const u = await findUserByEmail(spec.email);
    if (!u) {
      console.log(`  ABSENT     ${spec.key.padEnd(13)} ${spec.email}`);
      continue;
    }
    const prof = await rest(`profiles?select=role&id=eq.${u.id}`);
    const mem = await rest(`business_members?select=business_account_id,role,status&user_id=eq.${u.id}`);
    console.log(
      `  present    ${spec.key.padEnd(13)} ${spec.email}  role=${prof[0]?.role}` +
        `  confirmed=${Boolean(u.email_confirmed_at)}  memberships=${mem.length}`
    );
  }
}

const cmd = process.argv[2] ?? "report";
const fns = { seed, clean, report };
if (!fns[cmd]) {
  console.error(`unknown command "${cmd}" — use seed | report | clean`);
  process.exit(1);
}
console.log(`[e2e seed] ${cmd} against ${SUPABASE_URL}`);
fns[cmd]().then(
  () => console.log("[e2e seed] done"),
  (e) => {
    console.error("[e2e seed] FAILED:", e.message);
    process.exit(1);
  }
);
