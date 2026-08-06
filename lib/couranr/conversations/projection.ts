/**
 * What each surface is allowed to receive.
 *
 * The binding sentence names FOUR enforcement points:
 *
 *   "Internal notes and AI drafts must be excluded from initial queries,
 *    realtime, exports, and notifications."
 *
 * The migration owns the first: nobody holds SELECT on
 * `couranr_conversation_messages`, so an initial query cannot return an
 * internal note however it is written. This module owns the other three, and
 * the reason they need their own seam is that no SQL construct can stop a
 * future route from formatting a body into an email.
 *
 * The construction that makes each one safe is structural, not a filter:
 *
 *   * a NOTIFICATION carries a template key and four scalars, and its type has
 *     NO FIELD CAPABLE OF HOLDING A BODY. You cannot leak through it without
 *     changing the type, which is a visible diff.
 *   * an EXPORT row is built from a message that has already been through
 *     `toParticipantMessage`, and carries no visibility or authorship field to
 *     re-filter on — because a second filter is a second chance to get it wrong.
 *   * a REALTIME payload is an id and a conversation id. Subscribers refetch
 *     through the reader function, which applies the whole rule again.
 *
 * NO DATABASE ACCESS AND NO SECRETS, so this is unit-testable without a
 * database and safe to import anywhere.
 */

import {
  type Authorship,
  type ConversationStatus,
  type CustomerTopic,
  type DueState,
  type ParticipantKind,
  type Urgency,
  type Visibility,
  type WaitingOn,
  canSee,
  isReadableInThread,
} from "./states";

/* --------------------------------------------------------------- row shapes */

/** A message row as the reader function returns it. Never sent as-is. */
export type MessageRow = {
  id: string;
  conversation_id: string;
  author_participant_id: string | null;
  visibility: Visibility;
  authorship: Authorship;
  topic: CustomerTopic | null;
  body: string;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  kind: string;
  business_account_id: string;
  delivery_id: string | null;
  request_id: string | null;
  status: ConversationStatus;
  waiting_on: WaitingOn | null;
  urgency: Urgency;
  received_at: string | null;
  response_due_at: string | null;
  first_couranr_response_at: string | null;
  due_state: DueState;
  updated_at: string;
  version: number;
};

/* ------------------------------------------------------- participant message */

/**
 * What a participant sees of a message.
 *
 * `visibility` is deliberately NOT carried. A participant does not need to know
 * the internal addressing of a message they are allowed to read, and a field
 * that exists is a field a template can interpolate. Authorship is reduced to a
 * single boolean — whether it came from a person — for the same reason.
 */
export type ParticipantMessage = {
  id: string;
  authoredByPerson: boolean;
  authorParticipantId: string | null;
  topic: CustomerTopic | null;
  body: string;
  createdAt: string;
};

/**
 * The defence-in-depth filter.
 *
 * The database has already applied this rule and is the authority; nobody holds
 * SELECT on the message table, so a row only reaches here through the reader
 * function. This re-checks anyway, because the cost is one comparison and the
 * failure it guards against — a future command that reads rows some other way —
 * is exactly the failure this acceptance criterion is about.
 *
 * Returns null for anything the viewer may not see, so a caller that forgets to
 * filter gets a hole in its array rather than a leak.
 */
