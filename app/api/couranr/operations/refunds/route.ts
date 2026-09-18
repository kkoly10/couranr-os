import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isRefundReviewFailure,
  listRefundRequests,
  openRefundRequest,
} from "@/lib/couranr/operations/refunds";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the OPS-011 review queue.
 *
 * Operations only, which the command re-checks for itself: REF-001 says no
 * refund path exists outside Couranr Operations, so the gate lives in the
 * command rather than only here.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await listRefundRequests({ actor: actor.actor });
  if (isRefundReviewFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refundRequests: result.value.refundRequests });
}

/**
 * POST — record an inbound delivery-charge refund request for review.
 *
 * Carries NO figure. What a delivery charge is worth is the obligation's
 * business, and the refundable ceiling is computed in SQL at decision time —
 * so there is deliberately nothing money-shaped on this path at all.
 *
 * `requestedBy` says who asked; it never says who decides.
 */
export async function POST(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a delivery request, a requester and a governed reason.");
  }

  const deliveryRequestId = typeof body?.deliveryRequestId === "string" ? body.deliveryRequestId : "";
  if (!UUID_RE.test(deliveryRequestId)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  const incidentId = typeof body?.incidentId === "string" ? body.incidentId : null;
  if (incidentId !== null && !UUID_RE.test(incidentId)) {
    return routeFailure("invalid_input", "That incident reference is not valid.");
  }
  const problemReportId = typeof body?.problemReportId === "string" ? body.problemReportId : null;
  if (problemReportId !== null && !UUID_RE.test(problemReportId)) {
    return routeFailure("invalid_input", "That problem report reference is not valid.");
  }

  const result = await openRefundRequest({
    actor: actor.actor,
    deliveryRequestId,
    requestedBy: body?.requestedBy,
    reasonCode: body?.reasonCode,
    detail: typeof body?.detail === "string" ? body.detail : "",
    incidentId,
    problemReportId,
  });
  if (isRefundReviewFailure(result)) return failureResponse(result);

  return NextResponse.json({ refundRequest: result.value });
}
