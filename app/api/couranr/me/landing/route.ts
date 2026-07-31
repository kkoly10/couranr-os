import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { routeFailure } from "@/lib/couranr/requests/respond";
import { isProfileRole, resolveLanding, type LandingFacts } from "@/lib/couranr/auth/landing";

export const dynamic = "force-dynamic";

/**
 * GET — where this caller belongs after signing in.
 *
 * Every input to the decision is established here, server-side, from a token
 * that `auth.getUser()` revalidated. The only thing the client contributes is
 * the raw `next` string, which is treated as hostile and may at most SELECT
 * among destinations the server already approved.
 *
 * There is no role parameter and no business-account parameter. A client that
 * sends one is ignored, not refused, because refusing would tell an attacker
 * which parameter names matter.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const [profileResult, membershipResult, workspaceResult] = await Promise.all([
    supabaseAdmin.from("profiles").select("role").eq("id", user.userId).maybeSingle(),
    supabaseAdmin
      .from("business_members")
      .select("business_account_id")
      .eq("user_id", user.userId)
      .eq("status", "active"),
    supabaseAdmin
      .from("couranr_merchant_workspaces")
      .select("id")
      .eq("created_by", user.userId)
      .limit(1),
  ]);

  if (profileResult.error) {
    return routeFailure("internal", "Could not verify your account.");
  }

  const rawRole = profileResult.data?.role;
  const facts: LandingFacts = {
    // An unrecognised value is treated as no role rather than trusted. The
    // database constraint permits only customer, driver and admin.
    role: isProfileRole(rawRole) ? rawRole : null,
    activeMembershipCount: membershipResult.data?.length ?? 0,
    hasWorkspace: (workspaceResult.data?.length ?? 0) > 0,
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
