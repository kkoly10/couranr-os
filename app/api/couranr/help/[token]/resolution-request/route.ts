import { NextRequest, NextResponse } from "next/server";
import {
  isHelpFailure,
  isWellFormedHelpToken,
  redeemHelpToken,
} from "@/lib/couranr/conversations/help";
import {
  isHelpResolutionReason,
} from "@/lib/couranr/conversations/helpResolutionTypes";
import {
  submitHelpResolutionRequest,
} from "@/lib/couranr/conversations/helpResolution";
import {
  failureResponse,
  routeFailure,
} from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

function refuse() {
  return routeFailure("not_found", "This help link is not available.");
}

/**
 * CUS-002 — submit a reviewed cancellation/return request.
 *
 * UNAUTHENTICATED BY DESIGN: the one-delivery Delivery Help token is the
 * credential. The browser does NOT supply lifecycle stage, target action,
 * cancellation amount, return amount, payer, destination or target state.
 * Those are either re-derived server-side or remain Operations-only.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const raw = (await ctx.params)?.token;
  if (!isWellFormedHelpToken(raw)) return refuse();

  const link = await redeemHelpToken(raw);
  if (isHelpFailure(link)) return refuse();

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  if (!isHelpResolutionReason(payload?.reason)) {
    return routeFailure(
      "invalid_input",
      "Choose why you need Couranr to review this delivery."
    );
  }
  if (
    typeof payload?.idempotencyKey !== "string" ||
    !payload.idempotencyKey.trim()
  ) {
    return routeFailure("invalid_input", "An idempotency key is required.");
  }
  if (
    payload?.note !== undefined &&
    payload?.note !== null &&
    typeof payload.note !== "string"
  ) {
    return routeFailure("invalid_input", "Additional details must be text.");
  }

  const result = await submitHelpResolutionRequest({
    tokenId: link.value.tokenId,
    deliveryId: link.value.deliveryId,
    reason: payload.reason,
    note: payload?.note ?? "",
    idempotencyKey: payload.idempotencyKey,
  });

  if (isHelpFailure(result)) {
    if (result.code === "invalid_input" || result.code === "conflict") {
      return routeFailure(result.code, result.message);
    }
    if (result.code === "not_found" || result.code === "not_permitted") {
      return refuse();
    }
    return failureResponse(result);
  }

  return NextResponse.json(
    {
      messageId: result.value.messageId,
      requestKind: result.value.requestKind,
      changedDelivery: false,
    },
    { status: 201 }
  );
}
