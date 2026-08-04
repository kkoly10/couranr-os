import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isConversationFailure,
  listOperationsInbox,
  refreshDueStates,
} from "@/lib/couranr/conversations/commands";
import { SUPPORT_TARGET_MINUTES } from "@/lib/couranr/conversations/states";

export const dynamic = "force-dynamic";

/**
 * GET — OPS-005, the Couranr Operations Inbox. P8-002.
 *
 * A PROJECTION across all three conversation kinds rather than a fourth kind,
 * because UI_SCREEN_REGISTRY.md:604 gives OPS-005's purpose as "Unify merchant,
 * driver, and customer-help conversations with delivery context and priority."
 *
 * Operations only. This read deliberately crosses business accounts, so a
 * merchant is refused before any query runs — the same shape
 * `/api/couranr/operations/queue` uses.
 *
 * Due states are recomputed on read. Nothing runs at minute 10 to move a thread
 * to `due_soon`, and this repository has no scheduler; refreshing here means
 * the inbox is never stale to the person actually looking at it. The write is
 * idempotent — a thread already in the right state is skipped.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (actor.actor.kind !== "operations") {
    return routeFailure("not_permitted", "This inbox is for Couranr Operations.");
  }

  // Best effort: a failure to refresh must not deny Operations their inbox.
  // The stored states are stale rather than wrong, and a queue you cannot open
  // is worse than one whose marks are a minute behind.
  await refreshDueStates();

  const result = await listOperationsInbox();
  if (isConversationFailure(result)) return failureResponse(result);

  const conversations = result.value;

  return NextResponse.json({
    conversations,
    counts: {
      overdue: conversations.filter((c) => c.dueState === "overdue").length,
      dueSoon: conversations.filter((c) => c.dueState === "due_soon").length,
      total: conversations.length,
    },
    // Stated as a normal response and never as a guarantee — PUB-007's
    // mandatory correction, which applies wherever the target is shown.
    supportTargetMinutes: SUPPORT_TARGET_MINUTES,
    // HRS-002 is unresolved, so no operating-hours window is computed anywhere.
    // Surfaced rather than hidden: a caller must not infer that a thread marked
    // on-time has been assessed against operating hours.
    operatingHoursApplied: false,
  });
}
