import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isCommandFailure, requoteDeliveryRequest } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Long enough to be an explanation, short enough not to be a document. */
const MAX_REASON = 500;

/**
 * POST — Couranr sends a revised quote (REV-001).
 *
 * The body carries a REASON only. It carries no amount: the revised price is
 * recomputed server-side through the canonical pricing engine, and the SQL
 * command independently re-checks that the line items sum to the subtotal.
 * A client cannot propose a number here.
 *
 * The request lands in `quote_revision_required` for both payer types — a
 * changed price always needs the payer's fresh approval.
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

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    return routeFailure("invalid_input", "Say why the quote is being revised.");
  }
  if (reason.length > MAX_REASON) {
    return routeFailure("invalid_input", `Keep the reason under ${MAX_REASON} characters.`);
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await requoteDeliveryRequest({
    actor: actor.actor,
    requestId: params.id,
    expectedVersion,
    reason,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
