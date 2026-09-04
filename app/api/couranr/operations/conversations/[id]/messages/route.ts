import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isConversationFailure,
  sendOperationsMessage,
} from "@/lib/couranr/conversations/commands";
import {
  isCustomerTopic,
  isVisibility,
} from "@/lib/couranr/conversations/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** OPS-005 — send as the real authenticated Operations actor. */
export async function POST(
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

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const body = typeof payload?.body === "string" ? payload.body : "";
  const idempotencyKey =
    typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : "";

  if (!idempotencyKey) {
    return routeFailure("invalid_input", "An idempotency key is required.");
  }

  let visibility: any;
  if (payload?.visibility !== undefined && payload?.visibility !== null) {
    if (!isVisibility(payload.visibility)) {
      return routeFailure("invalid_input", "That is not a valid message visibility.");
    }
    visibility = payload.visibility;
  }

  let topic: any = null;
  if (payload?.topic !== undefined && payload?.topic !== null) {
    if (!isCustomerTopic(payload.topic)) {
      return routeFailure("invalid_input", "That is not a valid help topic.");
    }
    topic = payload.topic;
  }

  const result = await sendOperationsMessage({
    conversationId: id,
    userId: actor.userId,
    body,
    visibility,
    topic,
    idempotencyKey,
  });
  if (isConversationFailure(result)) return failureResponse(result);

  return NextResponse.json(
    { messageId: result.value.messageId, replayed: result.value.replayed },
    { status: result.value.replayed ? 200 : 201 }
  );
}
