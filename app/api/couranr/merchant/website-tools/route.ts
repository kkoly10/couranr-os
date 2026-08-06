import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getWebsiteTools,
  isSettingsFailure,
  saveWebsiteTools,
  settingsActorFrom,
} from "@/lib/couranr/settings/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-013 — the merchant's website tools.
 *
 * Read is every active member; publishing is owner and manager only. Both are
 * decided by the one capability matrix and re-checked in SQL.
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

  const result = await getWebsiteTools({ actor, businessAccountId });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json(result.value);
}

/**
 * PUT — save the embed design and the publish status.
 *
 * The body carries no URL and no slug: the hosted link is DERIVED from the
 * business's own slug server-side, so a merchant cannot publish a link
 * pointing anywhere but their own request page.
 *
 * It also carries no STATUS. The caller names an action — publish, disable or
 * save_draft — and the command maps it to the state it owns, which is the
 * repository rule that `/api/delivery/mark-in-transit` violates.
 */
export async function PUT(req: NextRequest) {
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

  const result = await saveWebsiteTools({
    actor,
    businessAccountId,
    // An ACTION, never a target status. The command owns the transition.
    action: String(body?.action ?? ""),
    embed: {
      label: String(body?.embed?.label ?? ""),
      color: String(body?.embed?.color ?? ""),
      width: Number(body?.embed?.width),
      variant: String(body?.embed?.variant ?? ""),
    },
  });
  if (isSettingsFailure(result)) return failureResponse(result);

  // Return the fresh view, so the screen renders what was STORED.
  const fresh = await getWebsiteTools({ actor, businessAccountId });
  if (isSettingsFailure(fresh)) return failureResponse(fresh);

  return NextResponse.json(fresh.value);
}
