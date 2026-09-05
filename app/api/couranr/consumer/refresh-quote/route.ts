import { NextRequest, NextResponse } from "next/server";
import {
  refreshConsumerSendQuote,
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — re-price the session's OWN request from its STORED
 * canonical facts (final closure pass §5).
 *
 * Takes NO body at all: a resumed page has lost its form inputs, and nothing
 * a browser could post here is authoritative anyway. The server rebuilds the
 * estimate from the request's stored address snapshots, weight statement,
 * declaration and description — same pipeline, same policy scanner, same QVL
 * clock — and refuses (rather than fabricates) when the stored facts cannot
 * be re-verified. Draft or awaiting-authorization only; a request past payer
 * authorization or inside Couranr review is never re-priced from here.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await refreshConsumerSendQuote({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ estimate: r.value });
}
