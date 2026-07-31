import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  beginDeliveryRequestReview,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — record that Couranr Operations opened a request for review.
 *
 * This does NOT decide the outcome. Accept-as-quoted, requote and decline are
 * canonical states that no command in this release can reach.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A request version is required.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await beginDeliveryRequestReview({
    actor: actor.actor,
    requestId: params.id,
    expectedVersion,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
