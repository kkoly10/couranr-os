import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isConversationFailure, sendMessage } from "@/lib/couranr/conversations/commands";
import { isCustomerTopic, isVisibility } from "@/lib/couranr/conversations/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — send a message.
 *
 * THE ONLY write path. `couranr_claude_code_package/03_REPO_CUTOVER_MATRIX.md`
 * names "Browser message inserts" in the Replace column against "Server message
 * command", and no role but `service_role` holds INSERT on the message table,
 * so there is no way around this route.
 *
 * The caller supplies the idempotency key so a retry is the same message rather
 * than a second one. A duplicate resolves to the original's id and reports
 * `replayed: true` — it is not an error, because to the caller a retry that
 * lands twice and a retry that lands once should look identical.
 *
 * WHAT THIS ROUTE CANNOT DO: change an address, a price, a payer, a
 * cancellation, a refund, a return, proof or state. `sendMessage` writes only
 * to the four conversation tables, and `tests/couranr-conversations.test.ts`
 * asserts that by enumerating every table the command module mutates.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

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

  // An unrecognised visibility or topic is refused HERE rather than being
  // silently coerced to a default. Coercion would let a caller aiming a message
  // at Operations have it delivered to everyone instead.
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

  const result = await sendMessage({
    conversationId: id,
    userId: user.userId,
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
