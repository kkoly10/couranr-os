/**
 * Service-role data access for the browser suite.
 *
 * Exists so assertions can be made against ROWS rather than page text. The
 * storefront's own copy is not evidence: an onboarding page that created
 * nothing still renders, still says "Couranr", and still fails to contain the
 * word "error" — so a naive text grep scores it green. Every claim this suite
 * makes about persistence is backed by a row read back through here.
 *
 * The service-role key bypasses RLS, so every query below is scoped by hand.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    /* fall through */
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

export const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = loadEnv();

export async function api(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
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

export const rest = (p, init) => api(`/rest/v1/${p}`, init);

/** Every business account whose creator is this user. */
export const accountsCreatedBy = (userId) =>
  rest(`business_accounts?select=id,name,slug,status,created_by&created_by=eq.${userId}`);

/** Active memberships for a user, with the account name joined in. */
export const membershipsFor = (userId) =>
  rest(`business_members?select=id,role,status,business_account_id&user_id=eq.${userId}`);

export const workspacesFor = (accountId) =>
  rest(
    `couranr_merchant_workspaces?select=id,business_category,payer_default,policies_version,contact_phone,created_by&business_account_id=eq.${accountId}`
  );

export const requestsFor = (accountId) =>
  rest(
    `couranr_delivery_requests?select=id,request_state,version,delivery_subtotal_cents,payment_due_cents,created_by&business_account_id=eq.${accountId}&order=created_at.desc`
  );

/** Counts of the REAL production tables, so the suite can prove it touched none. */
export async function realDataCounts() {
  const one = async (t) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=id`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    const cr = res.headers.get("content-range") ?? "";
    return Number(cr.split("/")[1] ?? NaN);
  };
  return {
    orders: await one("orders"),
    deliveries: await one("deliveries"),
    addresses: await one("addresses"),
    rentals: await one("rentals"),
  };
}
