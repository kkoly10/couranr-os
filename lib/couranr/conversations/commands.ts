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
  canAddress,
  canSee,
  dueStateAt,
  nextOperatingPeriodAt,
  memberMayPost,
  memberMayRead,
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
  operationsThread: "couranr_operations_conversation_thread",
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

  // TRM-002 READ GATE. Every read path funnels through here — readThread,
  // sendMessage and markThreadRead all call it — so gating once covers all
  // three and no future caller can bypass it by forgetting.
  //
  // A viewer or billing member previously COULD read: the role was checked
  // only before a write. A support thread carries customer contact details,
  // address concerns and Couranr internal context, so read is not the safe
  // default.
  //
  // The refusal is `not_found`, deliberately IDENTICAL to the one a
  // nonexistent conversation and a non-participant produce. `not_permitted`
  // would confirm the thread exists and that the caller's own business owns
  // it — an existence oracle differing only in who is asking.
  if (
    data.participant_kind === "merchant" &&
    !memberMayRead(data.member_role)
  ) {
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


/**
 * Reads one thread in the explicit Operations surface context.
 *
 * This deliberately does NOT resolve a participant row. OPS-005 is a
 * cross-business projection and an admin may simultaneously be a merchant in
 * the same thread. The database RPC verifies profiles.role='admin' and applies
 * the Operations visibility envelope without creating a second live
 * participant, which keeps /app/business authority separate.
 */
export async function readOperationsThread(params: {
  conversationId: string;
  actorUserId: string;
}): Promise<ConversationResult<Omit<ThreadView, "viewerParticipantId">>> {
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
      operation: "conversations.readOperationsThread.conversation",
      detail: conversation.error,
    });
  }
  if (!conversation.data) {
    return fail({
      code: "not_found",
      operation: "conversations.readOperationsThread.conversation",
      message: "That conversation is not available.",
    });
  }

  const { data, error } = await supabaseAdmin.rpc(RPC.operationsThread, {
    p_conversation_id: params.conversationId,
    p_actor_user_id: params.actorUserId,
  });

  if (error) {
    return fail({
      code: classifyDatabaseError(error),
      operation: "conversations.readOperationsThread.messages",
      detail: error,
    });
  }

  const messages = toParticipantThread((data || []) as MessageRow[], "operations");

  return {
    ok: true,
    value: {
      conversation: conversation.data as unknown as ConversationRow,
      viewerKind: "operations",
      messages,
      // OPS-005 is a shared queue, not a personal participant mailbox. Do not
      // manufacture a per-operator unread count.
      unreadCount: 0,
    },
  };
}

/* ------------------------------------------------------------- listing */

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  status: string;
  waitingOn: string | null;
  urgency: string;
  dueState: string;
  responseDueAt: string | null;
  firstCouranrResponseAt: string | null;
  deliveryId: string | null;
  /**
   * Whether the thread changed since this participant last read it.
   *
   * A BOOLEAN, not a count, and named so. Computing a real count here would
   * mean reading messages through the visibility rule for every row in the
   * list — and a count that included messages the viewer may not see would
   * itself be a leak. `readThread` returns a genuine count for the one thread
   * being viewed, where the messages have already been filtered.
   */
  hasUnread: boolean;
  updatedAt: string;
};

/**
 * Lists the conversations the calling user participates in.
 *
 * TENANCY COMES FROM THE PARTICIPANT ROWS, never from a caller-supplied
 * business id. A route that accepted `?businessAccountId=` would be one
 * forgotten check away from a cross-tenant read; here the only threads that can
 * appear are the ones the caller has a live participant row in.
 *
 * The unread count is derived from `last_read_at` against the thread's own
 * `updated_at` rather than by counting messages, because counting would require
 * reading rows this caller may not be allowed to see — and a count that
 * includes invisible messages is itself a leak.
 */
