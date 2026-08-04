/**
 * The conversation vocabularies, and the rules that are pure functions of them.
 *
 * NO DATABASE ACCESS AND NO SECRETS. This module is deliberately importable
 * from a browser bundle so a screen can label a state without a round trip.
 * Everything that touches a row lives in `commands.ts`, which is server-only.
 *
 * Every closed set here is quoted from an authority. Where the two authorities
 * differ — and on the forbidden-mutation list they do — the union is used and
 * the difference is named.
 */

/* ------------------------------------------------------------ conversations */

/**
 * Master Package §12 lists four conversation TYPES, the fourth being the
 * Couranr Operations Inbox. Only three are row kinds.
 *
 * The Inbox is a projection over the other three, not a fourth kind, because
 * UI_SCREEN_REGISTRY.md:604 states OPS-005's purpose as "Unify merchant,
 * driver, and customer-help conversations with delivery context and priority."
 * A thing whose stated purpose is to unify the other three is a view over them.
 * Modelling it as a kind would mean a thread could be an Operations Inbox
 * conversation INSTEAD OF a merchant support one, which is not what it is —
 * Operations participates in all three.
 */
export const CONVERSATION_KINDS = [
  "merchant_support",
  "delivery_chat",
  "delivery_help",
] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/**
 * The four-value closed set, verbatim from §Conversation permissions. No fifth
 * value may be invented and none may be dropped.
 */
export const VISIBILITIES = [
  "participants",
  "couranr_internal",
  "driver_and_couranr",
  "merchant_and_couranr",
] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * `human` is a person typing.
 *
 * `automated` is a system acknowledgement, and it is a distinct value because
 * the spec says "Automated acknowledgement does not count as Operations
 * response" — a rule that cannot be applied unless the two are distinguishable
 * at the row level.
 *
 * `ai_draft` is a suggestion that has not been sent. It must never reach any
 * participant, including Operations, through a thread read.
 */
export const AUTHORSHIPS = ["human", "automated", "ai_draft"] as const;
export type Authorship = (typeof AUTHORSHIPS)[number];

