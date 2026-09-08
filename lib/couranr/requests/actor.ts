import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import type { PublicErrorCode } from "@/lib/couranr/errors";
import type { MemberRole, MemberStatus, Membership, RequestActor } from "./permissions";
import { canActOnDeliveryRequest, type RequestCapability } from "./permissions";

assertServerOnly("lib/couranr/requests/actor.ts");

/**
 * Resolves the caller of a delivery-request route into a `RequestActor`.
 *
 * SERVER ONLY. The module-scope guard trips in a browser bundle, and
 * `tests/couranr-server-only.test.ts` fails the build if a `"use client"` file
 * can reach here — the class of bug that put the `"use client"` browser client
 * into six server files and left `/api/delivery/complete` authenticating as
 * `anon`.
 *
 * The token is validated with `auth.getUser(token)`, which revalidates the JWT
 * against Supabase. It is never decoded locally and `getSession()` is not used.
 */

/**
 * The profile role that runs Couranr Operations.
 *
 * `profiles_role_check` on production permits only customer, driver and admin —
 * there is no `operations` value, and an earlier version of this file checked
 * for one, which was inert. Single source: lib/couranr/auth/landing.ts.
 */
const OPERATIONS_PROFILE_ROLES: readonly string[] = ["admin"];

/**
 * Carries a public error CODE, not an HTTP status: the status is derived once,
 * in `lib/couranr/errors.ts`, so a route cannot invent its own mapping.
 */
export type ActorDenied = { ok: false; code: PublicErrorCode; error: string };
export type ActorResolution =
  | { ok: true; actor: RequestActor; userId: string }
  | ActorDenied;

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does.
 */
export function isActorDenied(r: { ok: boolean }): r is ActorDenied {
  return r.ok === false;
}

/**
 * Business-scoped membership/capability gate. Returns an `ActorDenied` to reject,
 * or `null` to allow.
 *
 * This is the correct gate for a business route, replacing the DEAD
 * `actor.kind === "anonymous"` check: `resolveRequestActor` NEVER returns
 * `kind: "anonymous"` for a token-bearing caller — a signed-in non-member
 * resolves to `{ kind: "member", membership: null }` — so an anonymous check
 * admits any authenticated user. `canActOnDeliveryRequest` rejects
 * null-membership, wrong-business, inactive status, and (for write capabilities)
 * non-write roles.
 */
export function requireBusinessCapability(
  actor: RequestActor,
  capability: RequestCapability,
  businessAccountId: string | null
): ActorDenied | null {
  const decision = canActOnDeliveryRequest(actor, capability, businessAccountId);
  if (decision.allowed) return null;
  return {
    ok: false,
    code: "not_permitted",
    error: "You do not have access to this business.",
  };
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token === "" ? null : token;
}

/** Validates the Bearer token and returns the caller's user id. */
export async function resolveUserId(
  req: NextRequest
): Promise<{ ok: true; userId: string } | ActorDenied> {
  const token = bearerToken(req);
  if (!token) return { ok: false, code: "unauthenticated", error: "Sign in to continue." };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return {
      ok: false,
      code: "unauthenticated",
      error: "Your session has expired. Sign in again.",
    };
  }
  return { ok: true, userId: data.user.id };
}

/**
 * Resolves the actor for a request scoped to `businessAccountId`.
 *
 * Pass `businessAccountId` as null for Operations-only routes: no membership
 * is looked up, and a caller without an Operations profile role is refused.
 */
