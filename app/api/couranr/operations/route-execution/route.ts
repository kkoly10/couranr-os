import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (value: unknown) => NextResponse.json(value,
  { headers: { "Cache-Control": "private, no-store" } });

async function routeView(requestId: string) {
  const { data: child, error: childError } = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,route_run_id,route_version_id")
    .eq("request_id", requestId).maybeSingle();
  if (childError) throw childError;
  if (!child?.route_run_id) return null;
  const routeRunId = child.route_run_id;
  const [versionResult, executionResult, settlementResult, resourceResult,
    stopsResult, deliveriesResult] = await Promise.all([
    supabaseAdmin.from("couranr_route_run_versions")
      .select("title,stop_count").eq("id", child.route_version_id).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_executions")
      .select("execution_state,current_sequence,driver_id")
      .eq("route_run_id", routeRunId).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_settlements")
      .select("settlement_state").eq("route_run_id", routeRunId).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_resource_reservations")
      .select("resource_state,driver_id,vehicle_id")
      .eq("route_run_id", routeRunId).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_stops")
      .select("sequence,request_id").eq("route_version_id", child.route_version_id)
      .order("sequence", { ascending: true }),
    supabaseAdmin.from("couranr_deliveries")
      .select("id,request_id,fulfillment_state,payment_obligation_id,captured_amount_cents")
      .eq("route_run_id", routeRunId),
  ]);
  for (const queryOutcome of [versionResult, executionResult, settlementResult,
    resourceResult, stopsResult, deliveriesResult]) {
    if (queryOutcome.error) throw new Error("route_execution_read_failed");
  }
  if (!versionResult.data || !settlementResult.data ||
      !resourceResult.data || !stopsResult.data || !deliveriesResult.data) {
    throw new Error("route_execution_projection_incomplete");
  }
  const deliveries = deliveriesResult.data;
  const [obligationsResult, returnsResult, driverResult] = await Promise.all([
    supabaseAdmin.from("couranr_payment_obligations")
      .select("id,payment_state,captured_amount_cents")
      .in("id", deliveries.map((delivery) => delivery.payment_obligation_id)),
    supabaseAdmin.from("couranr_delivery_returns")
      .select("delivery_id,return_state")
      .in("delivery_id", deliveries.map((delivery) => delivery.id)),
    supabaseAdmin.from("couranr_drivers").select("display_name")
      .eq("id", resourceResult.data.driver_id).maybeSingle(),
  ]);
  for (const queryOutcome of [obligationsResult, returnsResult, driverResult]) {
    if (queryOutcome.error) throw new Error("route_execution_read_failed");
  }
  const byRequest = new Map(deliveries.map((delivery) => [delivery.request_id, delivery]));
  const byObligation = new Map((obligationsResult.data ?? []).map((obligation) => [obligation.id, obligation]));
  const byReturn = new Map((returnsResult.data ?? []).map((item) => [item.delivery_id, item]));
  if (stopsResult.data.length !== versionResult.data.stop_count ||
      deliveries.length !== versionResult.data.stop_count) {
    throw new Error("route_execution_child_count_mismatch");
  }
  const stops = stopsResult.data.map((stop) => {
    const delivery = byRequest.get(stop.request_id);
    if (!delivery) throw new Error("route_execution_child_missing");
    const obligation = byObligation.get(delivery.payment_obligation_id);
    return {
      sequence: stop.sequence, requestId: stop.request_id,
      fulfillmentState: delivery.fulfillment_state,
      paymentState: obligation?.payment_state ?? "unavailable",
      capturedAmountCents: obligation?.captured_amount_cents ?? null,
      returnState: byReturn.get(delivery.id)?.return_state ?? null,
    };
  });
  return {
    routeRunId, title: versionResult.data.title,
    settlementState: settlementResult.data.settlement_state,
    resourceState: resourceResult.data.resource_state,
    executionState: executionResult.data?.execution_state ?? "awaiting_assignment",
    currentSequence: executionResult.data?.current_sequence ?? 0,
    driverName: executionResult.data
      ? driverResult.data?.display_name ?? "Driver unavailable"
      : "Resource reserved; assignment pending",
    stops,
  };
}

export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind !== "operations") return routeFailure("not_permitted", "Operations access required.");
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId || !UUID.test(requestId)) return routeFailure("invalid_input", "Choose a delivery request.");
  try { return response({ route: await routeView(requestId) }); }
  catch { return routeFailure("internal", "Couranr could not read this Route execution."); }
}

export async function POST(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind !== "operations") return routeFailure("not_permitted", "Operations access required.");
  let input: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 250) throw new Error("oversized");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    input = parsed as Record<string, unknown>;
  } catch { return routeFailure("invalid_input", "Send a valid Route decision."); }
  if (typeof input.routeRunId !== "string" || !UUID.test(input.routeRunId) ||
      !["continue_later_stops", "return_now"].includes(String(input.resolution)) ||
      Object.keys(input).some((key) => !["routeRunId", "resolution"].includes(key))) {
    return routeFailure("invalid_input", "Choose a supported Route exception decision.");
  }
  const { error } = await supabaseAdmin.rpc("couranr_resolve_route_run_exception", {
    p_route_run_id: input.routeRunId,
    p_actor_user_id: actor.userId,
    p_resolution: input.resolution,
  });
  if (error) return routeFailure("conflict", "The Route exception changed. Refresh before deciding again.");
  return response({ outcome: input.resolution });
}
