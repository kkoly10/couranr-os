import { NextRequest, NextResponse } from "next/server";
import {
  isActorDenied,
  listActiveMemberships,
  resolveUserId,
} from "@/lib/couranr/requests/actor";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * GET — the business accounts this signed-in user is an active member of.
 *
 * The merchant screens have no tenant in the URL, so the server decides which
 * accounts are in scope. A client never states its own tenant and has it
 * believed: every write route re-checks membership independently.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const memberships = await listActiveMemberships(user.userId);
  return NextResponse.json({ businessAccounts: memberships });
}
