import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isConversationFailure,
  readOperationsThread,
} from "@/lib/couranr/conversations/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * OPS-005 — read one conversation in explicit Operations context.
 *
 * No Operations participant row is required. The route and the database RPC
 * both verify the real admin actor, preserving dual-role merchant authority on
 * /app/business.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind !== "operations") {
    return routeFailure("not_permitted", "Couranr Operations access required.");
  }

  const id = (await ctx.params)?.id || "";
  if (!UUID_RE.test(id)) {
    return routeFailure("not_found", "That conversation is not available.");
  }

  const result = await readOperationsThread({
    conversationId: id,
    actorUserId: actor.userId,
  });
  if (isConversationFailure(result)) return failureResponse(result);

  const { conversation, viewerKind, messages, unreadCount } = result.value;
  return NextResponse.json({
    conversation: {
      id: conversation.id,
      kind: conversation.kind,
      status: conversation.status,
      waitingOn: conversation.waiting_on,
      urgency: conversation.urgency,
      dueState: conversation.due_state,
      responseDueAt: conversation.response_due_at,
      firstCouranrResponseAt: conversation.first_couranr_response_at,
    },
    viewerKind,
    messages,
    unreadCount,
  });
}
