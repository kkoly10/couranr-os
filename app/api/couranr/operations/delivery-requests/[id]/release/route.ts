import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { releaseAuthorization, isFulfillmentFailure } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bounded so a paste cannot put an essay into an audit row. */
const REASON_MAX = 500;

/**
 * POST — release an authorized hold back to the payer.
 *
 * The counterpart to `capture`, and the thing whose absence stranded money:
 * before this route existed `paymentIntents.cancel` appeared nowhere in the
 * codebase, so an authorized hold could be observed and recorded but never
 * given back, and the payer's funds sat until the card network expired them.
 *
 * The body carries NO amount and NO target state. A release is always the
 * whole hold — CAN-001 fixes `charge_cents: 0` — and the destination is fixed
 * by the command, not named by the caller (TRN-001). The only thing the caller
 * supplies is a REASON, which is required, because this is a decision an
 * operator made and the audit row should say why.
 *
 * Safe to retry. `couranr_begin_payment_release` returns `ignored` on an
 * already-released hold, and if the Stripe call fails the obligation is left
 * truthfully `authorized` rather than claiming funds were freed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Say why this hold is being released.");
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return routeFailure("invalid_input", "Say why this hold is being released.");
  if (reason.length > REASON_MAX) {
    return routeFailure("invalid_input", "That reason is too long.");
  }

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await releaseAuthorization({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    reason,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route. Typing this
  // flat is invisible to tsc — the routes return untyped JSON — and the client
  // reads `release.paymentState`.
  return NextResponse.json({
    release: {
      obligationId: result.value.obligationId,
      paymentState: result.value.paymentState,
    },
  });
}
