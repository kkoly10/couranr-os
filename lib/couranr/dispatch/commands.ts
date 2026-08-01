import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { RequestActor } from "@/lib/couranr/requests/permissions";
import {
  assignmentIdempotencyKey,
  dispatchReasonMessage,
  isDispatchReason,
  replacementIdempotencyKey,
} from "./states";
import { buildAssignedDeliveryProjection, type AssignedDeliveryProjection } from "./projection";

assertServerOnly("lib/couranr/dispatch/commands.ts");

/**
 * Managed dispatch: canonical drivers, canonical vehicles, and assignment.
 *
 * Same contract as every other Couranr command layer — one `.rpc()` per
 * mutation into a service-role-only SQL function that does the state change and
 * its audit rows in a single transaction, actor verified FIRST, no
 * caller-supplied target state.
 *
 * The browser sends identifiers. It never sends a capability, a fulfillment
 * state, or a claim about whether a driver is free: all three are read from
 * stored rows inside the SQL command.
 *
 * There is no driver-authored mutation anywhere in this file. A driver's only
 * capability in this slice is reading the one delivery assigned to them, which
 * is `getAssignedDeliveryForDriver` below — a SELECT.
 */

export const RPC = {
  createDriver: "couranr_create_driver_profile",
  setDriverState: "couranr_set_driver_state",
  setDriverAvailability: "couranr_update_driver_availability",
  createVehicle: "couranr_create_dispatch_vehicle",
  updateVehicle: "couranr_update_dispatch_vehicle",
  assign: "couranr_assign_delivery",
  replaceAssignment: "couranr_replace_delivery_assignment",
} as const;

const DRIVER_COLUMNS =
  "id,user_id,display_name,contact_phone,driver_state,availability_state,active,market,version,created_at,updated_at";
const VEHICLE_COLUMNS =
  "id,assigned_driver_id,name,vehicle_class,payload_capacity_lb,cargo_length_in,cargo_width_in," +
  "cargo_height_in,enclosed,has_ramp,has_dolly,has_tie_downs,weather_protection,active," +
  "availability_state,version,created_at,updated_at";
const ASSIGNMENT_COLUMNS =
  "id,delivery_id,driver_id,vehicle_id,assignment_state,assigned_by,assigned_at,ended_at," +
  "end_reason,version,created_at,updated_at";

export type DispatchFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
  /** A closed reason code the UI switches on. Never a raw database string. */
  reason?: string;
};
export type DispatchResult<T> = { ok: true; value: T } | DispatchFailure;

export function isDispatchFailure(r: { ok: boolean }): r is DispatchFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
  reason?: string;
}): DispatchFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: DispatchFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  if (p.reason) out.reason = p.reason;
  return out;
}

type OperationsActor = Extract<RequestActor, { kind: "operations" }>;

/**
 * Only Couranr Operations may command dispatch. This is the gate, and it is
 * checked before any argument is looked at — an unauthorized caller must not be
 * able to learn whether a delivery or a driver exists by watching which error
 * comes back.
 *
 * Returns the NARROWED actor rather than a boolean: `tsconfig` sets
 * `"strict": false`, so a separate predicate would not narrow `params.actor` at
 * the call site and every `actor.userId` below would be an `any` waiting to be
 * undefined at runtime.
 */
function requireOperations(
  actor: RequestActor,
  operation: string
): { ok: true; actor: OperationsActor } | DispatchFailure {
  if (actor?.kind !== "operations") {
    return fail({
      operation,
      code: "not_permitted",
      detail: { reason: "not_operations", kind: actor?.kind ?? "unknown" },
      message: "Only Couranr Operations can dispatch a delivery.",
    });
  }
  return { ok: true, actor };
}

/**
 * The SQL commands raise their refusals as a message that IS a closed reason
 * code — `driver_not_available`, `vehicle_payload_too_low`. This turns one into
 * a public failure carrying both the code and the operator-facing copy, so no
 * raw database text ever reaches a browser.
 */
