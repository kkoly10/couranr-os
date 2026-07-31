import { NextRequest, NextResponse } from "next/server";
import {
  isActorDenied,
  isMembershipLookupFailed,
  listActiveMemberships,
  resolveUserId,
} from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * GET — the business accounts this signed-in user is an active member of.
 *
 * The merchant screens have no tenant in the URL, so the server decides which
 * accounts are in scope. A client never states its own tenant and has it
 * believed: every write route re-checks membership independently.
 *
 * FAILS CLOSED. A failed lookup returns a sanitized 500, never an empty list.
 * "The query errored" and "you belong to no businesses" lead the onboarding
 * screen to opposite conclusions, and only one of them offers to create a
 * workspace.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const result = await listActiveMemberships(user.userId);
  if (isMembershipLookupFailed(result)) {
    return routeInternalFailure({
      operation: "listBusinessAccounts",
      detail: { lookup: "business_members", reason: result.detail },
      message: "We could not load your business accounts. Try again in a moment.",
    });
  }

  return NextResponse.json({ businessAccounts: result.memberships });
}
