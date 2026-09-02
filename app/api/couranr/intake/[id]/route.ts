import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  addIntakeRevision,
  confirmIntakeFact,
  evaluateAndRecordIntakePolicy,
  isIntakeFailure,
  loadIntakeSession,
  runInterpretation,
} from "@/lib/couranr/intake/commands";
import { isFactKey } from "@/lib/couranr/shipment/facts";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — the session with its facts, provenance and current clarification. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Intake session not found.");
  const businessAccountId = String(req.nextUrl.searchParams.get("businessAccountId") ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }
  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const loaded = await loadIntakeSession({ sessionId: params.id, businessAccountId });
  if (isIntakeFailure(loaded)) return failureResponse(loaded);
  return NextResponse.json({ intake: loaded.value });
}

/**
 * POST — one of three merchant acts on the session, dispatched by `action`:
 *
 *   describe  a new raw-description revision (CAS on the current revision),
 *             reinterpreted immediately;
 *   confirm   a trusted-actor confirmation/override of one fact, followed by
 *             a deterministic policy re-evaluation;
 *   interpret rerun interpretation of the current revision (idempotent).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Intake session not found.");

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
  const actorUserId = actor.actor.userId;
  const action = String(body?.action ?? "");

  if (action === "describe") {
    const description = typeof body?.description === "string" ? body.description : "";
    if (description.trim().length === 0 || description.length > 4000) {
      return routeFailure("invalid_input", "Describe the shipment in up to 4000 characters.");
    }
    const expectedRevision = Number(body?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return routeFailure("invalid_input", "The current revision is required.");
    }
    const revised = await addIntakeRevision({
      sessionId: params.id,
      businessAccountId,
      actorUserId,
      description,
      expectedRevision,
      source: body?.isClarificationResponse === true ? "clarification_response" : "merchant_statement",
    });
    if (isIntakeFailure(revised)) return failureResponse(revised);
    const interpreted = await runInterpretation({
      sessionId: params.id,
      businessAccountId,
      sourceRevision: revised.value.current_revision,
      businessCategory: typeof body?.businessCategory === "string" ? body.businessCategory : null,
    });
    return NextResponse.json({
      session: revised.value,
      run: isIntakeFailure(interpreted) ? null : interpreted.value.run,
    });
  }

  if (action === "confirm") {
    const factKey = body?.factKey;
    if (!isFactKey(factKey)) {
      return routeFailure("invalid_input", "Unknown fact.");
    }
    const authority = body?.authority === "overridden" ? "overridden" : "confirmed";
    const confirmed = await confirmIntakeFact({
      sessionId: params.id,
      businessAccountId,
      actorUserId,
      factKey,
      value: body?.value,
      authority,
    });
    if (isIntakeFailure(confirmed)) return failureResponse(confirmed);
    const session = await evaluateAndRecordIntakePolicy({
      sessionId: params.id,
      businessAccountId,
    });
    return NextResponse.json({
      fact: confirmed.value,
      session: isIntakeFailure(session) ? null : session.value,
    });
  }

  if (action === "interpret") {
    const sourceRevision = Number(body?.sourceRevision);
    if (!Number.isInteger(sourceRevision) || sourceRevision < 1) {
      return routeFailure("invalid_input", "The current revision is required.");
    }
    const interpreted = await runInterpretation({
      sessionId: params.id,
      businessAccountId,
      sourceRevision,
      businessCategory: typeof body?.businessCategory === "string" ? body.businessCategory : null,
    });
    if (isIntakeFailure(interpreted)) return failureResponse(interpreted);
    return NextResponse.json({ run: interpreted.value.run });
  }

  return routeFailure("invalid_input", "Unknown action.");
}