export async function listConversations(params: {
  userId: string;
}): Promise<ConversationResult<ConversationSummary[]>> {
  const parts = await supabaseAdmin
    .from("couranr_conversation_participants")
    // `member_role` is selected so TRM-002 can be applied here too. Without it
    // a viewer's list would still show every thread's subject, unread count and
    // due state — the row would simply refuse to open. A list that names what
    // it will not show is still a disclosure.
    .select("conversation_id, last_read_at, participant_kind, member_role")
    .eq("user_id", params.userId)
    .is("left_at", null);

  if (parts.error) {
    return fail({
      code: classifyDatabaseError(parts.error),
      operation: "conversations.listConversations.participants",
      detail: parts.error,
    });
  }

  // TRM-002: drop the rows resolveParticipant would refuse, using the same
  // predicate rather than a second copy of the rule.
  const visible = (parts.data || []).filter(
    (p: any) => p.participant_kind !== "merchant" || memberMayRead(p.member_role)
  );

  const ids = visible.map((p: any) => p.conversation_id);
  if (ids.length === 0) return { ok: true, value: [] };

  const lastReadBy = new Map<string, string | null>(
    visible.map((p: any) => [p.conversation_id, p.last_read_at])
  );

  const rows = await supabaseAdmin
    .from("couranr_conversations")
    .select(
      "id, kind, status, waiting_on, urgency, due_state, response_due_at, " +
        "first_couranr_response_at, delivery_id, updated_at"
    )
    .in("id", ids)
    .order("updated_at", { ascending: false });

  if (rows.error) {
    return fail({
      code: classifyDatabaseError(rows.error),
      operation: "conversations.listConversations.rows",
      detail: rows.error,
    });
  }

  const value: ConversationSummary[] = (rows.data || []).map((c: any) => {
    const lastRead = lastReadBy.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      waitingOn: c.waiting_on,
      urgency: c.urgency,
      dueState: c.due_state,
      responseDueAt: c.response_due_at,
      firstCouranrResponseAt: c.first_couranr_response_at,
      deliveryId: c.delivery_id,
      hasUnread: !lastRead || c.updated_at > lastRead,
      updatedAt: c.updated_at,
    };
  });

  return { ok: true, value };
}

/**
 * The Couranr Operations Inbox — P8-002.
 *
 * A PROJECTION, not a fourth conversation kind. UI_SCREEN_REGISTRY.md:604
 * states OPS-005's purpose as "Unify merchant, driver, and customer-help
 * conversations with delivery context and priority", so the Inbox is a view
 * across all three kinds rather than a thing a conversation can be.
 *
 * This deliberately crosses business accounts, which is why it refuses any
 * caller who is not Operations before a single row is read — the same shape
 * `/api/couranr/operations/queue` already uses.
 *
 * ORDERING IS THE PRODUCT. Overdue first, then due soon, then by urgency, then
 * oldest deadline: an inbox sorted by recency would bury the thread that has
 * been waiting longest, which is the only one the 15-minute target is about.
 */
export async function listOperationsInbox(): Promise<
  ConversationResult<ConversationSummary[]>
> {
  const rows = await supabaseAdmin
    .from("couranr_conversations")
    .select(
      "id, kind, status, waiting_on, urgency, due_state, response_due_at, " +
        "first_couranr_response_at, delivery_id, updated_at"
    )
    .not("status", "in", "(resolved,closed)")
    .order("response_due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (rows.error) {
    return fail({
      code: classifyDatabaseError(rows.error),
      operation: "conversations.listOperationsInbox",
      detail: rows.error,
    });
  }

  const RANK: Record<string, number> = { overdue: 0, due_soon: 1, on_time: 2 };
  const URGENCY: Record<string, number> = { safety: 0, urgent: 1, routine: 2 };

  const value: ConversationSummary[] = (rows.data || [])
    .map((c: any) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      waitingOn: c.waiting_on,
      urgency: c.urgency,
      dueState: c.due_state,
      responseDueAt: c.response_due_at,
      firstCouranrResponseAt: c.first_couranr_response_at,
      deliveryId: c.delivery_id,
      // Operations reads the queue, not a per-participant read state: the
      // inbox is shared, so "unread" is not a property one operator owns.
      // Reported as false rather than as a fake zero count.
      hasUnread: false,
      updatedAt: c.updated_at,
    }))
    .sort((a, b) => {
      const d = (RANK[a.dueState] ?? 3) - (RANK[b.dueState] ?? 3);
      if (d !== 0) return d;
      const u = (URGENCY[a.urgency] ?? 3) - (URGENCY[b.urgency] ?? 3);
      if (u !== 0) return u;
      return (a.responseDueAt || "9999") < (b.responseDueAt || "9999") ? -1 : 1;
    });

  return { ok: true, value };
}

/**
 * Recomputes `due_state` for every open thread with a deadline — P8-002.
 *
 * "At 10 minutes mark due soon; at 15 overdue." A stored due state has to be
 * refreshed by something, because no query runs at minute 10.
 *
 * Only threads Couranr has NOT yet answered are considered: once
 * `first_couranr_response_at` is set the target has been met, and the spec
 * measures the FIRST response, not every subsequent one.
 *
 * The elapsed time is measured in OPERATING minutes. HRS-002 is decided —
 * America/New_York, Monday-Friday 06:00-18:00 — so `dueStateAt` counts only the
 * minutes Couranr was open. An earlier revision of this comment said the
 * deadline could not roll over because the zone was unresolved; it was true
 * then and is not now. A thread received Friday 17:58 is not overdue at 18:13.
 */
