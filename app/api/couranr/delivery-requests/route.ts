import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDeliveryRequestDraft,
  isCommandFailure,
  listDeliveryRequests,
} from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rejects an idempotency key that is absent, oversized or not plain text. */
function readIdempotencyKey(req: NextRequest, body: any): string | null {
  const raw = req.headers.get("idempotency-key") || body?.idempotencyKey;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

/** POST — create a delivery-request draft and price it server-side. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const idempotencyKey = readIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return routeFailure("invalid_input", "An Idempotency-Key header is required.");
  }

  const result = await createDeliveryRequestDraft({
    actor: actor.actor,
    businessAccountId,
    // `request` carries the shipment only. `businessAccountId` and the
    // idempotency key are read above and are not part of the priced input.
    rawInput: body?.request,
    idempotencyKey,
    intakeSessionId:
      typeof body?.intakeSessionId === "string" && UUID_RE.test(body.intakeSessionId)
        ? body.intakeSessionId
        : null,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json(
    { request: toDeliveryRequestView(result.value.request) },
    { status: 201 }
  );
}

/** GET — this business's delivery requests. */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await listDeliveryRequests({ actor: actor.actor, businessAccountId });
  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ requests: result.value.map(toDeliveryRequestView) });
}