export async function resolveRequestActor(
  req: NextRequest,
  businessAccountId: string | null
): Promise<ActorResolution> {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, code: "unauthenticated", error: "Sign in to continue." };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return {
      ok: false,
      code: "unauthenticated",
      error: "Your session has expired. Sign in again.",
    };
  }
  const userId = userData.user.id;

  // Operations is resolved first: it reads and reviews across businesses, so a
  // missing membership row is not a reason to refuse it.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return { ok: false, code: "internal", error: "Could not verify your account." };
  }

  const isOperations = OPERATIONS_PROFILE_ROLES.includes(String(profile?.role ?? ""));

  if (businessAccountId === null) {
    if (!isOperations) {
      return { ok: false, code: "not_permitted", error: "Couranr Operations access required." };
    }
    return { ok: true, actor: { kind: "operations", userId }, userId };
  }

  /*
   * An explicit businessAccountId means the caller is asking to act in that
   * Business workspace. This matters for dual-role pilot users: an admin can
   * also be a real owner/manager/dispatcher. The old resolver always promoted
   * an admin profile to Operations first, so the same signed-in person could
   * never exercise their legitimate Business payer authority.
   *
   * We therefore resolve the membership first for an explicit business scope.
   * Operations remains a fallback only when no membership exists; Operations-
   * only routes pass null above and are unchanged.
   */
  const { data: member, error: memberError } = await supabaseAdmin
    .from("business_members")
    .select("business_account_id,user_id,role,status")
    .eq("business_account_id", businessAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    return { ok: false, code: "internal", error: "Could not verify your business access." };
  }

  const membership: Membership | null = member
    ? {
        businessAccountId: String(member.business_account_id),
        userId: String(member.user_id),
        role: member.role as MemberRole,
        status: member.status as MemberStatus,
      }
    : null;

  if (membership) {
    return { ok: true, actor: { kind: "member", userId, membership }, userId };
  }

  // Compatibility fallback for Operations callers that deliberately carry a
  // business id through a shared read route. Write/payment commands still run
  // their own capability checks, so this does not grant merchant authority.
  if (isOperations) {
    return { ok: true, actor: { kind: "operations", userId }, userId };
  }

  return { ok: true, actor: { kind: "member", userId, membership: null }, userId };
}

export type MembershipLookupFailed = { ok: false; detail: string };
export type MembershipLookup =
  | { ok: true; memberships: MembershipSummary[] }
  | MembershipLookupFailed;

/** `tsconfig` sets `"strict": false`; a bare `!r.ok` does not narrow. */
export function isMembershipLookupFailed(r: MembershipLookup): r is MembershipLookupFailed {
  return r.ok === false;
}

export type MembershipSummary = {
  businessAccountId: string;
  name: string;
  role: MemberRole;
  /**
   * The business's hosted-request link name. Null for a business that has no
   * slug yet — which is possible, because the column is nullable and predates
   * the workspace command that now always mints one.
   */
  slug: string | null;
};

/**
 * The businesses this user may act for. Used by the merchant screens, which
 * have no tenant in the URL — the server decides which account is in scope
 * rather than trusting a client-supplied id.
 *
 * FAILS CLOSED. This previously returned `[]` on error, which is
 * indistinguishable from "you belong to no businesses" — and the onboarding
 * screen reads exactly that to decide whether to offer workspace creation. A
 * transient database error would have invited an established merchant to
 * create a second workspace. The error is now propagated so the caller can
 * refuse rather than guess.
 */
export async function listActiveMemberships(userId: string): Promise<MembershipLookup> {
  const { data, error } = await supabaseAdmin
    .from("business_members")
    // `slug` is selected for MER-013: it is the merchant's hosted-request link
    // name, and it existed in the database (unique, populated on every live
    // account) while NO endpoint returned it. It is not a secret — it appears
    // in a public URL by design — but it is still tenant-scoped here by the
    // membership filter below, like every other field.
    .select("business_account_id,role,business_accounts(name,slug)")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) return { ok: false, detail: error.message };
  // A successful query always yields an array. Anything else is a driver
  // surprise, not an empty result.
  if (!Array.isArray(data)) return { ok: false, detail: "no error and no rows array" };

  return {
    ok: true,
    memberships: data.map((row: any) => ({
      businessAccountId: String(row.business_account_id),
      name: String(row.business_accounts?.name ?? "Business account"),
      role: row.role as MemberRole,
      slug: row.business_accounts?.slug ?? null,
    })),
  };
}
