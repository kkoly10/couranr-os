import { NextRequest, NextResponse } from "next/server";
import {
  isConsumerFailure,
  redeemGuestSessionToken,
  setConsumerPickupReadiness,
} from "@/lib/couranr/consumer/send";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Consumer pickup readiness.
 *
 * The raw guest token names the session; the body can name only one of two
 * readiness declarations. It cannot name a request, business, target state,
 * money value, route or schedule.
 */
export async function POST(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const readiness =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).readiness
      : null;
  if (readiness !== "ready" && readiness !== "not_ready") {
    return routeFailure("invalid_input", "Choose whether the pickup is ready.");
  }

  const result = await setConsumerPickupReadiness({
    session: session.value,
    readiness,
  });
  if (isConsumerFailure(result)) return failureResponse(result);

  if (readiness === "ready" && session.value.requestId) {
    await advanceAutomaticFulfillment(String(session.value.requestId));
  }

  return NextResponse.json({
    readiness: {
      state: result.value.readinessState,
      requestVersion: result.value.requestVersion,
    },
  });
}
