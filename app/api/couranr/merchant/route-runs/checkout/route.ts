import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import { memberMay } from "@/lib/couranr/settings/permissions";
import { isRouteRunId } from "@/lib/couranr/routeRuns/draft";
import { beginRouteCheckout } from "@/lib/couranr/routeRuns/settlement";
import { advanceRouteRun, confirmRoutePickupReady, readRouteProgress } from "@/lib/couranr/routeRuns/progress";

export const dynamic = "force-dynamic";
// RR-003 cannot take production money until RR-004 can physically execute a
// funded Route. This is deliberately not an activation flag.
const checkoutAvailable = () => process.env.VERCEL_ENV !== "production";
const response = (value: unknown) => NextResponse.json(value,
  { headers: { "Cache-Control": "private, no-store" } });
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  const routeRunId = req.nextUrl.searchParams.get("routeRunId");
  if (!isRouteRunId(businessAccountId) || !isRouteRunId(routeRunId)) {
    return routeFailure("invalid_input", "Choose a valid Route Run and business.");
  }
  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const result = await readRouteProgress({ businessAccountId, actorUserId: actor.userId, routeRunId });
  return result.ok === false ? failureResponse(result) : response({
    progress: result.value, checkoutAvailable: checkoutAvailable(),
  });
}

/** One explicit merchant command or one recoverable server-owned progression step. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 512) return routeFailure("invalid_input", "Route checkout details are too large.");
    body = JSON.parse(raw);
  } catch {
    return routeFailure("invalid_input", "Send Route checkout details as JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return routeFailure("invalid_input", "Route checkout details are required.");
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set(["businessAccountId", "routeRunId", "action", "expectedVersion", "idempotencyKey"]);
  if (Object.keys(input).some((key) => !allowed.has(key)) ||
      !isRouteRunId(input.businessAccountId) || !isRouteRunId(input.routeRunId) ||
      !["begin", "advance", "confirm_pickup_ready"].includes(String(input.action)) ||
      (input.action === "begin" && (!positive(input.expectedVersion) || !isRouteRunId(input.idempotencyKey))) ||
      (input.action === "confirm_pickup_ready" && !positive(input.expectedVersion)) ||
      (input.action === "advance" && (input.expectedVersion !== undefined || input.idempotencyKey !== undefined)) ||
      (input.action === "confirm_pickup_ready" && input.idempotencyKey !== undefined)) {
    return routeFailure("invalid_input", "Choose a valid Route checkout action.");
  }
  const businessAccountId = input.businessAccountId as string;
  const routeRunId = input.routeRunId as string;
  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const member = settingsActorFrom(actor);
  if (!member || !memberMay(member, "billing.authorize_route")) {
    return routeFailure("not_permitted", "Only a business owner or manager may authorize this Route.");
  }
  if (!checkoutAvailable()) {
    return routeFailure("conflict", "Route checkout is not available yet. No payment has started.");
  }
  const params = { businessAccountId, actorUserId: actor.userId, routeRunId };
  if (input.action === "begin") {
    const begun = await beginRouteCheckout({ ...params,
      expectedVersion: input.expectedVersion as number,
      idempotencyKey: input.idempotencyKey as string,
    });
    if (begun.ok === false) return failureResponse(begun);
    const progress = await readRouteProgress(params);
    return progress.ok === false ? failureResponse(progress) : response({ progress: progress.value });
  }
  const result = input.action === "confirm_pickup_ready"
    ? await confirmRoutePickupReady({ ...params, expectedVersion: input.expectedVersion as number })
    : await advanceRouteRun(params);
  return result.ok === false ? failureResponse(result) : response({ progress: result.value });
}
