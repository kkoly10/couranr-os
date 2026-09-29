import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isRouteRunId } from "@/lib/couranr/routeRuns/draft";
import { recordBusinessDeclaredValue } from "@/lib/couranr/routeRuns/commands";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 1024) return routeFailure("invalid_input", "That declared-value request is too large.");
    body = JSON.parse(raw);
  } catch {
    return routeFailure("invalid_input", "Send declared-value details as JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return routeFailure("invalid_input", "Declared-value details are required.");
  }
  const r = body as Record<string, unknown>;
  const allowed = new Set(["businessAccountId", "requestId", "expectedVersion", "declaredValueCents"]);
  if (Object.keys(r).some((key) => !allowed.has(key))) {
    return routeFailure("invalid_input", "That declared-value request contains unsupported fields.");
  }
  if (
    !isRouteRunId(r.businessAccountId) ||
    !isRouteRunId(r.requestId) ||
    typeof r.expectedVersion !== "number" ||
    !Number.isSafeInteger(r.expectedVersion) ||
    r.expectedVersion < 1 ||
    typeof r.declaredValueCents !== "number" ||
    !Number.isSafeInteger(r.declaredValueCents) ||
    r.declaredValueCents < 0 ||
    r.declaredValueCents > 50_000
  ) {
    return routeFailure("invalid_input", "Enter a valid delivery and declared value from $0 through $500.");
  }
  const actor = await resolveRequestActor(req, r.businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const result = await recordBusinessDeclaredValue({
    businessAccountId: r.businessAccountId,
    actorUserId: actor.userId,
    requestId: r.requestId,
    expectedVersion: r.expectedVersion,
    declaredValueCents: r.declaredValueCents,
  });
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
