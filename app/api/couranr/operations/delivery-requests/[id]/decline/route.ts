import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { declineDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NOTE = 1000;

/**
 * POST — Couranr could not confirm service (REV-001).
 *
 * The reason is a code from a fixed allow-list, validated in the command layer;
 * the internal note is optional except for `other`, and is never shown to the
 * merchant by this slice. Both are recorded in the append-only event log.
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

  const internalNote = typeof body?.internalNote === "string" ? body.internalNote.trim() : "";
  if (internalNote.length > MAX_NOTE) {
    return routeFailure("invalid_input", `Keep the note under ${MAX_NOTE} characters.`);
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await declineDeliveryRequest({
    actor: actor.actor,
    requestId: params.id,
    expectedVersion,
    // Passed through unvalidated on purpose: the command owns the allow-list,
    // so there is one place that decides what a legal reason is.
    reason: body?.reason,
    internalNote: internalNote.length > 0 ? internalNote : null,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
