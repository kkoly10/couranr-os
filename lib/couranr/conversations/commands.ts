import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  type ConversationKind,
  type CustomerTopic,
  type ParticipantKind,
  type Visibility,
  memberMayPost,
  responseDueAt,
} from "./states";
import {
  type ConversationRow,
  type MessageRow,
  type ParticipantMessage,
  toParticipantThread,
} from "./projection";

assertServerOnly("lib/couranr/conversations/commands.ts");

/**
 * The named server commands for conversations.
 *
 * The requirement, verbatim from Couranr_Claude_Code_Master_Package.md:490:
 *
 *   "All message writes go through authenticated server commands with
 *    participant checks, idempotency, audit, and AI enqueue."
 *
 * Six obligations on one path, and `sendMessage` below discharges each of them
 * in order. The cutover matrix (:703) names "Browser message inserts" in the
 * Replace column against "Server message command", so there is no path from a
 * browser to an INSERT: no role holds INSERT on any conversation table except
 * `service_role`, which only this module reaches.
 *
 * Every query here is service-role and therefore bypasses RLS, so every query
 * re-scopes itself. The message table is the exception that proves the rule —
 * not even `service_role` can SELECT it, so a body can only be obtained through
 * `couranr_conversation_thread`, which does the scoping in the database.
 *
 * NOTHING HERE MUTATES a delivery, a request, a payment, an assignment, an
 * address, a price or a proof. "A message never directly mutates address,
 * price, payer, cancellation, return, proof, or state" is enforced by this
 * module containing no such write, and `tests/couranr-conversations.test.ts`
 * asserts the absence of the strings that would.
 */

export const RPC = {
  thread: "couranr_conversation_thread",
} as const;

export type ConversationFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type ConversationResult<T> = { ok: true; value: T } | ConversationFailure;

/** `tsconfig` has `strict: false`, so `.ok` does not narrow without this. */
export function isConversationFailure(r: { ok: boolean }): r is ConversationFailure {
  return r.ok === false;
}

function fail(params: {
  code: PublicErrorCode;
  operation: string;
  detail?: unknown;
  message?: string;
}): ConversationFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: ConversationFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

/* ------------------------------------------------------------- participants */

export type Participant = {
  id: string;
  conversationId: string;
  participantKind: ParticipantKind;
  userId: string | null;
  memberRole: string | null;
  joinedAt: string;
  lastReadAt: string | null;
};

/**
 * Resolves the caller's participant row, or refuses.
 *
 * THE SINGLE CHOKEPOINT. Both the read and the write path call this, so a route
 * that forgets to check gets a refusal rather than an unscoped query. It reads
 * the participant row from the database rather than trusting anything the
 * caller said about who they are.
 *
 * A departed participant (`left_at` set) does not resolve, so unassignment
 * closes the window immediately.
 */
export async function resolveParticipant(params: {
  conversationId: string;
  userId: string;
}): Promise<ConversationResult<Participant>> {
  const { data, error } = await supabaseAdmin
    .from("couranr_conversation_participants")
    .select("id, conversation_id, participant_kind, user_id, member_role, joined_at, last_read_at")
    .eq("conversation_id", params.conversationId)
    .eq("user_id", params.userId)
    .is("left_at", null)
    .maybeSingle();

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "conversations.resolveParticipant",
      detail: error,
    });
  }

  if (!data) {
    // Deliberately the same refusal a nonexistent conversation produces. A
    // caller must not be able to distinguish "this thread is not yours" from
    // "there is no such thread" — that difference is an existence oracle.
    return fail({
      code: "not_found",
      operation: "conversations.resolveParticipant",
      message: "That conversation is not available.",
    });
  }

  return {
    ok: true,
    value: {
      id: data.id,
      conversationId: data.conversation_id,
      participantKind: data.participant_kind,
      userId: data.user_id,
      memberRole: data.member_role,
      joinedAt: data.joined_at,
      lastReadAt: data.last_read_at,
    },
  };
}

