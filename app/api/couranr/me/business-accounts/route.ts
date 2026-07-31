import { NextRequest, NextResponse } from "next/server";
import { listActiveMemberships, resolveUserId } from "@/lib/couranr/requests/actor";

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
  if (user.ok === false) return NextResponse.json({ error: user.error }, { status: user.status });

  const memberships = await listActiveMemberships(user.userId);
  return NextResponse.json({ businessAccounts: memberships });
}