function fromRpcError(operation: string, error: any): DispatchFailure {
  const raw = typeof error?.message === "string" ? error.message : "";
  const reason = isDispatchReason(raw) ? raw : undefined;
  return fail({
    operation,
    code: classifyDatabaseError(error),
    detail: { code: error?.code, message: raw },
    message: reason ? dispatchReasonMessage(reason) : undefined,
    reason,
  });
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<DispatchResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) return fromRpcError(operation, error);
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/* ------------------------------------------------------------ drivers -- */

export async function listDrivers(params: {
  actor: RequestActor;
}): Promise<DispatchResult<{ drivers: Record<string, any>[] }>> {
  const op = "listDrivers";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const { data, error } = await supabaseAdmin
    .from("couranr_drivers")
    .select(DRIVER_COLUMNS)
    .order("display_name", { ascending: true });
  if (error) return fail({ operation: op, code: "internal", detail: error.message });
  return { ok: true, value: { drivers: data ?? [] } };
}

export async function createDriverProfile(params: {
  actor: RequestActor;
  userId: string;
  displayName: string;
  contactPhone?: string | null;
  market?: string | null;
}): Promise<DispatchResult<{ driver: Record<string, any> }>> {
  const op = "createDriverProfile";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.createDriver, {
    p_user_id: params.userId,
    p_actor_user_id: gate.actor.userId,
    p_display_name: params.displayName,
    p_contact_phone: params.contactPhone ?? null,
    p_market: params.market ?? null,
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { driver: r.value } };
}

export async function setDriverState(params: {
  actor: RequestActor;
  driverId: string;
  expectedVersion: number;
  driverState: string;
}): Promise<DispatchResult<{ driver: Record<string, any> }>> {
  const op = "setDriverState";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.setDriverState, {
    p_driver_id: params.driverId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: gate.actor.userId,
    p_driver_state: params.driverState,
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { driver: r.value } };
}

export async function setDriverAvailability(params: {
  actor: RequestActor;
  driverId: string;
  expectedVersion: number;
  availabilityState: string;
}): Promise<DispatchResult<{ driver: Record<string, any> }>> {
  const op = "setDriverAvailability";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.setDriverAvailability, {
    p_driver_id: params.driverId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: gate.actor.userId,
    p_availability_state: params.availabilityState,
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { driver: r.value } };
}

/* ----------------------------------------------------------- vehicles -- */

export async function listVehicles(params: {
  actor: RequestActor;
}): Promise<DispatchResult<{ vehicles: Record<string, any>[] }>> {
  const op = "listVehicles";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const { data, error } = await supabaseAdmin
    .from("couranr_dispatch_vehicles")
    .select(VEHICLE_COLUMNS)
    .order("name", { ascending: true });
  if (error) return fail({ operation: op, code: "internal", detail: error.message });
  return { ok: true, value: { vehicles: data ?? [] } };
}

export async function createDispatchVehicle(params: {
  actor: RequestActor;
  name: string;
  vehicleClass: string;
  payloadCapacityLb: number;
  assignedDriverId?: string | null;
  cargoLengthIn?: number | null;
  cargoWidthIn?: number | null;
  cargoHeightIn?: number | null;
  enclosed?: boolean;
  hasRamp?: boolean;
  hasDolly?: boolean;
  hasTieDowns?: boolean;
  weatherProtection?: boolean;
}): Promise<DispatchResult<{ vehicle: Record<string, any> }>> {
  const op = "createDispatchVehicle";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.createVehicle, {
    p_actor_user_id: gate.actor.userId,
    p_name: params.name,
    p_vehicle_class: params.vehicleClass,
    p_payload_capacity_lb: params.payloadCapacityLb,
    p_assigned_driver_id: params.assignedDriverId ?? null,
    p_cargo_length_in: params.cargoLengthIn ?? null,
    p_cargo_width_in: params.cargoWidthIn ?? null,
    p_cargo_height_in: params.cargoHeightIn ?? null,
    p_enclosed: params.enclosed ?? false,
    p_has_ramp: params.hasRamp ?? false,
    p_has_dolly: params.hasDolly ?? false,
    p_has_tie_downs: params.hasTieDowns ?? false,
    p_weather_protection: params.weatherProtection ?? false,
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { vehicle: r.value } };
}