export const PARTICIPANT_KINDS = ["merchant", "driver", "operations", "customer"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

/**
 * The seven topics a customer may report, verbatim: "Customer may report
 * availability, access, address concern, handoff concern, unrecognized
 * delivery, delivery problem, or other."
 *
 * `delivery_problem` is a TOPIC and is in scope. CUS-004 — the delivery problem
 * report screen with structured evidence and a claims workflow — is deferred by
 * GAT-002. A customer saying "something is wrong" is not an adjudicated claim.
 */
export const CUSTOMER_TOPICS = [
  "availability",
  "access",
  "address_concern",
  "handoff_concern",
  "unrecognized_delivery",
  "delivery_problem",
  "other",
] as const;
export type CustomerTopic = (typeof CUSTOMER_TOPICS)[number];

/** Unioned from the required states of PUB-007, MER-012, DRV-008 and OPS-005. */
export const CONVERSATION_STATUSES = [
  "open",
  "waiting",
  "resolved",
  "closed",
  "escalated",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const WAITING_ON = ["couranr", "merchant", "driver", "customer"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export const URGENCIES = ["routine", "urgent", "safety"] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * The spec names exactly two marks: "At 10 minutes mark due soon; at 15
 * overdue." `on_time` is their absence, not a third mark.
 */
export const DUE_STATES = ["on_time", "due_soon", "overdue"] as const;
export type DueState = (typeof DUE_STATES)[number];

/* -------------------------------------------------------------- the deadline */

/**
 * "At 10 minutes mark due soon; at 15 overdue."
 *
 * Pure elapsed-time arithmetic, which is why it can ship while HRS-002 is
 * unresolved: minutes since receipt need no timezone. What DOES need one is the
 * next-operating-period rollover, and that is not computed anywhere.
 */
export const DUE_SOON_MINUTES = 10;
export const OVERDUE_MINUTES = 15;

/** The support target, stated as a normal response and never as a guarantee. */
export const SUPPORT_TARGET_MINUTES = 15;

export function dueStateAt(receivedAt: Date, now: Date): DueState {
  const minutes = (now.getTime() - receivedAt.getTime()) / 60_000;
  if (minutes >= OVERDUE_MINUTES) return "overdue";
  if (minutes >= DUE_SOON_MINUTES) return "due_soon";
  return "on_time";
}

/**
 * The response deadline: 15 minutes after receipt.
 *
 * DELIBERATELY IGNORES OPERATING HOURS. The spec's after-hours rules — "Human
 * required ordinary cases wait until next operating period" — cannot be applied
 * without knowing which zone Monday–Friday 06:00–18:00 is expressed in, and
 * HRS-002 is `unresolved` with the acceptance criterion "A named IANA timezone
 * is recorded before any cutoff logic ships."
 *
 * So this returns the in-hours deadline unconditionally. That is WRONG for a
 * message received at 2am and right for one received at 2pm. It is wrong in the
 * safe direction — it marks a thread overdue sooner than the spec requires,
 * never later — but it is still a known gap, recorded in
 * docs/couranr-mvp/ACTIVE_EXECUTION_SLICE.md under HRS-002 rather than papered
 * over with a guessed zone.
 */
export function responseDueAt(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + OVERDUE_MINUTES * 60_000);
}

/* ------------------------------------------------------ the visibility rule */

/**
 * Which participant kinds may see which visibility.
 *
 * This MIRRORS the predicate inside `couranr_conversation_thread`. The database
 * is the authority — nobody holds SELECT on the message table, so this function
 * cannot be the thing that leaks. It exists so a screen can explain why a
 * message is marked internal, and so a test can assert the two agree.
 *
 * `tests/couranr-conversations.test.ts` asserts this table against the SQL text
 * of the migration, so the two cannot drift silently.
 */
export function canSee(kind: ParticipantKind, visibility: Visibility): boolean {
  switch (visibility) {
    case "participants":
      return true;
    case "couranr_internal":
      return kind === "operations";
    case "driver_and_couranr":
      return kind === "driver" || kind === "operations";
    case "merchant_and_couranr":
      return kind === "merchant" || kind === "operations";
    default:
      // An unrecognised visibility FAILS CLOSED. If a fifth value is ever added
      // to the CHECK constraint and this switch is not updated, the message is
      // hidden from everyone rather than shown to everyone.
      return false;
  }
}

/**
 * AI drafts are excluded for every viewer, with no exception for Operations.
 *
 * Separate from `canSee` because it is not a visibility question: a draft is
 * unsent, and unsent is orthogonal to who it would be addressed to. The
 * surface that composes a draft fetches it by id, never through a thread.
 */
export function isReadableInThread(authorship: Authorship): boolean {
  return authorship !== "ai_draft";
}

/* ------------------------------------------- what a message may never touch */

/**
 * "A message never directly mutates address, price, payer, cancellation,
 * return, proof, or state." — Master Package §Conversation permissions.
 *
 * "Messages never directly mutate address, price, cancellation, refund,
 * return, proof, or state." — UI_SCREEN_REGISTRY.md:395, MER-012.
 *
 * THE TWO LISTS DIFFER. The Master Package names `payer`; MER-012 names
 * `refund`. Neither is a superset. The union of eight is used, because a rule
 * that protects a field in one authority and not the other is not a rule.
 */
export const MESSAGE_MAY_NOT_MUTATE = [
  "address",
  "price",
  "payer",
  "cancellation",
  "refund",
  "return",
  "proof",
  "state",
] as const;

/* ----------------------------------------------------------- role authority */

/**
 * Which merchant roles may POST to a conversation.
 *
 * TRM-002 is `unresolved`: "Each of the five roles has an explicit permission
 * set before MER-015 ships." The spec says merchant support "includes
 * authorized merchant roles and Couranr", so which roles are authorized is
 * precisely the open decision — this module does not get to make it.
 *
 * What it does instead is mirror the already-approved DRP-001 shape from
 * lib/couranr/requests/permissions.ts, where owner/manager/dispatcher may write
 * and every active member may read. Starting narrow is the reversible choice:
 * widening later is additive, narrowing later takes away an ability people have
 * been using.
 */
export const CONVERSATION_POST_ROLES = ["owner", "manager", "dispatcher"] as const;

export function memberMayPost(role: string | null | undefined): boolean {
  return typeof role === "string" && (CONVERSATION_POST_ROLES as readonly string[]).includes(role);
}

/* -------------------------------------------------------------- type guards */

export const isConversationKind = (v: unknown): v is ConversationKind =>
  typeof v === "string" && (CONVERSATION_KINDS as readonly string[]).includes(v);

export const isVisibility = (v: unknown): v is Visibility =>
  typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);

export const isCustomerTopic = (v: unknown): v is CustomerTopic =>
  typeof v === "string" && (CUSTOMER_TOPICS as readonly string[]).includes(v);

export const isParticipantKind = (v: unknown): v is ParticipantKind =>
  typeof v === "string" && (PARTICIPANT_KINDS as readonly string[]).includes(v);
