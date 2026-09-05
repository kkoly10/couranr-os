import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  decideActivation,
  getAcknowledgementRecords,
  getActivation,
  isActivationFailure,
  listActivationsForOperations,
  verifyContactForOperations,
} from "@/lib/couranr/activation/commands";
import { ACTIVATION_STATES } from "@/lib/couranr/activation/states";
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
/**
 * READ — the review queue, or one workspace in full.
 *
 * Without this the decide route below was WRITE-ONLY: an operator could grant
 * or block a workspace but had no way to see the checklist, the
 * acknowledgements or who accepted them, and no way to find a workspace
 * awaiting review at all. A decision made blind is not a review.
 *
 * Same Operations-only gate as the write.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveRequestActor(req, null);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");

  if (businessAccountId) {
    if (!UUID_RE.test(businessAccountId)) {
      return routeFailure("invalid_input", "A business account is required.");
    }
    const view = await getActivation({ businessAccountId });
    if (isActivationFailure(view)) return failureResponse(view);
    const acks = await getAcknowledgementRecords({ businessAccountId });
    if (isActivationFailure(acks)) return failureResponse(acks);
    return NextResponse.json({
      activation: view.value,
      acknowledgements: acks.value.acknowledgements,
    });
  }

  // An unrecognised state would silently return the whole table, so it is
  // refused rather than ignored.
  const state = req.nextUrl.searchParams.get("state") ?? "pending_couranr_review";
  const isContactQueue = state === "contact_verification";
  if (
    state !== "all" &&
    !isContactQueue &&
    !(ACTIVATION_STATES as readonly string[]).includes(state)
  ) {
    return routeFailure("invalid_input", "That is not an activation state.");
  }

  const list = await listActivationsForOperations(
    isContactQueue
      ? { contactVerificationPending: true }
      : state === "all"
        ? {}
        : { state }
  );
  if (isActivationFailure(list)) return failureResponse(list);
  return NextResponse.json({ entries: list.value.entries });
}

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
  if (action !== "grant" && action !== "block" && action !== "verify_contact") {
    return routeFailure("invalid_input", "That is not an action Couranr recognises.");
  }

  const result =
    action === "verify_contact"
      ? await verifyContactForOperations({
          operationsUserId: resolved.userId,
          businessAccountId,
        })
      : await decideActivation({
          operationsUserId: resolved.userId,
          businessAccountId,
          grant: action === "grant",
          blockedReasonCode: String(body?.reasonCode ?? ""),
        });
  if (isActivationFailure(result)) return failureResponse(result);

  const fresh = await getActivation({ businessAccountId });
  if (isActivationFailure(fresh)) return failureResponse(fresh);
  return NextResponse.json({ activation: fresh.value });
}
