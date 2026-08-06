import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, verifyPickupPin } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Generous next to the six digits a real code has; anything longer is refused
 *  before it can be hashed or logged. */
const MAX_CODE_LENGTH = 32;

/**
 * POST — the driver submits the sender's pickup code.
 *
 * THE CODE IS IN THE BODY, NEVER IN THE PATH OR THE QUERY STRING. A URL is
 * written to access logs, proxy logs, browser history and the Referer header;
 * a credential in one is a credential in all of them.
 *
 * The response is an OUTCOME, not a thrown failure. A wrong code is an
 * ordinary business event and the attempt counter it increments is what makes
 * a six-digit credential safe at all — turning it into an error would lose the
 * counter and hand a caller a cheaper retry loop.
 *
 * An over-long submission is answered as `invalid`, byte-identical to a wrong
 * code, so the response shape can never be used to probe what a valid one
 * looks like.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ outcome: "invalid" });
  }

  const r = await verifyPickupPin({ userId: auth.userId, deliveryId: params.id, code });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ outcome: r.value.outcome });
}
