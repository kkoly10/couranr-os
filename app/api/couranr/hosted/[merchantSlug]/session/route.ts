import { NextResponse } from "next/server";
import {
  createHostedSession,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

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
