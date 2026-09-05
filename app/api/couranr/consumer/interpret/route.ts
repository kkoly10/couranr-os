import { NextRequest, NextResponse } from "next/server";
import { redeemGuestSessionToken, isConsumerFailure } from "@/lib/couranr/consumer/send";
import { interpretConsumerDescription } from "@/lib/couranr/consumer/intake";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — Consumer Smart Intake (INT-002).
 *
 * The guest's description of what they are sending, interpreted on the SAME
 * Smart Intake substrate merchants use. The body is `{ description }` and
 * nothing else; it is handed to the server lib VERBATIM — the route never
 * dereferences it — and the lib refuses any other key before anything runs.
 * The description is HOSTILE UNTRUSTED DATA: persisted as evidence, shown to
 * the provider as data-only, granting no authority over price, policy, route
 * or state. A proposal comes back as structured facts the guest must choose;
 * the model's free text never reaches this response.
 *
 * With the kill switch off (COURANR_CONSUMER_INTAKE unset) this answers
 * `unavailable` with zero provider calls and zero writes.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const r = await interpretConsumerDescription({ session: session.value, body });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ intake: r.value });
}
