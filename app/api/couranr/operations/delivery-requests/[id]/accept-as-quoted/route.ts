import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  acceptDeliveryRequestAsQuoted,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — Couranr confirms the request at its stored quote (REV-001).
 *
 * The route accepts NO amount and NO target state. The price comes off the
 * stored request inside the SQL command. A merchant self-service request whose
 * submission recorded payer approval may become `confirmed`. A truthful
 * Operations-assisted merchant request has acknowledgment=false, so Couranr
 * may confirm service while leaving it at `awaiting_quote_acceptance` for the
 * real Business payer. Customer-paid requests likewise cannot be approved by
 * Operations.
 *
 * Confirming authorizes no payment, captures no payment, and creates no order
 * and no delivery.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const result = await acceptDeliveryRequestAsQuoted({
    actor: actor.actor,
    requestId: params.id,
    expectedVersion,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
