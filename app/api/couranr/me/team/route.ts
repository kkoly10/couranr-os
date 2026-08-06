import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  inviteMember,
  isSettingsFailure,
  listTeamMembers,
  settingsActorFrom,
} from "@/lib/couranr/settings/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** MER-015 — the team of one business. Every active member may read it. */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  const result = await listTeamMembers({ actor, businessAccountId });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json(result.value);
}

/**
 * POST — invite an existing Couranr user.
 *
 * No mail is sent and none is claimed to be: the response says an invitation
 * was created, and the invitee accepts it from their own session. Inventing an
 * email delivery here would repeat `/api/test-email`, the repository's
 * standing counter-example.
 */
export async function POST(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const result = await inviteMember({
    actor,
    businessAccountId,
    email: String(body?.email ?? ""),
    role: String(body?.role ?? ""),
  });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json({ member: result.value.member }, { status: 201 });
}
