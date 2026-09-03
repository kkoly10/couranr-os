import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  createIntakeSession,
  isIntakeFailure,
  runInterpretation,
} from "@/lib/couranr/intake/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — start a Smart Intake session from the merchant's raw description.
 *
 * The description is HOSTILE UNTRUSTED DATA: it is persisted verbatim as
 * evidence (bounded server-side), interpreted as data-only provider input,
 * and grants no authority over anything. When no AI provider is configured
 * the session still exists and the flow continues manually.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }
  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind === "anonymous") {
    return routeFailure("not_permitted", "Sign in to continue.");
  }

  const description = typeof body?.description === "string" ? body.description : "";
  if (description.trim().length === 0 || description.length > 4000) {
    return routeFailure("invalid_input", "Describe the shipment in up to 4000 characters.");
  }
  const requestId = typeof body?.requestId === "string" && UUID_RE.test(body.requestId)
    ? body.requestId
    : null;

  const created = await createIntakeSession({
    businessAccountId,
    requestId,
    actorUserId: actor.actor.userId,
    description,
  });
  if (isIntakeFailure(created)) return failureResponse(created);

  // First interpretation, inline. Provider trouble degrades to manual and is
  // reported honestly; it never blocks the session from existing.
  // The business category the provider sees is resolved SERVER-SIDE from the
  // authenticated business account (correction pass §6); the browser cannot
  // supply provider context.
  const interpreted = await runInterpretation({
    sessionId: created.value.id,
    businessAccountId,
    sourceRevision: 1,
  });

  return NextResponse.json(
    {
      session: created.value,
      run: isIntakeFailure(interpreted) ? null : interpreted.value.run,
    },
    { status: 201 }
  );
}
