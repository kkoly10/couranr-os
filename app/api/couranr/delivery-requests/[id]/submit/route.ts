import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isCommandFailure, submitDeliveryRequest } from "@/lib/couranr/requests/commands";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — submit a draft for Couranr review.
 *
 * Submitting creates NO order, NO delivery row and NO payment. It moves the
 * request to `pending_couranr_review` and nothing else.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Delivery request not found." }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return NextResponse.json({ error: "A business account is required." }, { status: 400 });
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion)) {
    return NextResponse.json({ error: "A request version is required." }, { status: 400 });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const result = await submitDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
    expectedVersion,
  });

  if (isCommandFailure(result)) {
    return NextResponse.json(
      { error: result.error, code: result.code, details: result.details },
      { status: result.status }
    );
  }

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
