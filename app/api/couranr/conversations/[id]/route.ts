import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isConversationFailure, readThread } from "@/lib/couranr/conversations/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — one conversation, as the calling participant sees it.
 *
 * The visibility rule is applied in the DATABASE. No role holds SELECT on
 * `couranr_conversation_messages`, so this route cannot return an internal note
 * however it is written; `readThread` reaches the bodies through
 * `couranr_conversation_thread`, a SECURITY DEFINER function that resolves the
 * caller's participant row itself.
 *
 * A non-participant and a nonexistent id produce the SAME refusal. Two
 * different answers would let a caller enumerate conversation ids.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const id = (await ctx.params)?.id || "";
  if (!UUID_RE.test(id)) {
    // Same message the participant check gives, so a malformed id is not
    // distinguishable from one that simply is not the caller's.
    return routeFailure("not_found", "That conversation is not available.");
  }

  const result = await readThread({ conversationId: id, userId: user.userId });
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
      // `business_account_id` is deliberately absent: the caller is already
      // scoped to it, and it is on the projection's forbidden-key list.
    },
    viewerKind,
    messages,
    unreadCount,
  });
}
