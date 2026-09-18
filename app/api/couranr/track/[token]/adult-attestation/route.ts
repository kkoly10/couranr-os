import { NextRequest, NextResponse } from "next/server";
import {
  attestRecipientAdult,
  isTrackingFailure,
} from "@/lib/couranr/tracking/commands";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const BODY_KEYS = new Set(["accepted"]);

/**
 * The recipient tracking credential's one bounded mutation.
 *
 * UNAUTHENTICATED BY DESIGN: the recipient tracking token is the
 * authorization. It is shape-checked here, hashed by the server command and
 * re-resolved in SQL as a live, unexpired, recipient-audience credential.
 *
 * The browser supplies only literal consent. The server supplies the statement
 * version, hashes the token, re-resolves its recipient audience and lets the
 * database prove the request is a live governed protected handoff.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params;
  if (!isWellFormedTrackingToken(token)) {
    return NextResponse.json({ recorded: false }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ recorded: false }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body as Record<string, unknown>).some((key) => !BODY_KEYS.has(key)) ||
    (body as Record<string, unknown>).accepted !== true
  ) {
    return NextResponse.json({ recorded: false }, { status: 400 });
  }

  const result = await attestRecipientAdult({ rawToken: token });
  if (isTrackingFailure(result)) return failureResponse(result as any);
  return NextResponse.json({ recorded: true });
}
