import { NextRequest, NextResponse } from "next/server";
import {
  estimateConsumerSend,
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — price a delivery.
 *
 * The body carries ONLY place identities, the sender's contact and the
 * structured shipment statement. Amounts, states, policy versions and route
 * evidence are all server-derived through the canonical shared pipeline, and
 * a body carrying any of them is refused outright. Service level is fixed
 * `standard` and proof `photo_or_pin` — neither is read from the body.
 *
 * The first call creates the session's one draft (the database binds the
 * session in the same transaction); later calls re-estimate that draft.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send the delivery details as JSON.");
  }

  const r = await estimateConsumerSend({ session: session.value, body });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ estimate: r.value });
}
