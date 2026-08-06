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

// HRS-002. Pure, dependency-free and browser-safe, like the rest of this module.
import {
  addOperatingMinutes,
  isWithinOperatingHours,
  nextOperatingPeriodStart,
  operatingMinutesBetween,
} from "@/lib/couranr/hours/operatingHours";

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
 * These are OPERATING minutes, not wall-clock minutes. `TRM-001` records
 * `support_target_applies: "during operating hours"`, so the clock runs while
 * Couranr is open and stops while it is closed.
 */
export const DUE_SOON_MINUTES = 10;
export const OVERDUE_MINUTES = 15;

/** The support target, stated as a normal response and never as a guarantee. */
export const SUPPORT_TARGET_MINUTES = 15;

/**
 * HRS-002 IS NOW RESOLVED — the zone is America/New_York, decided by the owner
 * on 2026-08-06 and recorded in the root `02_DECISION_REGISTRY.json`.
 *
 * An earlier revision of this file said the opposite, and said it at length:
 * that the after-hours rules "cannot be applied without knowing which zone
 * Monday-Friday 06:00-18:00 is expressed in". That was correct at the time.
 * The deadline was a flat 15 wall-clock minutes, which was right for a message
 * received at 2pm and wrong for one received at 2am.
 *
 * WHAT CHANGED, PRECISELY. For an ordinary in-hours message nothing changes —
 * 10:00 + 15 is still 10:15, and the existing tests of that case pass
 * unmodified. Only the cases the flat rule got wrong move:
 *
 *   Friday 17:58 -> was Friday 18:13 (thirteen minutes into a closed office),
 *                   now Monday 06:13
 *   Saturday 12:00 -> was Saturday 12:15, now Monday 06:15
 *
 * Both previously marked a thread overdue while nobody was meant to be
 * answering, which is what made the Operations queue unusable outside hours.
 */
export function dueStateAt(receivedAt: Date, now: Date): DueState {
  const minutes = operatingMinutesBetween(receivedAt, now);
  if (minutes >= OVERDUE_MINUTES) return "overdue";
  if (minutes >= DUE_SOON_MINUTES) return "due_soon";
  return "on_time";
}

/**
 * The response deadline: 15 OPERATING minutes after receipt, in
 * America/New_York, rolling over any closed period.
 */
export function responseDueAt(receivedAt: Date): Date {
  return addOperatingMinutes(receivedAt, OVERDUE_MINUTES);
}

/**
 * The value for `couranr_conversations.next_operating_period_at`.
 *
 * The column has existed since `20260804150000` and was never written, because
 * it is the one deadline field that genuinely needed the zone. It is written
 * now.
 *
 * Returns null when the conversation was received DURING operating hours,
 * because there is no rollover to record — a non-null value means "this arrived
 * while Couranr was closed and the clock starts here", and writing the
 * receipt instant into it for an in-hours message would erase that distinction.
 */
export function nextOperatingPeriodAt(receivedAt: Date): Date | null {
  if (isWithinOperatingHours(receivedAt)) return null;
  return nextOperatingPeriodStart(receivedAt);
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
 * TRM-002 — merchant team role permissions for conversations.
 *
 * DECIDED BY THE OWNER, 2026-08-06. Recorded in the root
 * `02_DECISION_REGISTRY.json`; `tests/decision-registry-provenance.test.ts`
 * pins the record and this table is asserted against it.
 *
 *   owner       read + send
 *   manager     read + send
 *   dispatcher  read + send
 *   viewer      NO ACCESS
 *   billing     NO ACCESS
 *
 * THIS REPLACES AN ANALOGY, AND CHANGES BEHAVIOUR.
 *
 * The previous allow-list was the same three roles, but it was reasoned by
 * analogy to DRP-001 request authority because TRM-002 was `unresolved`. An
 * analogy is not a decision, and the registry now withdraws it explicitly.
 *
 * The substantive change is the READ half. The old model gated SENDING only —
 * `commands.ts` said in as many words that "a viewer or billing member may read
 * a thread and may not post to it". A support thread carries customer contact
 * details, address concerns and Couranr internal context, so read is not the
 * safe default. Both are refused now.
 */
export const MERCHANT_CONVERSATION_PERMISSIONS: Record<
  string,
  { read: boolean; send: boolean }
> = {
  owner: { read: true, send: true },
  manager: { read: true, send: true },
  dispatcher: { read: true, send: true },
  viewer: { read: false, send: false },
  billing: { read: false, send: false },
};

/** The roles TRM-002 grants send. Derived, so the two can never disagree. */
export const CONVERSATION_POST_ROLES = Object.freeze(
  Object.keys(MERCHANT_CONVERSATION_PERMISSIONS).filter(
    (r) => MERCHANT_CONVERSATION_PERMISSIONS[r].send
  )
) as readonly string[];

/** The roles TRM-002 grants read. */
export const CONVERSATION_READ_ROLES = Object.freeze(
  Object.keys(MERCHANT_CONVERSATION_PERMISSIONS).filter(
    (r) => MERCHANT_CONVERSATION_PERMISSIONS[r].read
  )
) as readonly string[];

/**
 * FAILS CLOSED. An unrecognised role — null, a typo, or a sixth role added to
 * the schema before TRM-002 is extended — is refused rather than allowed. A
 * permission table that defaults open is how a new role silently gains access.
 */
export function memberMayRead(role: string | null | undefined): boolean {
  if (typeof role !== "string") return false;
  return MERCHANT_CONVERSATION_PERMISSIONS[role]?.read === true;
}

export function memberMayPost(role: string | null | undefined): boolean {
  if (typeof role !== "string") return false;
  return MERCHANT_CONVERSATION_PERMISSIONS[role]?.send === true;
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
