import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import { memberMay } from "@/lib/couranr/settings/permissions";
import { isBillingFailure, listBillingRecords } from "@/lib/couranr/billing/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-016 — the merchant's billing records.
 *
 * GET ONLY, and deliberately so. There is nothing on this screen a merchant
 * may change: saved payment methods do not exist, and refunds belong to
 * Couranr Operations under REF-001. A POST here would be a route looking for
 * a capability nobody has decided to grant.
 *
 * `billing.read` is owner, manager and the `billing` role. A dispatcher and a
 * viewer are refused — they work the deliveries, they do not read the money.
 */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor || !memberMay(actor, "billing.read")) {
    return routeFailure(
      "not_permitted",
      "You do not have access to this business's billing records."
    );
  }

  const result = await listBillingRecords({ businessAccountId });
  if (isBillingFailure(result)) return failureResponse(result);
  return NextResponse.json({ billing: result.value });
}