export function toParticipantMessage(
  row: MessageRow,
  viewerKind: ParticipantKind
): ParticipantMessage | null {
  if (!isReadableInThread(row.authorship)) return null;
  if (!canSee(viewerKind, row.visibility)) return null;

  return {
    id: row.id,
    authoredByPerson: row.authorship === "human",
    authorParticipantId: row.author_participant_id,
    topic: row.topic,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function toParticipantThread(
  rows: readonly MessageRow[],
  viewerKind: ParticipantKind
): ParticipantMessage[] {
  const out: ParticipantMessage[] = [];
  for (const row of rows) {
    const m = toParticipantMessage(row, viewerKind);
    if (m) out.push(m);
  }
  return out;
}

/* ------------------------------------------------------------ notifications */

/**
 * A notification about a conversation.
 *
 * THE POINT OF THIS TYPE IS WHAT IT CANNOT HOLD. There is no `body`, no
 * `preview`, no `snippet`, no `title` — nothing free-text at all. A caller
 * that wants to say something picks a `templateKey`; the words live in the
 * template, not in the data.
 *
 * This is the only construction that satisfies the notification limb of the
 * binding sentence against free text. A filter cannot work here: you cannot
 * inspect a body a customer typed and decide it contains no gate code, and
 * UI_SCREEN_REGISTRY.md's CUS-008 exists precisely because they type one.
 */
export type ConversationNotification = {
  conversationId: string;
  templateKey: ConversationNotificationTemplate;
  unreadCount: number;
  urgency: Urgency;
  dueState: DueState;
};

export const CONVERSATION_NOTIFICATION_TEMPLATES = [
  "new_message",
  "response_overdue",
  "response_due_soon",
  "thread_resolved",
  "escalated",
] as const;
export type ConversationNotificationTemplate =
  (typeof CONVERSATION_NOTIFICATION_TEMPLATES)[number];

/**
 * Builds a notification.
 *
 * Takes the CONVERSATION, never a message, so there is nothing in scope to
 * leak. An internal note or an AI draft cannot produce a notification at all,
 * because this function is never handed one.
 */
export function toConversationNotification(
  conversation: ConversationRow,
  templateKey: ConversationNotificationTemplate,
  unreadCount: number
): ConversationNotification {
  return {
    conversationId: conversation.id,
    templateKey,
    unreadCount: Math.max(0, Math.trunc(unreadCount)),
    urgency: conversation.urgency,
    dueState: conversation.due_state,
  };
}

/* ------------------------------------------------------------------ realtime */

/**
 * What a realtime broadcast may carry: two ids and nothing else.
 *
 * A subscriber learns that the thread changed and refetches through the reader
 * function, which applies the visibility rule again. So a broadcast about an
 * internal note tells a merchant only that *something* happened — and their
 * refetch returns nothing new.
 *
 * Nothing broadcasts yet: `pg_publication_tables` for `supabase_realtime` is
 * empty on this project, and no `couranr_*` table is in a publication. This
 * type exists so that when something does, the shape is already decided.
 */
export type ConversationRealtimeEvent = {
  conversationId: string;
  messageId: string;
};

export function toRealtimeEvent(row: MessageRow): ConversationRealtimeEvent {
  return { conversationId: row.conversation_id, messageId: row.id };
}

/* ------------------------------------------------------------------ exports */

/**
 * One row of an export.
 *
 * Built from a `ParticipantMessage`, never from a `MessageRow`, so an internal
 * note or an AI draft cannot reach an export without first surviving
 * `toParticipantMessage` — which is the same gate the screen uses. There is
 * deliberately no `visibility` or `authorship` field to re-filter on, because a
 * second filter is a second opportunity to write it wrong.
 */
export type ConversationExportRow = {
  conversationId: string;
  messageId: string;
  createdAt: string;
  topic: CustomerTopic | null;
  body: string;
};

export function toExportRows(
  conversationId: string,
  messages: readonly ParticipantMessage[]
): ConversationExportRow[] {
  return messages.map((m) => ({
    conversationId,
    messageId: m.id,
    createdAt: m.createdAt,
    topic: m.topic,
    body: m.body,
  }));
}

/* --------------------------------------------------------------- the guard */

/**
 * Keys that must never appear in anything this module emits to a participant,
 * a notification, a realtime payload or an export.
 *
 * This is a SUPERSET of `TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS`, not a
 * weaker cousin of it. The shipped tracking list was written for a single
 * delivery view; a conversation additionally must never emit the internal
 * addressing of a message, the identity of another participant, or a body's
 * classification.
 *
 * A KNOWN LIMIT, STATED RATHER THAN IMPLIED: this checks KEY NAMES. The `body`
 * of a message is free text a person typed, and no key-name check can tell
 * whether it contains an address, a price or a gate code. That is why the
 * notification type carries no body at all — the one place where the content,
 * not the shape, is the risk, is solved by removing the field rather than by
 * inspecting it.
 */
export const CONVERSATION_PROJECTION_FORBIDDEN_KEYS: readonly string[] = [
  // The internal addressing of a message.
  "visibility",
  "authorship",
  "is_internal",
  "isInternal",
  "internal_note",
  "internalNote",
  "ai_draft",
  "aiDraft",
  "draft",
  // Identities that a thread must not hand out.
  "author_user_id",
  "authorUserId",
  "user_id",
  "userId",
  "access_token_id",
  "accessTokenId",
  "token_hash",
  "tokenHash",
  "member_role",
  "memberRole",
  // Guarded by the shipped tracking list too. An audit row names who acted;
  // a thread must not hand that identity to another participant.
  "actor_user_id",
  "actorUserId",
  // Tenancy and scope, matching the tracking list's reasoning.
  "business_account_id",
  "businessAccountId",
  "delivery_id",
  "deliveryId",
  "request_id",
  "requestId",
  // Idempotency keys are a replay handle, not customer-facing data.
  "idempotency_key",
  "idempotencyKey",
];
