import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { commandDriverRouteTask, readDriverRouteTask } from "@/lib/couranr/routeRuns/execution";
import type { DriverRouteAction } from "@/lib/couranr/routeRuns/executionTypes";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<DriverRouteAction>([
  "start_pickup", "arrive_pickup", "depart_pickup", "advance_stop", "complete_route",
]);
const response = (value: unknown) => NextResponse.json(value,
  { headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);
  const routeRunId = req.nextUrl.searchParams.get("routeRunId");
  if (routeRunId && !UUID.test(routeRunId)) return response({ task: null });
  const result = await readDriverRouteTask(auth.userId, routeRunId ?? undefined);
  return result.ok === false ? failureResponse(result) : response({ task: result.value });
}

export async function POST(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);
  let input: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 350) return routeFailure("invalid_input", "Route action is too large.");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    input = parsed as Record<string, unknown>;
  } catch {
    return routeFailure("invalid_input", "Send a valid Route action.");
  }
  const action = input.action as DriverRouteAction;
  if (typeof input.routeRunId !== "string" || !UUID.test(input.routeRunId) ||
    !ACTIONS.has(action) || Object.keys(input).some((key) =>
      !["routeRunId", "action", "latitude", "longitude", "accuracyM"].includes(key))) {
    return routeFailure("invalid_input", "Choose a valid Route action.");
  }
  let location: { latitude: number; longitude: number; accuracyM: number | null } | undefined;
  if (action === "arrive_pickup") {
    const latitude = input.latitude;
    const longitude = input.longitude;
    const accuracy = input.accuracyM;
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      (accuracy !== null && accuracy !== undefined &&
        (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0))) {
      return routeFailure("invalid_input", "Couranr needs a valid location for pickup arrival.");
    }
    location = { latitude, longitude, accuracyM: typeof accuracy === "number" ? accuracy : null };
  } else if (["latitude", "longitude", "accuracyM"].some((key) => key in input)) {
    return routeFailure("invalid_input", "Location is only recorded at pickup arrival.");
  }
  const result = await commandDriverRouteTask({
    userId: auth.userId, routeRunId: input.routeRunId, action, location,
  });
  return result.ok === false ? failureResponse(result) : response({ task: result.value });
}
