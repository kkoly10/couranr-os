"use client";

import { call, isApiFailure, type ApiResult } from "@/components/couranr/requests/client";
import type {
  ConversationStatus,
  CustomerTopic,
  DueState,
  ParticipantKind,
  Urgency,
  Visibility,
  WaitingOn,
} from "@/lib/couranr/conversations/states";

/**
 * Browser data access for the three authenticated messaging screens —
 * MER-012, DRV-008 and OPS-005.
 *
 * Goes through `call` rather than a raw fetch, deliberately: `call` attaches
 * the Bearer token every canonical route resolves its actor from, and a
 * hand-rolled fetch carries none. That exact mistake returned 401 the first
 * time the merchant authorize call was driven in a browser.
 *
 * A direct Supabase query from here would return nothing anyway — the four
 * conversation tables are deny-all for `anon` and `authenticated`, and the
 * message table has no table-level SELECT for ANY role. The bodies on this page
 * can only have come through a server route.
 */

export type ConversationSummary = {
  id: string;
  kind: string;
  status: ConversationStatus;
  waitingOn: WaitingOn | null;
  urgency: Urgency;
  dueState: DueState;
  responseDueAt: string | null;
  firstCouranrResponseAt: string | null;
  deliveryId: string | null;
  hasUnread: boolean;
  updatedAt: string;
};

/**
 * What a participant receives of a message.
 *
 * NOTE WHAT IS ABSENT: no `visibility`, no `authorship`, no author user id. The
 * server projection drops them, so an internal note or an AI draft cannot be
 * rendered by this client even by mistake — there is no field to read.
 */
export type ThreadMessage = {
  id: string;
  authoredByPerson: boolean;
  authorParticipantId: string | null;
  topic: CustomerTopic | null;
  body: string;
  createdAt: string;
};

export type ThreadView = {
  conversation: {
    id: string;
    kind: string;
    status: ConversationStatus;
    waitingOn: WaitingOn | null;
    urgency: Urgency;
    dueState: DueState;
    responseDueAt: string | null;
    firstCouranrResponseAt: string | null;
  };
  viewerKind: ParticipantKind;
  messages: ThreadMessage[];
  /** A GENUINE count: these messages have already passed the visibility rule. */
  unreadCount: number;
};

export type InboxView = {
  conversations: ConversationSummary[];
  counts: { overdue: number; dueSoon: number; total: number };
  supportTargetMinutes: number;
  operatingHoursApplied: boolean;
};

export function listConversations(): Promise<ApiResult<{ conversations: ConversationSummary[] }>> {
  return call("/api/couranr/conversations");
}

export function readThread(id: string): Promise<ApiResult<ThreadView>> {
  return call(`/api/couranr/conversations/${encodeURIComponent(id)}`);
}

export function readOperationsThread(id: string): Promise<ApiResult<ThreadView>> {
  return call(`/api/couranr/operations/conversations/${encodeURIComponent(id)}`);
}

/**
 * Sends a message.
 *
 * `visibility` is optional and defaults server-side to `participants`. It is
 * accepted here so Operations can add an internal note from OPS-005 — the one
 * surface allowed to address `couranr_internal`. The route refuses any value
 * the conversation kind does not admit rather than coercing it, because
 * coercion would deliver a note meant for Couranr to everyone in the thread.
 */
export function sendMessage(params: {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  visibility?: Visibility;
  topic?: CustomerTopic | null;
}): Promise<ApiResult<{ messageId: string; replayed: boolean }>> {
  return call(`/api/couranr/conversations/${encodeURIComponent(params.conversationId)}/messages`, {
    method: "POST",
    body: {
      body: params.body,
      idempotencyKey: params.idempotencyKey,
      visibility: params.visibility,
      topic: params.topic ?? null,
    },
  });
}


export function sendOperationsMessage(params: {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  visibility?: Visibility;
  topic?: CustomerTopic | null;
}): Promise<ApiResult<{ messageId: string; replayed: boolean }>> {
  return call(
    `/api/couranr/operations/conversations/${encodeURIComponent(params.conversationId)}/messages`,
    {
      method: "POST",
      body: {
        body: params.body,
        idempotencyKey: params.idempotencyKey,
        visibility: params.visibility,
        topic: params.topic ?? null,
      },
    }
  );
}

export function markRead(id: string): Promise<ApiResult<{ lastReadAt: string }>> {
  return call(`/api/couranr/conversations/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export function loadOperationsInbox(): Promise<ApiResult<InboxView>> {
  return call("/api/couranr/operations/inbox");
}

export { isApiFailure };

/** A per-message key, stable across retries of the same composed message. */
export function newMessageKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
