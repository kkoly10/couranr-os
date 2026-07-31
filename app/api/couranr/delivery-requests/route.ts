import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDeliveryRequestDraft,
  isCommandFailure,
  listDeliveryRequests,
} from "@/lib/couranr/requests/commands";
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
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return NextResponse.json({ error: "A business account is required." }, { status: 400 });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const idempotencyKey = readIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "An Idempotency-Key header is required." },
      { status: 400 }
    );
  }

  const result = await createDeliveryRequestDraft({
    actor: actor.actor,
    businessAccountId,
    // `request` carries the shipment only. `businessAccountId` and the
    // idempotency key are read above and are not part of the priced input.
    rawInput: body?.request,
    idempotencyKey,
  });

  if (isCommandFailure(result)) {
    return NextResponse.json(
      { error: result.error, code: result.code, details: result.details },
      { status: result.status }
    );
  }

  return NextResponse.json(
    { request: toDeliveryRequestView(result.value.request) },
    { status: 201 }
  );
}

/** GET — this business's delivery requests. */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return NextResponse.json({ error: "A business account is required." }, { status: 400 });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const result = await listDeliveryRequests({ actor: actor.actor, businessAccountId });
  if (isCommandFailure(result)) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  return NextResponse.json({ requests: result.value.map(toDeliveryRequestView) });
}
