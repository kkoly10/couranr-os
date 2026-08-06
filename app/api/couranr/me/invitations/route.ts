import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import {
  acceptInvitation,
  isSettingsFailure,
  listMyInvitations,
} from "@/lib/couranr/settings/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-015's other side — the invitee's own pending invitations.
 *
 * Takes NO tenant parameter. The scope is the caller's own membership rows, so
 * there is nothing here for a future change to forget to validate: a caller
 * can only ever see invitations addressed to themselves.
 *
 * This is what makes an invite real without an email delivery mechanism. The
 * authorization already happened when an owner or manager created the
 * invitation; accepting is the invitee acting on their own row.
 */
export async function GET(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const result = await listMyInvitations({ userId: user.userId });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json(result.value);
}

/** POST — accept one. The actor is the invitee; there is no other way in. */
export async function POST(req: NextRequest) {
  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const result = await acceptInvitation({ userId: user.userId, businessAccountId });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json({ member: result.value.member });
}
