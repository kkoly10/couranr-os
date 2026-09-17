import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { denyRefundRequest, isRefundReviewFailure } from "@/lib/couranr/operations/refunds";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — deny a delivery-charge refund request (OPS-011 "deny").
 *
 * A denial is a RECORDED DECISION, not a dismissal: it carries the decider,
 * the moment and a written reason, and the SQL refuses an empty one. Money
 * never moves on this path and no provider is contacted.
 *
 * Safe to replay: a denial replayed is the same denial.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Refund request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Say why this refund is being denied, and name the version you are deciding on.");
  }

  const expectedVersion = body?.expectedVersion;
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "Send the version of the refund request you are deciding on.");
  }

  const denialReason = typeof body?.denialReason === "string" ? body.denialReason : "";
  if (!denialReason.trim()) {
    return routeFailure("invalid_input", "Say why this delivery-charge refund is being denied.");
  }

  const result = await denyRefundRequest({
    actor: actor.actor,
    refundRequestId: params.id,
    expectedVersion,
    denialReason,
  });
  if (isRefundReviewFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refundRequest: result.value });
}
