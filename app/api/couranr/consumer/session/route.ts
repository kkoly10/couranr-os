import { NextResponse } from "next/server";
import { createGuestSession, isConsumerFailure } from "@/lib/couranr/consumer/send";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — mint a guest session.
 *
 * UNAUTHENTICATED BY DESIGN: the returned token IS the authorization for the
 * whole funnel — 256 bits of entropy, stored only as a SHA-256 hash, alive at
 * most 24 hours, reaching exactly one delivery request. Every other consumer
 * route redeems it (shape-checked, uniform refusal) before doing anything.
 * The raw token appears in this response EXACTLY ONCE and is never
 * recoverable afterwards.
 */
export async function POST() {
  const r = await createGuestSession();
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({
    guestSession: { token: r.value.token, expiresAt: r.value.expiresAt },
  });
}
