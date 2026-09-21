import { NextRequest, NextResponse } from "next/server";
import {
  isConsumerFailure, redeemGuestSessionToken, requestSenderCancellationReview,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");
  let body: unknown;
  try { body = await req.json(); }
  catch { return routeFailure("invalid_input", "Send a JSON body."); }
  const note = (body as { note?: unknown })?.note;
  const idempotencyKey = (body as { idempotencyKey?: unknown })?.idempotencyKey;
  if (typeof note !== "string" || typeof idempotencyKey !== "string") {
    return routeFailure("invalid_input", "Describe the request and include its retry key.");
  }
  const result = await requestSenderCancellationReview({ session: session.value, note, idempotencyKey });
  if (isConsumerFailure(result)) return failureResponse(result);
  return NextResponse.json({ review: { eventId: result.value.eventId, changedDelivery: false } }, { status: 201 });
}
