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

/** The live (non-cancelled) obligation for a request, if any. */
export const obligationFor = (requestId) =>
  admin
    .from("couranr_payment_obligations")
    .select(
      "id,request_id,payer_type,amount_cents,currency,payment_state,version," +
        "provider_payment_intent_id,authorized_at,request_version,pricing_policy_version"
    )
    .eq("request_id", requestId)
    .neq("payment_state", "cancelled")
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`obligationFor: ${error.message}`);
      return data;
    });

/**
 * Flips a synthetic request to customer-paid.
 *
 * The merchant UI has no payer picker yet — PAY-001 says onboarding captures a
 * default and every delivery may go either way, but the per-delivery control
 * is not built. Setting the column directly on a SYNTHETIC row is the honest
 * way to reach the customer path today, and it is recorded here rather than
 * hidden inside the suite so the gap stays visible.
 */
export async function setPayerType(requestId, payerType) {
  const { error } = await admin
    .from("couranr_delivery_requests")
    .update({ payer_type: payerType })
    .eq("id", requestId);
  if (error) throw new Error(`setPayerType: ${error.message}`);
  return payerType;
}

/**
 * Issues a payment link for a request and returns the RAW token.
 *
 * Goes through the same command the app uses, so the token is generated and
 * hashed by the real code path; only the hash reaches the database.
 */
export async function issueLinkForRequest(requestId, businessAccountId) {
  const { createHash, randomBytes } = await import("node:crypto");
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");

  const { data: ob, error: obErr } = await admin.rpc("couranr_create_payment_obligation", {
    p_request_id: requestId,
    p_business_account_id: businessAccountId,
    p_idempotency_key: `e2e-link:${requestId}`,
  });
  if (obErr) throw new Error(`issueLinkForRequest/obligation: ${obErr.message}`);

  const { error } = await admin.rpc("couranr_issue_payment_access_token", {
    p_request_id: requestId,
    p_obligation_id: ob?.id ?? null,
    p_token_hash: hash,
    p_ttl_days: 7,
  });
  if (error) throw new Error(`issueLinkForRequest: ${error.message}`);
  return raw;
}
