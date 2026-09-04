import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { CommandFailure } from "@/lib/couranr/requests/commands";

assertServerOnly("lib/couranr/driver/profile.ts");

export type DriverProfileView = {
  driver: {
    id: string;
    displayName: string;
    driverState: string;
    availabilityState: string;
    availabilityPreference: string;
    active: boolean;
    market: string | null;
    version: number;
  };
  vehicles: DriverVehicleView[];
};

export type DriverVehicleView = {
  id: string;
  name: string;
  vehicleClass: string;
  payloadCapacityLb: number;
  cargoLengthIn: number | null;
  cargoWidthIn: number | null;
  cargoHeightIn: number | null;
  enclosed: boolean;
  hasRamp: boolean;
  hasDolly: boolean;
  hasTieDowns: boolean;
  weatherProtection: boolean;
  active: boolean;
  availabilityState: string;
  version: number;
};

type Result<T> = { ok: true; value: T } | CommandFailure;

export function isDriverProfileFailure<T>(r: Result<T>): r is CommandFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): CommandFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: CommandFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

const VEHICLE_COLUMNS =
  "id,name,vehicle_class,payload_capacity_lb,cargo_length_in,cargo_width_in,cargo_height_in," +
  "enclosed,has_ramp,has_dolly,has_tie_downs,weather_protection,active,availability_state,version";

function vehicleView(row: any): DriverVehicleView {
  return {
    id: String(row.id),
    name: String(row.name ?? "Vehicle"),
    vehicleClass: String(row.vehicle_class ?? ""),
    payloadCapacityLb: Number(row.payload_capacity_lb ?? 0),
    cargoLengthIn: row.cargo_length_in == null ? null : Number(row.cargo_length_in),
    cargoWidthIn: row.cargo_width_in == null ? null : Number(row.cargo_width_in),
    cargoHeightIn: row.cargo_height_in == null ? null : Number(row.cargo_height_in),
    enclosed: Boolean(row.enclosed),
    hasRamp: Boolean(row.has_ramp),
    hasDolly: Boolean(row.has_dolly),
    hasTieDowns: Boolean(row.has_tie_downs),
    weatherProtection: Boolean(row.weather_protection),
    active: Boolean(row.active),
    availabilityState: String(row.availability_state ?? "unavailable"),
    version: Number(row.version ?? 1),
  };
}

/** Self-scoped Driver account facts. No browser-supplied driver id exists. */
export async function getMyDriverProfile(userId: string): Promise<Result<DriverProfileView>> {
  const operation = "driver.getMyDriverProfile";
  const { data: driver, error: driverError } = (await supabaseAdmin
    .from("couranr_drivers")
    .select(
      "id,display_name,driver_state,availability_state,availability_preference,active,market,version"
    )
    .eq("user_id", userId)
    .maybeSingle()) as { data: any; error: any };

  if (driverError) {
    return fail({
      operation,
      code: classifyDatabaseError(driverError),
      detail: driverError,
    });
  }
  if (!driver) {
    return fail({
      operation,
      code: "not_found",
      message: "Your Couranr driver profile was not found.",
    });
  }

  const { data: vehicles, error: vehicleError } = (await supabaseAdmin
    .from("couranr_dispatch_vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("assigned_driver_id", driver.id)
    .order("created_at", { ascending: true })) as { data: any[] | null; error: any };

  if (vehicleError) {
    return fail({
      operation,
      code: classifyDatabaseError(vehicleError),
      detail: vehicleError,
    });
  }

  return {
    ok: true,
    value: {
      driver: {
        id: String(driver.id),
        displayName: String(driver.display_name ?? "Driver"),
        driverState: String(driver.driver_state ?? "pending"),
        availabilityState: String(driver.availability_state ?? "unavailable"),
        availabilityPreference: String(driver.availability_preference ?? "available"),
        active: Boolean(driver.active),
        market: driver.market == null ? null : String(driver.market),
        version: Number(driver.version ?? 1),
      },
      vehicles: (vehicles ?? []).map(vehicleView),
    },
  };
}

export async function setMyAvailability(params: {
  userId: string;
  expectedVersion: number;
  preference: "available" | "unavailable";
}): Promise<Result<DriverProfileView["driver"]>> {
  const operation = "driver.setMyAvailability";
  const { data, error } = (await supabaseAdmin.rpc("couranr_set_my_driver_availability", {
    p_actor_user_id: params.userId,
    p_expected_version: params.expectedVersion,
    p_preference: params.preference,
  })) as { data: any; error: any };

  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: error,
    });
  }

  return {
    ok: true,
    value: {
      id: String(data.id),
      displayName: String(data.display_name ?? "Driver"),
      driverState: String(data.driver_state ?? "pending"),
      availabilityState: String(data.availability_state ?? "unavailable"),
      availabilityPreference: String(data.availability_preference ?? params.preference),
      active: Boolean(data.active),
      market: data.market == null ? null : String(data.market),
      version: Number(data.version),
    },
  };
}

export async function setMyVehicleAvailability(params: {
  userId: string;
  vehicleId: string;
  expectedVersion: number;
  availability: "available" | "unavailable";
}): Promise<Result<DriverVehicleView>> {
  return vehicleMutation("driver.setMyVehicleAvailability", "couranr_set_my_vehicle_availability", {
    p_actor_user_id: params.userId,
    p_vehicle_id: params.vehicleId,
    p_expected_version: params.expectedVersion,
    p_availability: params.availability,
  });
}

export async function updateMyVehicleCapabilities(params: {
  userId: string;
  vehicleId: string;
  expectedVersion: number;
  payloadCapacityLb: number;
  cargoLengthIn: number | null;
  cargoWidthIn: number | null;
  cargoHeightIn: number | null;
  enclosed: boolean;
  hasRamp: boolean;
  hasDolly: boolean;
  hasTieDowns: boolean;
  weatherProtection: boolean;
}): Promise<Result<DriverVehicleView>> {
  return vehicleMutation(
    "driver.updateMyVehicleCapabilities",
    "couranr_update_my_vehicle_capabilities",
    {
      p_actor_user_id: params.userId,
      p_vehicle_id: params.vehicleId,
      p_expected_version: params.expectedVersion,
      p_payload_capacity_lb: params.payloadCapacityLb,
      p_cargo_length_in: params.cargoLengthIn,
      p_cargo_width_in: params.cargoWidthIn,
      p_cargo_height_in: params.cargoHeightIn,
      p_enclosed: params.enclosed,
      p_has_ramp: params.hasRamp,
      p_has_dolly: params.hasDolly,
      p_has_tie_downs: params.hasTieDowns,
      p_weather_protection: params.weatherProtection,
    }
  );
}

async function vehicleMutation(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<Result<DriverVehicleView>> {
  const { data, error } = (await supabaseAdmin.rpc(fn as any, args as any)) as {
    data: any;
    error: any;
  };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: error,
    });
  }
  return { ok: true, value: vehicleView(data) };
}
