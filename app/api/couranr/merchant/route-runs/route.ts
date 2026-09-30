import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isRouteRunId, validateRouteDraft } from "@/lib/couranr/routeRuns/draft";
import {
  abandonRouteRun,
  acceptRouteRun,
  cancelAcceptedRouteRun,
  listRouteRuns,
  readRouteDraft,
  saveRouteDraft,
} from "@/lib/couranr/routeRuns/commands";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export async function GET(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  if (!isRouteRunId(business)) {
    return routeFailure("invalid_input", "A business is required.");
  }
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const route = req.nextUrl.searchParams.get("routeRunId");
  if (!route) {
    const result = await listRouteRuns({
      businessAccountId: business,
      actorUserId: actor.userId,
    });
    if (result.ok === false) return failureResponse(result);
    return NextResponse.json(
      { routeRuns: result.value },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!isRouteRunId(route)) {
    return routeFailure("invalid_input", "Choose a valid route.");
  }
  const result = await readRouteDraft({
    businessAccountId: business,
    actorUserId: actor.userId,
    routeRunId: route,
  });
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(
    { routeRun: result.value },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Saves/revises a DRAFT only. No booking or child claim occurs here. */
export async function POST(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  if (!isRouteRunId(business)) {
    return routeFailure("invalid_input", "A business is required.");
  }
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  let raw: unknown;
  try {
    const body = await req.text();
    if (body.length > 4096) return routeFailure("invalid_input", "The route draft is too large.");
    raw = JSON.parse(body);
  } catch {
    return routeFailure("invalid_input", "Send route draft details as JSON.");
  }
  const parsed = validateRouteDraft(raw);
  if (parsed.ok === false) {
    return routeFailure(
      "invalid_input",
      "Use a title and two to five different delivery draft IDs. Do not include prices or delivery states.",
    );
  }
  const result = await saveRouteDraft({
    businessAccountId: business,
    actorUserId: actor.userId,
    input: parsed.value,
  });
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(
    { routeRun: result.value },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Accept or archive one exact Route draft version. Accept freezes/claims child
 * requests but booking/payment/dispatch/custody remain unavailable.
 */
export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 2048) return routeFailure("invalid_input", "That route action is too large.");
    body = JSON.parse(raw);
  } catch {
    return routeFailure("invalid_input", "Send route action details as JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return routeFailure("invalid_input", "Route action details are required.");
  }
  const r = body as Record<string, unknown>;
  const allowed = new Set(["businessAccountId", "routeRunId", "expectedVersion", "idempotencyKey", "action"]);
  if (Object.keys(r).some((key) => !allowed.has(key))) {
    return routeFailure("invalid_input", "That route action contains unsupported fields.");
  }
  if (
    !isRouteRunId(r.businessAccountId) ||
    !isRouteRunId(r.routeRunId) ||
    !isRouteRunId(r.idempotencyKey) ||
    !positiveInteger(r.expectedVersion) ||
    (r.action !== "accept" && r.action !== "abandon" && r.action !== "cancel")
  ) {
    return routeFailure("invalid_input", "Choose a valid route action.");
  }
  const actor = await resolveRequestActor(req, r.businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const params = {
    businessAccountId: r.businessAccountId,
    actorUserId: actor.userId,
    routeRunId: r.routeRunId,
    expectedVersion: r.expectedVersion,
    idempotencyKey: r.idempotencyKey,
  };
  const result = r.action === "accept" ? await acceptRouteRun(params) :
    r.action === "abandon" ? await abandonRouteRun(params) : await cancelAcceptedRouteRun(params);
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(
    { routeRun: result.value },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