export async function refreshDueStates(now: Date = new Date()): Promise<
  ConversationResult<{ dueSoon: number; overdue: number }>
> {
  const rows = await supabaseAdmin
    .from("couranr_conversations")
    .select("id, received_at, due_state")
    .is("first_couranr_response_at", null)
    .not("received_at", "is", null)
    .not("status", "in", "(resolved,closed)")
    .limit(500);

  if (rows.error) {
    return fail({
      code: classifyDatabaseError(rows.error),
      operation: "conversations.refreshDueStates",
      detail: rows.error,
    });
  }

  // Group by TARGET STATE and issue one UPDATE per group — at most two round
  // trips regardless of how many threads moved.
  //
  // The previous shape awaited one UPDATE per changed row inside the loop, so a
  // busy queue could issue hundreds of sequential round trips inside a GET that
  // a person is waiting on. Two operators opening the inbox at the same moment
  // duplicated the entire pass.
  const moving: Record<string, string[]> = { due_soon: [], overdue: [], on_time: [] };

  for (const c of rows.data || []) {
    const next = dueStateAt(new Date((c as any).received_at), now);
    if (next === (c as any).due_state) continue;
    moving[next].push((c as any).id);
  }

  let dueSoon = 0;
  let overdue = 0;

  for (const [state, ids] of Object.entries(moving)) {
    if (ids.length === 0) continue;

    const { error } = await supabaseAdmin
      .from("couranr_conversations")
      .update({ due_state: state })
      .in("id", ids);

    if (error) {
      // Logged, not raised. A stale mark is a smaller problem than an inbox
      // that will not open, and the caller treats this as best-effort.
      logServerFailure({
        correlationId: newCorrelationId(),
        operation: "conversations.refreshDueStates.update",
        code: classifyDatabaseError(error),
        detail: error,
      });
      continue;
    }

    if (state === "due_soon") dueSoon = ids.length;
    if (state === "overdue") overdue = ids.length;
  }

  return { ok: true, value: { dueSoon, overdue } };
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
 *   3. role check — TRM-002, decided by the owner 2026-08-06: owner, manager
 *      and dispatcher may send; viewer and billing have no access at all and
 *      are refused one step earlier, at the participant read;
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

  // (3) role check. TRM-002: owner, manager and dispatcher may send. viewer and
  // billing reach neither this line nor the participant read above — they are
  // refused in resolveParticipant.
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

  // Addressing is an ACTOR permission, not merely a property of the
  // conversation kind. The UI deliberately hides private audiences a caller
  // may not use, but a crafted request can still name them, so the named server
  // command must fail closed before any idempotency lookup or INSERT.
  if (!canAddress(participant.value.participantKind, visibility)) {
    return fail({
      code: "not_permitted",
      operation: "conversations.sendMessage.addressing",
      message: "That message audience is not available to you.",
    });
  }

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

  // Deadline bookkeeping. All three fields are written now that HRS-002 names
  // the zone; `next_operating_period_at` was created in 20260804150000 and had
  // never been written.
  await stampDeadlines({
    conversationId: params.conversationId,
    actorKind: participant.value.participantKind,
    visibility,
  });

  // (6) AI enqueue. LAST, and its failure is swallowed by construction:
  // "AI failure must not block manual support, payment, fulfillment, proof,
  // tracking, authorized refunds, or state commands"
  // (05_AI_COMMUNICATION_SPEC.md §Kill switches). The message is already
  // committed; nothing below may change that.
  await enqueueForAssistant(params.conversationId, messageId);

  return { ok: true, value: { messageId, replayed: false } };
}


/**
 * Operations-only human message write.
 *
 * The route authenticates the actor as Operations first; the D2 database
 * author-addressing trigger repeats profiles.role='admin' so a future caller
 * cannot bypass that check. No Operations participant row is created.
 */