/* -------------------------------------------------------------- reading */

export type ThreadView = {
  conversation: ConversationRow;
  viewerKind: ParticipantKind;
  viewerParticipantId: string;
  messages: ParticipantMessage[];
  unreadCount: number;
};

/**
 * Reads a thread as the calling user.
 *
 * The body filter happens in the DATABASE — `couranr_conversation_thread` is a
 * SECURITY DEFINER function and no role holds SELECT on the message table, so
 * this cannot be bypassed by writing the query differently. The projection then
 * re-applies the same rule as defence in depth.
 */
export async function readThread(params: {
  conversationId: string;
  userId: string;
}): Promise<ConversationResult<ThreadView>> {
  const participant = await resolveParticipant(params);
  if (isConversationFailure(participant)) return participant;

  const conversation = await supabaseAdmin
    .from("couranr_conversations")
    .select(
      "id, kind, business_account_id, delivery_id, request_id, status, waiting_on, urgency, " +
        "received_at, response_due_at, first_couranr_response_at, due_state, updated_at, version"
    )
    .eq("id", params.conversationId)
    .maybeSingle();

  if (conversation.error) {
    return fail({
      code: classifyDatabaseError(conversation.error),
      operation: "conversations.readThread.conversation",
      detail: conversation.error,
    });
  }
  if (!conversation.data) {
    return fail({
      code: "not_found",
      operation: "conversations.readThread.conversation",
      message: "That conversation is not available.",
    });
  }

  const { data, error } = await supabaseAdmin.rpc(RPC.thread, {
    p_conversation_id: params.conversationId,
    p_viewer_user_id: params.userId,
  });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "conversations.readThread.messages",
      detail: error,
    });
  }

  const rows = (data || []) as MessageRow[];
  const messages = toParticipantThread(rows, participant.value.participantKind);

  const lastRead = participant.value.lastReadAt;
  const unreadCount = lastRead
    ? messages.filter((m) => m.createdAt > lastRead).length
    : messages.length;

  return {
    ok: true,
    value: {
      conversation: conversation.data as unknown as ConversationRow,
      viewerKind: participant.value.participantKind,
      viewerParticipantId: participant.value.id,
      messages,
      unreadCount,
    },
  };
}

/* -------------------------------------------------------------- the write */

export type SendMessageParams = {
  conversationId: string;
  userId: string;
  body: string;
  /** Defaults to `participants`. A caller may not address a value the conversation kind forbids. */
  visibility?: Visibility;
  topic?: CustomerTopic | null;
  /** Required. The caller supplies it so a retry is the same message. */
  idempotencyKey: string;
};

export type SentMessage = {
  messageId: string;
  replayed: boolean;
};

/**
 * THE named server command for a message write.
 *
 * Discharges Master Package:490 in order:
 *
 *   1. authenticated — the caller's user id comes from a validated Bearer
 *      token upstream, never from the request body;
 *   2. participant check — `resolveParticipant`, which reads the row;
 *   3. role check — TRM-002 is unresolved, so this uses the narrow
 *      already-approved DRP-001 allow-list rather than inventing an answer;
 *   4. idempotency — a scoped UNIQUE, with the duplicate resolved to the prior
 *      message id rather than surfaced as an error;
 *   5. audit — an events row, whose CHECK refuses a body at any depth;
 *   6. AI enqueue — AFTER the write, and explicitly not allowed to fail it.
 */
