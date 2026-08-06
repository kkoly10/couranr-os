import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import { memberMay } from "@/lib/couranr/settings/permissions";
import {
  acceptAcknowledgement,
  getActivation,
  isActivationFailure,
  recordTestDelivery,
  requestActivation,
  verifyContact,
} from "@/lib/couranr/activation/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-003 — the merchant's own activation checklist.
 *
 * Reading it is available to any active member (`activation.read`); the acts
 * that BIND the business — accepting terms, confirming the operations contact,
 * asking Couranr to go live — need `activation.request`, which is owner and
 * manager only. The database independently refuses a caller who is not an
 * active member at all, so a route that forgot this check would still not let
 * a stranger sign anything; this check is what keeps a read-only VIEWER from
 * signing on the business's behalf.
 */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor || !memberMay(actor, "activation.read")) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  const result = await getActivation({ businessAccountId });
  if (isActivationFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value);
}

/**
 * POST — one activation step.
 *
 * Every branch names an ACTION. Nothing here accepts a target state: `live`
 * and `blocked` are not reachable from this route at all, by construction —
 * they belong to the Operations route, and the SQL refuses a non-admin actor
 * even if a caller found another way in.
 */
export async function POST(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor || !memberMay(actor, "activation.request")) {
    return routeFailure(
      "not_permitted",
      "Only an owner or a manager can accept Couranr's terms or request activation."
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const action = String(body?.action ?? "");

  if (action === "accept") {
    const r = await acceptAcknowledgement({
      actor,
      businessAccountId,
      kind: String(body?.kind ?? ""),
    });
    if (isActivationFailure(r)) return failureResponse(r);
  } else if (action === "verify_contact") {
    const r = await verifyContact({ actor, businessAccountId });
    if (isActivationFailure(r)) return failureResponse(r);
  } else if (action === "record_test_delivery") {
    const requestId = String(body?.requestId ?? "");
    if (!UUID_RE.test(requestId)) {
      return routeFailure("invalid_input", "A delivery request is required.");
    }
    const r = await recordTestDelivery({ actor, businessAccountId, requestId });
    if (isActivationFailure(r)) return failureResponse(r);
  } else if (action === "request_activation") {
    const r = await requestActivation({ actor, businessAccountId });
    if (isActivationFailure(r)) return failureResponse(r);
  } else {
    return routeFailure("invalid_input", "That is not an action Couranr recognises.");
  }

  // Always answer with the fresh view, so the checklist renders what the
  // database now holds rather than what the browser hoped it would.
  const fresh = await getActivation({ businessAccountId });
  if (isActivationFailure(fresh)) return failureResponse(fresh);
  return NextResponse.json(fresh.value);
}