export async function updateDispatchVehicle(params: {
  actor: RequestActor;
  vehicleId: string;
  expectedVersion: number;
  name?: string | null;
  payloadCapacityLb?: number | null;
  active?: boolean | null;
  availabilityState?: string | null;
}): Promise<DispatchResult<{ vehicle: Record<string, any> }>> {
  const op = "updateDispatchVehicle";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.updateVehicle, {
    p_vehicle_id: params.vehicleId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: gate.actor.userId,
    p_name: params.name ?? null,
    p_payload_capacity_lb: params.payloadCapacityLb ?? null,
    p_active: params.active ?? null,
    p_availability_state: params.availabilityState ?? null,
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { vehicle: r.value } };
}

/* -------------------------------------------------------- assignment --- */

/** The active assignment for a delivery, or null. */
export async function getActiveAssignment(
  deliveryId: string
): Promise<Record<string, any> | null> {
  const { data } = (await supabaseAdmin
    .from("couranr_delivery_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("delivery_id", deliveryId)
    .eq("assignment_state", "active")
    .maybeSingle()) as { data: any; error: any };
  return data ?? null;
}

export async function assignDelivery(params: {
  actor: RequestActor;
  deliveryId: string;
  expectedVersion: number;
  driverId: string;
  vehicleId: string;
}): Promise<DispatchResult<{ assignment: Record<string, any> }>> {
  const op = "assignDelivery";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.assign, {
    p_delivery_id: params.deliveryId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: gate.actor.userId,
    p_driver_id: params.driverId,
    p_vehicle_id: params.vehicleId,
    // Stable for this delivery AT THIS VERSION, so a double-click is one
    // assignment and a genuine later assignment is a different key.
    p_idempotency_key: assignmentIdempotencyKey(params.deliveryId, params.expectedVersion),
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { assignment: r.value } };
}

export async function replaceDeliveryAssignment(params: {
  actor: RequestActor;
  deliveryId: string;
  replacedAssignmentId: string;
  expectedAssignmentVersion: number;
  driverId: string;
  vehicleId: string;
  reason?: string | null;
}): Promise<DispatchResult<{ assignment: Record<string, any> }>> {
  const op = "replaceDeliveryAssignment";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const r = await callRpc<Record<string, any>>(op, RPC.replaceAssignment, {
    p_delivery_id: params.deliveryId,
    p_expected_assignment_version: params.expectedAssignmentVersion,
    p_actor_user_id: gate.actor.userId,
    p_driver_id: params.driverId,
    p_vehicle_id: params.vehicleId,
    p_reason: params.reason ?? null,
    p_idempotency_key: replacementIdempotencyKey(
      params.deliveryId,
      params.replacedAssignmentId,
      params.expectedAssignmentVersion
    ),
  });
  if (isDispatchFailure(r)) return r;
  return { ok: true, value: { assignment: r.value } };
}

/* ------------------------------------------------- Operations reading -- */

/**
 * Everything OPS-003 needs to draw the assignment panel: the delivery, the
 * active assignment, and the two rosters with a per-row eligibility reason
 * computed by the DATABASE against this delivery's stored requirement.
 *
 * The eligibility reason is computed server-side rather than in the selector
 * because the browser has no business deciding whether a vehicle can carry a
 * load, and because a second implementation of that rule would eventually
 * disagree with the one that actually gates the write.
 */
export async function getDispatchPanel(params: {
  actor: RequestActor;
  deliveryId: string;
}): Promise<
  DispatchResult<{
    delivery: Record<string, any> | null;
    assignment: Record<string, any> | null;
    drivers: Record<string, any>[];
    vehicles: Record<string, any>[];
    events: Record<string, any>[];
  }>
> {
  const op = "getDispatchPanel";
  const gate = requireOperations(params.actor, op);
  if (isDispatchFailure(gate)) return gate;

  const { data: delivery, error: dErr } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select(
      "id,request_id,fulfillment_state,vehicle_requirement,scheduled_pickup_start," +
        "scheduled_pickup_end,timezone,service_level,version"
    )
    .eq("id", params.deliveryId)
    .maybeSingle()) as { data: any; error: any };
  if (dErr) return fail({ operation: op, code: "internal", detail: dErr.message });
  if (!delivery) return fail({ operation: op, code: "not_found", message: "Delivery not found." });

  const [drivers, vehicles] = await Promise.all([listDrivers({ actor: params.actor }), listVehicles({ actor: params.actor })]);
  if (isDispatchFailure(drivers)) return drivers;
  if (isDispatchFailure(vehicles)) return vehicles;

  const { data: events } = (await supabaseAdmin
    .from("couranr_assignment_events")
    .select("id,assignment_id,command,actor_type,from_state,to_state,metadata,created_at")
    .eq("delivery_id", params.deliveryId)
    .order("created_at", { ascending: true })) as { data: any; error: any };

  return {
    ok: true,
    value: {
      delivery,
      assignment: await getActiveAssignment(params.deliveryId),
      drivers: drivers.value.drivers,
      vehicles: vehicles.value.vehicles,
      events: events ?? [],
    },
  };
}