export async function sendMessage(
  params: SendMessageParams
): Promise<ConversationResult<SentMessage>> {
  const body = typeof params.body === "string" ? params.body.trim() : "";
  if (body.length === 0 || body.length > 4000) {
    // Caller input, so `invalid_input`. NOT CR422 — that maps to `internal` and
    // therefore HTTP 500, which would report a refusal as a server fault.
    return fail({
      code: "invalid_input",
      operation: "conversations.sendMessage",
      message: "A message must be between 1 and 4000 characters.",
    });
  }

  const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey.trim() : "";
  if (key.length === 0) {
    return fail({
      code: "invalid_input",
      operation: "conversations.sendMessage",
      message: "An idempotency key is required.",
    });
  }

  // (2) participant check.
  const participant = await resolveParticipant({
    conversationId: params.conversationId,
    userId: params.userId,
  });
  if (isConversationFailure(participant)) return participant;

  // (3) role check. A viewer or billing member may read a thread and may not
  // post to it, mirroring lib/couranr/requests/permissions.ts.
  if (
    participant.value.participantKind === "merchant" &&
    !memberMayPost(participant.value.memberRole)
  ) {
    return fail({
      code: "not_permitted",
      operation: "conversations.sendMessage",
      message: "Your role cannot post to this conversation.",
    });
  }

  const visibility: Visibility = params.visibility || "participants";

  // (4) idempotency. The UNIQUE is the authority; this is the fast path.
  const existing = await supabaseAdmin
    .from("couranr_conversation_messages")
    .select("id, conversation_id, idempotency_key")
    .eq("conversation_id", params.conversationId)
    .eq("idempotency_key", key)
    .maybeSingle();

  if (existing.error) {
    return fail({
      code: classifyDatabaseError(existing.error),
      operation: "conversations.sendMessage.replayCheck",
      detail: existing.error,
    });
  }
  if (existing.data) {
    return { ok: true, value: { messageId: existing.data.id, replayed: true } };
  }

  // The INSERT returns `id` only. `returning *` would hand back the body and
  // the visibility, which is exactly what the column grant exists to prevent —
  // and on a replay would hand back ANOTHER actor's row.
  const inserted = await supabaseAdmin
    .from("couranr_conversation_messages")
    .insert({
      conversation_id: params.conversationId,
      author_participant_id: participant.value.id,
      visibility,
      authorship: "human",
      topic: params.topic ?? null,
      body,
      idempotency_key: key,
    })
    .select("id")
    .single();

  if (inserted.error) {
    // A concurrent duplicate lost the race to the UNIQUE. Resolve it the same
    // way the fast path would have, so two simultaneous retries agree.
    const raced = await supabaseAdmin
      .from("couranr_conversation_messages")
      .select("id, conversation_id, idempotency_key")
      .eq("conversation_id", params.conversationId)
      .eq("idempotency_key", key)
      .maybeSingle();

    if (raced.data) {
      return { ok: true, value: { messageId: raced.data.id, replayed: true } };
    }

    return fail({
      code: classifyDatabaseError(inserted.error),
      operation: "conversations.sendMessage.insert",
      detail: inserted.error,
    });
  }

  const messageId = inserted.data.id;

  // (5) audit. Records THAT a message was sent and its addressing, never its
  // words — the events CHECK refuses a body-shaped key at any depth, so an
  // attempt to be helpful here fails loudly rather than creating a second,
  // unprotected copy of the text.
  await recordEvent({
    conversationId: params.conversationId,
    messageId,
    eventType: "message_sent",
    actorKind: participant.value.participantKind,
    actorUserId: params.userId,
    metadata: { visibility, authorship: "human", topic: params.topic ?? null },
  });

  // Deadline bookkeeping. Only the two timezone-free fields are written;
  // `next_operating_period_at` stays null until HRS-002 records a zone.
  await stampDeadlines({
    conversationId: params.conversationId,
    actorKind: participant.value.participantKind,
  });

  // (6) AI enqueue. LAST, and its failure is swallowed by construction:
  // "AI failure must not block manual support, payment, fulfillment, proof,
  // tracking, authorized refunds, or state commands"
  // (05_AI_COMMUNICATION_SPEC.md §Kill switches). The message is already
  // committed; nothing below may change that.
  await enqueueForAssistant(params.conversationId, messageId);

  return { ok: true, value: { messageId, replayed: false } };
}

