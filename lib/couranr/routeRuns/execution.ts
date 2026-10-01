import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { classifyDatabaseError, logServerFailure, newCorrelationId,
  type PublicErrorCode } from "@/lib/couranr/errors";
import type { DriverRouteAction, DriverRouteTask } from "./executionTypes";

assertServerOnly("lib/couranr/routeRuns/execution.ts");

type Failure = { ok: false; code: PublicErrorCode; correlationId: string };
type Result<T> = { ok: true; value: T } | Failure;

function fail(operation: string, detail: unknown, code: PublicErrorCode = "internal"): Failure {
  const correlationId = newCorrelationId();
  logServerFailure({ operation, correlationId, code, detail });
  return { ok: false, code, correlationId };
}

/** Driver identity is resolved server-side; no Route or child id widens it. */
export async function readDriverRouteTask(userId: string,
  routeRunId?: string): Promise<Result<DriverRouteTask | null>> {
  const op = "readDriverRouteTask";
  const { data: driver, error: driverError } = await supabaseAdmin
    .from("couranr_drivers").select("id").eq("user_id", userId).maybeSingle();
  if (driverError) return fail(op, driverError.message);
  if (!driver) return { ok: true, value: null };
  let query = supabaseAdmin.from("couranr_route_run_executions")
    .select("id,route_run_id,route_version_id,current_sequence,execution_state")
    .eq("driver_id", driver.id);
  if (routeRunId) query = query.eq("route_run_id", routeRunId);
  else query = query.in("execution_state", ["ready", "en_route_to_pickup",
    "at_pickup", "in_progress", "exception", "returning"]);
  const { data: executions, error: executionError } = await query.limit(2);
  if (executionError) return fail(op, executionError.message);
  if (!executions?.length) return { ok: true, value: null };
  if (executions.length !== 1) return fail(op, "multiple_active_route_executions");
  const execution = executions[0];
  const { data: version, error: versionError } = await supabaseAdmin
    .from("couranr_route_run_versions").select("title,stop_count")
    .eq("id", execution.route_version_id).maybeSingle();
  if (versionError || !version) return fail(op, versionError?.message ?? "route_version_missing");
  const { data: stops, error: stopsError } = await supabaseAdmin
    .from("couranr_route_run_stops").select("sequence,request_id")
    .eq("route_version_id", execution.route_version_id)
    .order("sequence", { ascending: true });
  if (stopsError || !stops || stops.length !== version.stop_count) {
    return fail(op, stopsError?.message ?? "route_stops_incomplete");
  }
  const requestIds = stops.map((stop) => stop.request_id);
  const { data: deliveries, error: deliveriesError } = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,request_id,fulfillment_state,shipment")
    .in("request_id", requestIds);
  if (deliveriesError || !deliveries || deliveries.length !== stops.length) {
    return fail(op, deliveriesError?.message ?? "route_deliveries_incomplete");
  }
  const { data: assignments, error: assignmentsError } = await supabaseAdmin
    .from("couranr_delivery_assignments")
    .select("delivery_id")
    .eq("route_execution_id", execution.id)
    .eq("driver_id", driver.id);
  if (assignmentsError || !assignments || assignments.length !== stops.length) {
    return fail(op, assignmentsError?.message ?? "route_assignments_incomplete");
  }
  const allowed = new Set(assignments.map((assignment) => assignment.delivery_id));
  const byRequest = new Map(deliveries.map((delivery) => [delivery.request_id, delivery]));
  const projected: DriverRouteTask["stops"] = [];
  for (const stop of stops) {
    const delivery = byRequest.get(stop.request_id);
    if (!delivery || !allowed.has(delivery.id)) return fail(op, "route_child_assignment_mismatch");
    const manifest = delivery.shipment?.pickupManifest;
    projected.push({ sequence: stop.sequence, deliveryId: delivery.id,
      fulfillmentState: delivery.fulfillment_state,
      packageDescription: typeof manifest?.description === "string" ? manifest.description : null,
      packageCount: typeof manifest?.packageCount === "number" ? manifest.packageCount : null });
  }
  return { ok: true, value: {
    routeRunId: execution.route_run_id, executionId: execution.id,
    title: version.title, state: execution.execution_state,
    currentSequence: execution.current_sequence, stopCount: version.stop_count,
    stops: projected,
  } };
}

const DRIVER_ACTION_RPC = {
  start_pickup: "couranr_start_route_run_to_pickup",
  arrive_pickup: "couranr_arrive_route_run_at_pickup",
  depart_pickup: "couranr_depart_route_run_pickup",
  advance_stop: "couranr_advance_route_run_stop",
  complete_route: "couranr_complete_route_run_execution",
} as const;
export async function commandDriverRouteTask(input: {
  userId: string; routeRunId: string; action: DriverRouteAction;
  location?: { latitude: number; longitude: number; accuracyM: number | null };
}): Promise<Result<DriverRouteTask>> {
  const op = "commandDriverRouteTask";
  const args: Record<string, unknown> = {
    p_route_run_id: input.routeRunId, p_actor_user_id: input.userId,
  };
  if (input.action === "arrive_pickup" && input.location) {
    args.p_latitude = input.location.latitude;
    args.p_longitude = input.location.longitude;
    args.p_accuracy_m = input.location.accuracyM;
  }
  const { error } = await supabaseAdmin.rpc(DRIVER_ACTION_RPC[input.action], args);
  if (error) return fail(op, { action: input.action, error: error.message },
    classifyDatabaseError(error));
  const current = await readDriverRouteTask(input.userId, input.routeRunId);
  if (current.ok === false) return current;
  if (!current.value) return fail(op, "route_task_missing_after_command");
  return { ok: true, value: current.value };
}
