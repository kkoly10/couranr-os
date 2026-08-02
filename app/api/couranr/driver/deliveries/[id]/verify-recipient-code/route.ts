import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, verifyRecipientPin } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Generous next to the six digits a real code has; anything longer is refused
 *  before it can be hashed or logged. */
const MAX_CODE_LENGTH = 32;

/**
 * POST — the driver submits the recipient's drop-off code.
 *
 * A separate route from the pickup code, not a `kind` parameter, because the
 * two are separate credentials held by different people with separate HMAC
 * domains, generations and lockouts. A parameter would be one typo away from
 * verifying a pickup code as a drop-off one.
 *
 * The code travels in the body only, and an over-long submission is answered
 * as `invalid` — the same answer a wrong code gets.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const r = await verifyRecipientPin({ userId: auth.userId, deliveryId: params.id, code });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ outcome: r.value.outcome });
}
