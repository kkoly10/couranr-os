import { NextRequest, NextResponse } from "next/server";
import { createGuestSession, isConsumerFailure } from "@/lib/couranr/consumer/send";
import {
  CONSUMER_CANARY_COOKIE,
  createConsumerCanaryGuestSession,
} from "@/lib/couranr/consumer/canary";
import {
  consumerSendProductionEnvironment,
  consumerSendServerLive,
} from "@/lib/couranr/sameday/serverGate";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — mint a guest session.
 *
 * The page being disabled is NOT a security boundary: this public API also
 * fails closed unless the server live switch is armed. In production, arming
 * the two existing live keys still does not open session creation globally —
 * the caller must also hold the HttpOnly canary cookie issued by the one-time
 * canary access flow.
 *
 * Non-production live environments keep the ordinary guest-session path for
 * integration testing. Raw guest tokens are returned exactly once and only
 * their SHA-256 hashes are stored.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  if (consumerSendProductionEnvironment()) {
    const created = await createConsumerCanaryGuestSession(
      req.cookies.get(CONSUMER_CANARY_COOKIE)?.value ?? null
    );
    if (!created.ok) return routeFailure("not_found");
    return NextResponse.json({ guestSession: created.value });
  }

  const r = await createGuestSession();
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({
    guestSession: { token: r.value.token, expiresAt: r.value.expiresAt },
  });
}
