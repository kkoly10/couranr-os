import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { HELP_TOKEN_TTL_DAYS, isHelpFailure, issueHelpToken } from "@/lib/couranr/conversations/help";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — issue a Delivery Help link for one delivery. P8-004.
 *
 * WHY THIS EXISTS. Adversarial review found that nothing in the application
 * ever called `issueHelpToken`. The page, the route, the commands and the SQL
 * were all built and correct, and no customer could ever receive a link,
 * because no path minted one. P8-004 was unreachable in production — "dead on
 * arrival" was the finding's own phrase, and it was accurate.
 *
 * OPERATIONS ONLY, and deliberately manual. Issuing a help link is a decision
 * about who gets to talk to Couranr about a delivery, and no authority says
 * when one should be sent automatically — the Master Package specifies that a
 * DELIVERY CHAT "is created after delivery confirmation" and says nothing of
 * the kind about Delivery Help. Rather than invent a trigger, this gives
 * Operations the ability to send one and leaves the policy question open where
 * the spec left it.
 *
 * THE RAW TOKEN IS RETURNED EXACTLY ONCE. It is not stored — only its SHA-256
 * hash is — and it is not logged. A lost link is reissued, never recovered.
 * Callers must treat the response body as a credential.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  // Crossing business accounts by design: Operations issues for any delivery.
  // A merchant is refused before anything is read or minted.
  if (actor.actor.kind !== "operations") {
    return routeFailure("not_permitted", "Only Couranr Operations can issue a help link.");
  }

  const deliveryId = (await ctx.params)?.id || "";
  if (!UUID_RE.test(deliveryId)) {
    return routeFailure("not_found", "That delivery is not available.");
  }

  let ttlDays = HELP_TOKEN_TTL_DAYS;
  try {
    const payload = await req.json();
    if (payload?.ttlDays !== undefined) {
      const n = Number(payload.ttlDays);
      // Clamped rather than trusted. A caller-supplied TTL is how a link meant
      // for two weeks becomes one that works for a decade.
      if (!Number.isFinite(n) || n < 1 || n > 30) {
        return routeFailure("invalid_input", "A help link lasts between 1 and 30 days.");
      }
      ttlDays = Math.trunc(n);
    }
  } catch {
    // No body is fine — the default TTL applies.
  }

  const result = await issueHelpToken({ deliveryId, ttlDays });
  if (isHelpFailure(result)) return failureResponse(result);

  return NextResponse.json(
    {
      // The only time this value exists outside the customer's browser.
      token: result.value.token,
      expiresInDays: result.value.expiresInDays,
      // A relative path, not an absolute URL: the host belongs to whatever
      // surface sends the link, and baking one in here would hardcode an
      // environment into a credential.
      path: `/help/${result.value.token}`,
    },
    { status: 201 }
  );
}
