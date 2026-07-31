import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { createMerchantWorkspace, isCommandFailure } from "@/lib/couranr/onboarding/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Rejects an idempotency key that is absent, oversized or not plain text. */
function readIdempotencyKey(req: NextRequest, body: any): string | null {
  const raw = req.headers.get("idempotency-key") || body?.idempotencyKey;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

/**
 * POST — MER-002. Create the caller's merchant workspace.
 *
 * The owner is the AUTHENTICATED caller, resolved from the Bearer token. The
 * body has no owner field, and neither does the SQL function, so a client
 * cannot create a workspace owned by somebody else.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const user = await resolveUserId(req);
  if (isActorDenied(user)) return routeFailure(user.code, user.error);

  const idempotencyKey = readIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return routeFailure("invalid_input", "An Idempotency-Key header is required.");
  }

  const result = await createMerchantWorkspace({
    ownerUserId: user.userId,
    idempotencyKey,
    rawInput: body?.workspace,
  });

  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ workspace: result.value }, { status: 201 });
}