export async function sendOperationsMessage(
  params: SendMessageParams
): Promise<ConversationResult<SentMessage>> {
  const body = typeof params.body === "string" ? params.body.trim() : "";
  if (body.length === 0 || body.length > 4000) {
    return fail({
      code: "invalid_input",
      operation: "conversations.sendOperationsMessage",
      message: "A message must be between 1 and 4000 characters.",
    });
  }

  const rawKey =
    typeof params.idempotencyKey === "string" ? params.idempotencyKey.trim() : "";
  if (rawKey.length === 0) {
    return fail({
      code: "invalid_input",
      operation: "conversations.sendOperationsMessage",
      message: "An idempotency key is required.",
    });
  }

  const visibility: Visibility = params.visibility || "participants";
  if (!canAddress("operations", visibility)) {
    return fail({
      code: "not_permitted",
      operation: "conversations.sendOperationsMessage.addressing",
      message: "That message audience is not available to you.",
    });
  }

  // Namespace the browser key by real Operations actor. The table's durable
  // UNIQUE remains (conversation,idempotency_key), but an Operations retry can
  // never collide with a merchant/driver key in the same thread.
  const key = `ops:${params.userId}:${rawKey}`;

  const existing = await supabaseAdmin
    .from("couranr_conversation_messages")
    .select("id, conversation_id, idempotency_key")
    .eq("conversation_id", params.conversationId)
    .eq("idempotency_key", key)
    .maybeSingle();

  if (existing.error) {
    return fail({
      code: classifyDatabaseError(existing.error),
      operation: "conversations.sendOperationsMessage.replayCheck",
      detail: existing.error,
    });
  }
  if (existing.data) {
    return { ok: true, value: { messageId: existing.data.id, replayed: true } };
  }

  const inserted = await supabaseAdmin
    .from("couranr_conversation_messages")
    .insert({
      conversation_id: params.conversationId,
      author_participant_id: null,
      author_user_id: params.userId,
      visibility,
      authorship: "human",
      topic: params.topic ?? null,
      body,
      idempotency_key: key,
    })
    .select("id")
    .single();

  if (inserted.error) {
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
      operation: "conversations.sendOperationsMessage.insert",
      detail: inserted.error,
    });
  }

  const messageId = inserted.data.id;

  await recordEvent({
    conversationId: params.conversationId,
    messageId,
    eventType: "message_sent",
    actorKind: "operations",
    actorUserId: params.userId,
    metadata: { visibility, authorship: "human", topic: params.topic ?? null },
  });

  await stampDeadlines({
    conversationId: params.conversationId,
    actorKind: "operations",
    visibility,
  });

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
  /**
   * REQUIRED. Whether a reply stops the clock depends on whether the waiting
   * party can actually see it, and that is a visibility question. Omitting it
   * is what let a `couranr_internal` note — which by design reaches nobody —
   * mark a thread answered and remove it from the overdue queue forever.
   */
  visibility: Visibility;
}): Promise<void> {
  const now = new Date();

  const current = await supabaseAdmin
    .from("couranr_conversations")
    .select("id, received_at, first_couranr_response_at, awaiting_reply_kind")
    .eq("id", params.conversationId)
    .maybeSingle();

  if (current.error || !current.data) return;

  const patch: Record<string, unknown> = { updated_at: now.toISOString() };

  if (params.actorKind === "operations") {
    const awaiting = (current.data as any).awaiting_reply_kind as ParticipantKind | null;

    // THE CLOCK STOPS ONLY ON SOMETHING THE WAITING PARTY RECEIVES.
    //
    // `canSee` is asked about the AWAITING party, never about `operations` —
    // Operations can see every visibility, so asking about the author would
    // make this check vacuously true and reintroduce the defect.
    //
    // A thread with nobody awaiting a reply is not one Couranr owes an answer
    // to, so there is no clock to stop.
    const reaches = awaiting !== null && canSee(awaiting, params.visibility);

    if (reaches) {
      if (!current.data.first_couranr_response_at) {
        patch.first_couranr_response_at = now.toISOString();
        patch.due_state = "on_time";
      }
      // Derived, not hardcoded. The previous `waiting_on = "merchant"` was
      // wrong in a delivery_chat answered for a driver: it flipped the thread
      // to the merchant regardless of who had actually been waiting.
      patch.waiting_on = awaiting;
      patch.awaiting_reply_kind = null;
    }
    // Otherwise: an internal note, or a reply addressed to a party other than
    // the one waiting. The thread stays outstanding and keeps ageing, for the
    // same reason the spec says an automated acknowledgement does not count.
  } else if (!current.data.received_at) {
    patch.received_at = now.toISOString();
    // HRS-002: 15 OPERATING minutes in America/New_York, rolling over any
    // closed period. A message received Friday 17:58 is due Monday 06:13, not
    // Friday 18:13.
    patch.response_due_at = responseDueAt(now).toISOString();
    // Non-null only when the message arrived while Couranr was CLOSED. That is
    // what distinguishes "the clock starts later" from "the clock is already
    // running", so an in-hours message must leave it null rather than record
    // its own receipt instant.
    const rollover = nextOperatingPeriodAt(now);
    patch.next_operating_period_at = rollover ? rollover.toISOString() : null;
    patch.waiting_on = "couranr";
    // Recorded here because this is the only moment the asking party is known.
    patch.awaiting_reply_kind = params.actorKind;
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
