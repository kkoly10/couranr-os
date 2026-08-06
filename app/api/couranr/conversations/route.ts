import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isConversationFailure, listConversations } from "@/lib/couranr/conversations/commands";

export const dynamic = "force-dynamic";

/**
 * GET — the conversations the caller participates in.
 *
 * TAKES NO TENANT PARAMETER, deliberately. Scope comes from the caller's
 * participant rows, so there is no `?businessAccountId=` for a future change to
 * forget to validate. A caller sees exactly the threads they are in.
 *
 * Serves MER-012 and DRV-008, both of which require an "Unread" state.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const result = await listConversations({ userId: user.userId });
  if (isConversationFailure(result)) return failureResponse(result);

  return NextResponse.json({ conversations: result.value });
}