/* ----------------------------------------------------------------- audit */

/**
 * Appends an audit row.
 *
 * Never throws and never fails a caller. An audit write that could fail a
 * message write would make the audit trail a denial-of-service surface; the
 * failure is logged instead.
 */
export async function recordEvent(params: {
  conversationId: string;
  messageId?: string | null;
  eventType: string;
  actorKind: ParticipantKind | "system";
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("couranr_conversation_events")
    .insert({
      conversation_id: params.conversationId,
      message_id: params.messageId ?? null,
      event_type: params.eventType,
      actor_kind: params.actorKind,
      actor_user_id: params.actorUserId ?? null,
      metadata: params.metadata ?? {},
    });

  if (error) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: "conversations.recordEvent",
      code: classifyDatabaseError(error),
      detail: error,
    });
  }
}

/* -------------------------------------------------------------- deadlines */

/**
 * Maintains the deadline fields.
 *
 * `received_at` and `response_due_at` are set when a thread first has something
 * Couranr must answer. `first_couranr_response_at` is set the first time an
 * Operations participant replies.
 *
 * "Automated acknowledgement does not count as Operations response" — which is
 * why this is only ever called from the `human` write path. An `automated`
 * message never reaches here, so it can never stamp the response time.
 */
async function stampDeadlines(params: {
  conversationId: string;
  actorKind: ParticipantKind;
}): Promise<void> {
  const now = new Date();

  const current = await supabaseAdmin
    .from("couranr_conversations")
    .select("id, received_at, first_couranr_response_at")
    .eq("id", params.conversationId)
    .maybeSingle();

  if (current.error || !current.data) return;

  const patch: Record<string, unknown> = { updated_at: now.toISOString() };

  if (params.actorKind === "operations") {
    if (!current.data.first_couranr_response_at) {
      patch.first_couranr_response_at = now.toISOString();
      patch.due_state = "on_time";
    }
    patch.waiting_on = "merchant";
  } else if (!current.data.received_at) {
    patch.received_at = now.toISOString();
    patch.response_due_at = responseDueAt(now).toISOString();
    patch.waiting_on = "couranr";
  }

  const { error } = await supabaseAdmin
    .from("couranr_conversations")
    .update(patch)
    .eq("id", params.conversationId);

  if (error) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: "conversations.stampDeadlines",
      code: classifyDatabaseError(error),
      detail: error,
    });
  }
}

/* ------------------------------------------------------------ AI enqueue */

/**
 * Records that a message is awaiting assistant analysis.
 *
 * An audit row, not a job runner. Nothing consumes this queue in P8-001 — AI
 * auto-replies are explicitly out of scope for this slice — but the enqueue is
 * named as an obligation of the write path, so it exists and is observable.
 *
 * CANNOT FAIL THE MESSAGE. It is called after the insert has returned, and it
 * delegates to `recordEvent`, which swallows its own errors.
 */
async function enqueueForAssistant(conversationId: string, messageId: string): Promise<void> {
  await recordEvent({
    conversationId,
    messageId,
    eventType: "ai_enqueued",
    actorKind: "system",
    metadata: { queued: true },
  });
}

/* ------------------------------------------------------------- read state */

/**
 * Marks the thread read up to now for the calling participant.
 *
 * "Unread" is a required state on all four messaging screens, and it is per
 * participant: a merchant reading a thread does not mark it read for the driver.
 */
export async function markThreadRead(params: {
  conversationId: string;
  userId: string;
}): Promise<ConversationResult<{ lastReadAt: string }>> {
  const participant = await resolveParticipant(params);
  if (isConversationFailure(participant)) return participant;

  const lastReadAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("couranr_conversation_participants")
    .update({ last_read_at: lastReadAt })
    .eq("id", participant.value.id);

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "conversations.markThreadRead",
      detail: error,
    });
  }

  return { ok: true, value: { lastReadAt } };
}
