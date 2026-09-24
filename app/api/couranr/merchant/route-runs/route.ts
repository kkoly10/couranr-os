import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isRouteRunId, validateRouteDraft } from "@/lib/couranr/routeRuns/draft";
import { readRouteDraft, saveRouteDraft } from "@/lib/couranr/routeRuns/commands";

export const dynamic = "force-dynamic";

/** The public HTTP boundary receives safe command results, never DB errors. */
export async function GET(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  const route = req.nextUrl.searchParams.get("routeRunId");
  if (!isRouteRunId(business) || !isRouteRunId(route)) return routeFailure("invalid_input", "A business and route draft are required.");
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const result = await readRouteDraft({ businessAccountId: business, actorUserId: actor.userId, routeRunId: route });
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(result.value, { headers: { "Cache-Control": "private, no-store" } });
}

/** Saves a draft only. SQL independently locks and checks active membership. */
export async function POST(req: NextRequest) {
  const business = req.nextUrl.searchParams.get("businessAccountId");
  if (!isRouteRunId(business)) return routeFailure("invalid_input", "A business is required.");
  const actor = await resolveRequestActor(req, business);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  let raw: unknown;
  try {
    const body = await req.text();
    if (body.length > 4096) return routeFailure("invalid_input", "The route draft is too large.");
    raw = JSON.parse(body);
  } catch { return routeFailure("invalid_input", "Send route draft details as JSON."); }
  const parsed = validateRouteDraft(raw);
  if (parsed.ok === false) return routeFailure("invalid_input", "Use a title and two to five different delivery draft IDs. Do not include prices or delivery states.");
  const result = await saveRouteDraft({ businessAccountId: business, actorUserId: actor.userId, input: parsed.value });
  if (result.ok === false) return failureResponse(result);
  return NextResponse.json(result.value, { headers: { "Cache-Control": "private, no-store" } });
}
