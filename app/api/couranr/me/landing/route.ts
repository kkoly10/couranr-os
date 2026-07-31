import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";
import { isProfileRole, resolveLanding, type LandingFacts } from "@/lib/couranr/auth/landing";

export const dynamic = "force-dynamic";

const OPERATION = "getLanding";

/**
 * GET — where this caller belongs after signing in.
 *
 * Every input to the decision is established here, server-side, from a token
 * that `auth.getUser()` revalidated. The only thing the client contributes is
 * the raw `next` string, which is treated as hostile and may at most SELECT
 * among destinations the server already approved.
 *
 * FAILS CLOSED. Every lookup's error is checked, and any failure returns a
 * sanitized 500 with NO destination. An earlier version checked only the
 * profile query and let a failed membership lookup fall through as
 * `data: null` -> zero rows -> "this is a brand-new merchant", which would
 * have sent an established merchant to onboarding on a transient database
 * error. A database failure is not evidence of anything about the caller:
 * not zero memberships, not a missing workspace, not a new merchant, and not
 * a permission denial.
 *
 * There is no role parameter and no business-account parameter. A client that
 * sends one is ignored, not refused, because refusing would tell an attacker
 * which parameter names matter.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const [profileResult, membershipResult] = await Promise.all([
    supabaseAdmin.from("profiles").select("role").eq("id", user.userId).maybeSingle(),
    supabaseAdmin
      .from("business_members")
      .select("business_account_id")
      .eq("user_id", user.userId)
      .eq("status", "active"),
  ]);

  if (profileResult.error) {
    return routeInternalFailure({
      operation: OPERATION,
      // The driver error object goes to the LOG only. The route never
      // reads a field off it, so it cannot forward one by accident.
      detail: { lookup: "profiles", error: profileResult.error },
      message: "We could not load your account. Try again in a moment.",
    });
  }

  if (membershipResult.error) {
    return routeInternalFailure({
      operation: OPERATION,
      detail: { lookup: "business_members", error: membershipResult.error },
      message: "We could not load your account. Try again in a moment.",
    });
  }

  // Distinct from an error: a successful query that matched nothing. Only here
  // is "no rows" allowed to mean "no memberships".
  if (!Array.isArray(membershipResult.data)) {
    return routeInternalFailure({
      operation: OPERATION,
      detail: { lookup: "business_members", reason: "no error and no rows array" },
      message: "We could not load your account. Try again in a moment.",
    });
  }

  const rawRole = profileResult.data?.role;
  const facts: LandingFacts = {
    // An unrecognised value is treated as no role rather than trusted. The
    // database constraint permits only customer, driver and admin.
    role: isProfileRole(rawRole) ? rawRole : null,
    activeMembershipCount: membershipResult.data.length,
  };

  const decision = resolveLanding(facts, req.nextUrl.searchParams.get("next"));

  return NextResponse.json({
    destination: decision.destination,
    surface: decision.surface,
    usedNext: decision.usedNext,
    // A machine code, so the sign-in screen can explain a refused deep link
    // without echoing the attacker-supplied URL back into the page.
    rejectedNextReason: decision.rejectedNextReason ?? null,
  });
}
