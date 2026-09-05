import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import {
  createHostedRequest,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Public merchant-hosted intake.
 *
 * This does NOT quote and cannot create a payment obligation. It records the
 * customer's statement in awaiting_merchant_confirmation. The merchant's
 * later named validation command is the only path that can mint the first
 * quote for this request.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  if (!merchantSlug || merchantSlug.length > 100) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const result = await createHostedRequest({
    session: session.value,
    merchantSlug,
    rawInput: body,
  });
  if (isHostedFailure(result)) return failureResponse(result);

  return NextResponse.json({ request: result.value }, { status: 201 });
}
