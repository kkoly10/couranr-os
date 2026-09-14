import { NextRequest, NextResponse } from "next/server";
import {
  isHostedBodyFailure,
  isHostedFailure,
  redeemHostedSessionToken,
  submitHostedRequest,
  validateHostedSubmitBody,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Reason → sentence. Timing gets its own words; everything else stays generic. */
function hostedSubmitMessage(reason: string): string {
  if (reason === "requested_time_invalid") {
    return "Enter the requested pickup date and time (Eastern) to schedule this delivery.";
  }
  if (reason === "timing_intent_invalid") return "Choose a pickup timing Couranr offers.";
  return "Some delivery-request details need attention.";
}

/**
 * Customer submit is intentionally UNQUOTED. No Place Details, Mapbox,
 * Pricing V2 or Stripe call is made here. The host merchant must validate
 * first.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const session = await redeemHostedSessionToken(req, merchantSlug);
  if (isHostedFailure(session)) return routeFailure("not_found");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const body = validateHostedSubmitBody(raw);
  if (isHostedBodyFailure(body)) {
    return routeFailure("invalid_input", hostedSubmitMessage(body.reason));
  }

  const result = await submitHostedRequest({ session: session.value, body: body.value });
  if (isHostedFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}
