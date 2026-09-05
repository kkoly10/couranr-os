import { NextResponse } from "next/server";
import {
  createHostedSession,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Public bootstrap by design. The merchant slug must resolve through the
 * published + live-workspace SQL gate before a session is minted. The raw
 * 256-bit session token returned here IS the authorization for this one hosted
 * funnel; only its SHA-256 hash is stored, and every later route redeems it.
 */
export async function POST(
  _req: Request,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const result = await createHostedSession(merchantSlug);
  if (isHostedFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}
