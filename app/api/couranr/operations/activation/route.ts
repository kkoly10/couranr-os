import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  decideActivation,
  getActivation,
  isActivationFailure,
} from "@/lib/couranr/activation/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-003's review gate — COURANR OPERATIONS ONLY.
 *
 * `resolveRequestActor(req, null)` is the established Operations-only shape:
 * it refuses anyone whose profile role is not `admin`. The SQL checks the same
 * thing independently, so a merchant has no path to `live` through either.
 *
 * This is what makes activation genuinely Operations-granted rather than a
 * checklist that unlocks itself.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveRequestActor(req, null);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

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

  const action = String(body?.action ?? "");
  if (action !== "grant" && action !== "block") {
    return routeFailure("invalid_input", "That is not an action Couranr recognises.");
  }

  const result = await decideActivation({
    operationsUserId: resolved.userId,
    businessAccountId,
    grant: action === "grant",
    blockedReasonCode: String(body?.reasonCode ?? ""),
  });
  if (isActivationFailure(result)) return failureResponse(result);

  const fresh = await getActivation({ businessAccountId });
  if (isActivationFailure(fresh)) return failureResponse(fresh);
  return NextResponse.json(fresh.value);
}