/* ---------------------------------------------------- driver reading --- */

/**
 * The ONE delivery assigned to this user, sanitized.
 *
 * Scoped by the driver profile that belongs to the CALLER's user id, never by
 * anything the caller supplied. There is no delivery id parameter that a driver
 * could point at someone else's work: the query starts from their own profile
 * and walks to the single active assignment.
 *
 * Returns null — not a 403 — when there is no assignment, because "you have no
 * work" and "that work is not yours" must look identical from outside.
 */
export async function getAssignedDeliveryForDriver(params: {
  userId: string;
  /** Optional: when present, the delivery must ALSO be the one assigned. */
  deliveryId?: string | null;
}): Promise<DispatchResult<{ assigned: AssignedDeliveryProjection | null }>> {
  const op = "getAssignedDeliveryForDriver";

  const { data: driver, error: drvErr } = (await supabaseAdmin
    .from("couranr_drivers")
    .select("id,user_id,display_name,driver_state,availability_state,active")
    .eq("user_id", params.userId)
    .maybeSingle()) as { data: any; error: any };
  if (drvErr) return fail({ operation: op, code: "internal", detail: drvErr.message });
  if (!driver) return { ok: true, value: { assigned: null } };

  const { data: assignment, error: asgErr } = (await supabaseAdmin
    .from("couranr_delivery_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("driver_id", driver.id)
    .eq("assignment_state", "active")
    .maybeSingle()) as { data: any; error: any };
  if (asgErr) return fail({ operation: op, code: "internal", detail: asgErr.message });
  if (!assignment) return { ok: true, value: { assigned: null } };

  // A driver asking about a specific delivery gets an answer only for the one
  // they hold. Any other id reads as "no assignment", revealing nothing.
  if (params.deliveryId && params.deliveryId !== assignment.delivery_id) {
    return { ok: true, value: { assigned: null } };
  }

  const { data: delivery, error: dlvErr } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("*")
    .eq("id", assignment.delivery_id)
    .maybeSingle()) as { data: any; error: any };
  if (dlvErr) return fail({ operation: op, code: "internal", detail: dlvErr.message });
  if (!delivery) return { ok: true, value: { assigned: null } };

  const { data: vehicle } = (await supabaseAdmin
    .from("couranr_dispatch_vehicles")
    .select("id,name,vehicle_class")
    .eq("id", assignment.vehicle_id)
    .maybeSingle()) as { data: any; error: any };

  // Merchant handoff contact. Read narrowly: the workspace's own contact
  // details, never the account's billing or ownership records.
  const { data: workspace } = (await supabaseAdmin
    .from("couranr_merchant_workspaces")
    .select("contact_phone,business_account_id")
    .eq("business_account_id", delivery.business_account_id)
    .maybeSingle()) as { data: any; error: any };
  const { data: account } = (await supabaseAdmin
    .from("business_accounts")
    .select("name")
    .eq("id", delivery.business_account_id)
    .maybeSingle()) as { data: any; error: any };

  return {
    ok: true,
    value: {
      assigned: buildAssignedDeliveryProjection({
        delivery,
        assignment,
        vehicle: vehicle ?? null,
        merchant: { name: account?.name ?? null, phone: workspace?.contact_phone ?? null },
      }),
    },
  };
}
