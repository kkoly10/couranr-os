/**
 * Row-level assertions for the browser suite.
 *
 * Exists so claims are made against ROWS rather than page text. An onboarding
 * page that created nothing still renders, still says "Couranr", and still
 * lacks the word "error" — so a naive text grep scores it green. Every
 * persistence claim in the suite is read back through here.
 *
 * Goes through `admin.mjs`, i.e. supabase-js with the harness's own secret key,
 * in Node only. No credential is constructed, logged or exported from here.
 */

import { admin } from "./admin.mjs";

const unwrap = (label) => ({ data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
};

export const accountsCreatedBy = (userId) =>
  admin
    .from("business_accounts")
    .select("id,name,slug,status,created_by")
    .eq("created_by", userId)
    .then(unwrap("accountsCreatedBy"));

export const membershipsFor = (userId) =>
  admin
    .from("business_members")
    .select("id,role,status,business_account_id")
    .eq("user_id", userId)
    .then(unwrap("membershipsFor"));

export const workspacesFor = (accountId) =>
  admin
    .from("couranr_merchant_workspaces")
    .select("id,business_category,payer_default,policies_version,contact_phone,created_by")
    .eq("business_account_id", accountId)
    .then(unwrap("workspacesFor"));

export const requestsFor = (accountId) =>
  admin
    .from("couranr_delivery_requests")
    .select("id,request_state,version,delivery_subtotal_cents,payment_due_cents,created_by")
    .eq("business_account_id", accountId)
    .order("created_at", { ascending: false })
    .then(unwrap("requestsFor"));

/** The full review-relevant shape of one request, read back from the row. */
export const requestById = (id) =>
  admin
    .from("couranr_delivery_requests")
    .select(
      "id,request_state,review_state,readiness_state,version,payer_type,quote_status," +
        "delivery_subtotal_cents,pricing_policy_version,payment_due_cents"
    )
    .eq("id", id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`requestById: ${error.message}`);
      return data;
    });

/** The append-only audit trail for one request, oldest first. */
export const eventsFor = (id) =>
  admin
    .from("couranr_delivery_request_events")
    .select("id,command,actor_type,from_state,to_state,metadata,created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .then(unwrap("eventsFor"));

/**
 * Exact counts of the REAL production tables, so the suite can prove it touched
 * none of them. `head: true` fetches the count without transferring rows.
 */
export async function realDataCounts() {
  const one = async (table) => {
    const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return count ?? -1;
  };
  return {
    orders: await one("orders"),
    deliveries: await one("deliveries"),
    addresses: await one("addresses"),
    rentals: await one("rentals"),
  };
}
