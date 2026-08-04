import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isConversationFailure, markThreadRead } from "@/lib/couranr/conversations/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — mark this thread read for the calling participant.
 *
 * "Unread" is a required state on all four messaging screens (MER-012,
 * DRV-008, OPS-005, and PUB-007 by way of "waiting on"), and it is PER
 * PARTICIPANT: a merchant opening a thread does not mark it read for the driver
 * or for Operations.
 */
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const id = ctx.params?.id || "";
  if (!UUID_RE.test(id)) {
    return routeFailure("not_found", "That conversation is not available.");
  }

  const result = await markThreadRead({ conversationId: id, userId: user.userId });
  if (isConversationFailure(result)) return failureResponse(result);

  return NextResponse.json({ lastReadAt: result.value.lastReadAt });
}
