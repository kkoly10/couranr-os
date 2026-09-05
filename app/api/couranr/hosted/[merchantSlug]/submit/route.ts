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
    return routeFailure("invalid_input", "Some delivery-request details need attention.");
  }

  const result = await submitHostedRequest({ session: session.value, body: body.value });
  if (isHostedFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}
