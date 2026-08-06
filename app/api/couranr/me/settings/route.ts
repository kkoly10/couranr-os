import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getWorkspaceSettings,
  isSettingsFailure,
  settingsActorFrom,
  updateWorkspaceProfile,
} from "@/lib/couranr/settings/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-014 — the merchant's own settings.
 *
 * The tenant is caller-supplied and then re-checked: `resolveRequestActor`
 * loads the caller's membership row for THAT business, and the command layer
 * applies the capability matrix to it. A business id the caller has no
 * membership in produces no membership and is refused.
 */
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

  const result = await getWorkspaceSettings({ actor, businessAccountId });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json(result.value);
}

/**
 * PATCH — update the editable parts of the profile.
 *
 * Every field is optional and only what is sent is changed; the SQL coalesces
 * a null onto the stored value. There is no amount, no price and no policy
 * version in the accepted shape: `policies_version` is server-stated, so a
 * merchant cannot claim to have accepted a version they were never shown.
 */
export async function PATCH(req: NextRequest) {
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

  const result = await updateWorkspaceProfile({
    actor,
    businessAccountId,
    name: typeof body?.name === "string" ? body.name : undefined,
    businessCategory:
      typeof body?.businessCategory === "string" ? body.businessCategory : undefined,
    pickupAddress: body?.pickupAddress ?? undefined,
    contactPhone: typeof body?.contactPhone === "string" ? body.contactPhone : undefined,
    payerDefault: typeof body?.payerDefault === "string" ? body.payerDefault : undefined,
  });
  if (isSettingsFailure(result)) return failureResponse(result);

  // Return the fresh view so the client renders what was STORED, never what it
  // hoped it sent.
  const fresh = await getWorkspaceSettings({ actor, businessAccountId });
  if (isSettingsFailure(fresh)) return failureResponse(fresh);

  return NextResponse.json(fresh.value);
}
