import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  changeMemberRole,
  isSettingsFailure,
  setMemberStatus,
  settingsActorFrom,
} from "@/lib/couranr/settings/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-015 — act on one member.
 *
 * The body names an ACTION, not a target column. `change_role` carries the
 * role it wants and the role it believes the member currently holds, so the
 * server can decide which capability is required (changing to or from owner is
 * a different, narrower permission) — and the SQL re-reads the real current
 * role under a lock before doing anything, so a stale `fromRole` cannot widen
 * what the caller is allowed to do.
 *
 * `disable` is also how access is REMOVED. There is no delete: the membership
 * record is the audit of who once had access, and destroying it to mean
 * "removed" would destroy that.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ memberId: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.memberId)) {
    return routeFailure("not_found", "That team member was not found.");
  }

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

  const action = String(body?.action ?? "");

  if (action === "change_role") {
    const result = await changeMemberRole({
      actor,
      businessAccountId,
      memberId: params.memberId,
      fromRole: String(body?.fromRole ?? ""),
      toRole: String(body?.toRole ?? ""),
    });
    if (isSettingsFailure(result)) return failureResponse(result);
    return NextResponse.json({ member: result.value.member });
  }

  if (action === "disable" || action === "reactivate") {
    const result = await setMemberStatus({
      actor,
      businessAccountId,
      memberId: params.memberId,
      to: action === "disable" ? "disabled" : "active",
    });
    if (isSettingsFailure(result)) return failureResponse(result);
    return NextResponse.json({ member: result.value.member });
  }

  return routeFailure("invalid_input", "That is not an action Couranr recognises.");
}
