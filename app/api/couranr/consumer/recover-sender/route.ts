import { NextRequest, NextResponse } from "next/server";
import { recoverSenderGuestSession } from "@/lib/couranr/consumer/senderAccess";
import { isWellFormedAccessToken } from "@/lib/couranr/accessTokens";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Fragment-held sender link exchanges into the original request's guest session. */
export async function POST(req: NextRequest) {
  let token: unknown;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    return routeFailure("not_found", "This sender link is not available.");
  }
  if (!isWellFormedAccessToken(token)) return routeFailure("not_found", "This sender link is not available.");
  const guest = await recoverSenderGuestSession(token);
  if (!guest) return routeFailure("not_found", "This sender link is not available.");
  return NextResponse.json({ guestSession: guest }, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
