import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { looksLikeAnAddress } from "./send";

assertServerOnly("lib/couranr/email/recipients.ts");

/**
 * The ONE place a merchant send address is produced.
 *
 * WHY A WHOLE MODULE FOR ONE LOOKUP. At the call site of a merchant email the
 * lexical scope holds several email-shaped values and exactly one is correct.
 * `couranr_delivery_requests.recipient_email` is the CONSUMER's address and it
 * sits on the very row a merchant template's command has already loaded — and
 * because this repo compiles with `"strict": false` against row types of
 * `Record<string, any>`, writing `{ to: row.recipient_email }` compiles clean,
 * passes the shape check, and mails Couranr's decline reason to the customer.
 * Branded string types are inert under `strict: false`, so the defence cannot
 * live in the type system alone. It lives here: one minter, one negative list,
 * and an `audience` discriminant the sender checks at runtime.
 *
 * NEVER READ ANY OF THESE FOR SENDING TO A MERCHANT. Keep this list verbatim:
 *
 *   recipient_email          the CONSUMER's address on the delivery request
 *   invited_email            where an INVITE was sent, not where the person is.
 *                            settings/commands.ts:420 prefers it FIRST, which is
 *                            right for displaying a team list and wrong here.
 *   billing_email            0 of 2 rows populated and written by no application
 *                            code. Reads like the answer; is a decoy. Reserved
 *                            for MER-016 Billing settings.
 *   merchant_customers.email / .normalized_email      the merchant's customers.
 *
 * WHAT THIS DOES NOT YET DO. The owner's decision (2026-09-08) is that the
 * merchant chooses the address: "whoever email the merchant adds to the profile
 * is who receives it." That field DOES NOT EXIST — `couranr_merchant_workspaces`
 * stores a `contact_phone` and no email, and `updateWorkspaceProfile` accepts no
 * address. When it is built it belongs on `business_accounts.notification_email`,
 * because `business_accounts` has exactly one row per account while a workspace
 * is 0..1 — verified in production, where "Couranr Pilot Merchant" has ONE
 * delivery request and ZERO workspaces, so a workspace-hosted field would be
 * unreachable for the very account this first email is for.
 *
 * A typed address must be CONFIRMED before it becomes a send target, and the
 * confirmation mail must carry no delivery data, so that a one-character typo
 * teaches a stranger nothing but that someone typed their address. Until that
 * lands, this module resolves the owner's signup address — which Supabase
 * verified at signup — and clause (a) reading the confirmed column slots in
 * above the owner lookup without changing this contract.
 *
 * HOSTED REQUESTS ARE DIFFERENT and must not be bolted on here casually: they
 * carry `business_account_id IS NULL` while the merchant lives on
 * `couranr_hosted_request_intakes.host_business_account_id`. The first hosted
 * email must derive the account from the intake and pass it in — never read the
 * null column.
 */

/** A resolved merchant address, or a stated reason there is none. */
export type MerchantRecipient =
  | {
      audience: "merchant";
      businessAccountId: string;
      address: string;
      /** Which rule produced it. Becomes "notification_email" when the field lands. */
      source: "owner_login_email";
    }
  | {
      audience: "none";
      businessAccountId: string;
      reason: "no_active_owner" | "owner_has_no_email" | "address_malformed";
    };

/**
 * Resolve where operational mail for a business account should go.
 *
 * The parameter is NON-NULLABLE on purpose. A delivery request with a null
 * `business_account_id` is a consumer request, which has no merchant to resolve
 * — making that call unrepresentable is better than a runtime branch that skips
 * silently and reads like success.
 *
 * NEVER RETURNS NULL AND NEVER THROWS. A send is downstream of work that already
 * committed; failing to find an address must never fail the business operation.
 */
export async function resolveMerchantNotificationAddress(
  businessAccountId: string
): Promise<MerchantRecipient> {
  const none = (
    reason: "no_active_owner" | "owner_has_no_email" | "address_malformed"
  ): MerchantRecipient => ({ audience: "none", businessAccountId, reason });

  /* Ordered by created_at, NOT joined_at. `business_members.joined_at` is
     NULLABLE (verified against information_schema) and Postgres sorts NULLS
     LAST under ASC, so "earliest joined_at" is not a total order and the
     recipient would be nondeterministic between runs. `created_at` is NOT NULL,
     and is already how listTeamMembers orders. `id` breaks an exact tie so the
     answer is stable even for two rows written in the same microsecond.

     The schema permits more than one active owner: business_members is UNIQUE
     on (business_account_id, user_id) and the role index is NOT unique. */
  const owners = await supabaseAdmin
    .from("business_members")
    .select("user_id, created_at, id")
    .eq("business_account_id", businessAccountId)
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (owners.error || !Array.isArray(owners.data) || owners.data.length === 0) {
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "resolveMerchantNotificationAddress",
      code: "internal",
      /* LOUD. An account with no reachable owner is one Couranr structurally
         cannot contact — not a quiet skip. */
      detail: {
        reason: "no_active_owner",
        businessAccountId,
        error: owners.error?.message ?? null,
      },
    });
    return none("no_active_owner");
  }

  if (owners.data.length > 1) {
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "resolveMerchantNotificationAddress",
      code: "internal",
      detail: {
        reason: "multiple_active_owners_tie_broken",
        businessAccountId,
        count: owners.data.length,
      },
    });
  }

  for (const row of owners.data) {
    let user: any = null;
    try {
      const got = await supabaseAdmin.auth.admin.getUserById(String(row.user_id));
      user = got.data?.user ?? null;
    } catch {
      user = null;
    }
    if (!user) continue;

    /* A HARD delete cascades (business_members.user_id is ON DELETE CASCADE), so
       it cannot leave a dangling member row. A SOFT delete and a ban do NOT
       cascade — the member row survives and a naive query would happily mail a
       deactivated account. Both fields are on the admin User object. */
    if (user.deleted_at) continue;
    if (user.banned_until && Date.parse(String(user.banned_until)) > Date.now()) continue;

    const email = typeof user.email === "string" ? user.email.trim() : "";
    if (!email) continue;

    /* The sender's OWN check, imported rather than re-written. A second regex
       here is exactly how a resolver comes to accept a shape the sender then
       refuses. */
    if (!looksLikeAnAddress(email)) return none("address_malformed");

    return {
      audience: "merchant",
      businessAccountId,
      address: email,
      source: "owner_login_email",
    };
  }

  /* Every active owner was unusable: soft-deleted, banned, or without an
     address. auth.users.email is nullable — a phone-only or anonymous signup
     has none — so this is reachable, not defensive padding. */
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: "resolveMerchantNotificationAddress",
    code: "internal",
    detail: {
      reason: "owner_has_no_email",
      businessAccountId,
      ownersConsidered: owners.data.length,
    },
  });
  return none("owner_has_no_email");
}
