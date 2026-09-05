import { NextRequest, NextResponse } from "next/server";
import {
  CONSUMER_CANARY_COOKIE,
  newConsumerCanaryCookieSecret,
  redeemConsumerCanaryAccess,
} from "@/lib/couranr/consumer/canary";
import {
  consumerSendProductionEnvironment,
  consumerSendServerLive,
} from "@/lib/couranr/sameday/serverGate";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Internal production-canary bootstrap.
 *
 * The raw one-time access token arrives in the POST BODY, not the URL, so it
 * does not enter browser history, referrers or normal request-path logs. A
 * successful redemption replaces it with an HttpOnly same-site cookie whose
 * hash — and only the hash — is persisted.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive() || !consumerSendProductionEnvironment()) {
    return routeFailure("not_found");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return routeFailure("not_found");
  }
  const rawAccessToken = form.get("token");
  const cookieSecret = newConsumerCanaryCookieSecret();
  const redeemed = await redeemConsumerCanaryAccess({
    rawAccessToken,
    rawCookieSecret: cookieSecret,
  });
  if (!redeemed.ok) {
    return NextResponse.redirect(new URL("/send/canary?invalid=1", req.url), 303);
  }

  const expires = new Date(redeemed.value.expiresAt);
  const response = NextResponse.redirect(new URL("/send", req.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(CONSUMER_CANARY_COOKIE, cookieSecret, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires,
  });
  return response;
}
