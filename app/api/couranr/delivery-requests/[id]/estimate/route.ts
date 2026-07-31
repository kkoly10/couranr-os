import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  calculateDeliveryRequestEstimate,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — recompute the estimate for a draft.
 *
 * The body carries no amount and no target status: only which request, which
 * business, the version the caller believes it is acting on, and optionally an
 * edited shipment. A draft is editable, so re-pricing must price the edit —
 * otherwise the merchant sees an estimate for values they already changed.
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

  const result = await calculateDeliveryRequestEstimate({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
    expectedVersion,
    // Undefined when the caller only wants a re-price of what is stored.
    rawInput: body?.request,
  });

  if (isCommandFailure(result)) {
    return NextResponse.json(
      { error: result.error, code: result.code, details: result.details },
      { status: result.status }
    );
  }

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
