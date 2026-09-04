import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isDriverProfileFailure,
  setMyVehicleAvailability,
  updateMyVehicleCapabilities,
} from "@/lib/couranr/driver/profile";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveIntegerOrNull(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
}

/**
 * PATCH — bounded self-service for a vehicle already associated with the
 * calling driver. Operations still owns assignment and vehicle identity/class.
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Vehicle not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current vehicle version is required.");
  }

  if (body?.action === "set_availability") {
    if (body?.availability !== "available" && body?.availability !== "unavailable") {
      return routeFailure("invalid_input", "Choose available or unavailable.");
    }
    const result = await setMyVehicleAvailability({
      userId: auth.userId,
      vehicleId: params.id,
      expectedVersion,
      availability: body.availability,
    });
    if (isDriverProfileFailure(result)) return failureResponse(result);
    return NextResponse.json({ vehicle: result.value });
  }

  if (body?.action === "update_capabilities") {
    const payload = Number(body?.payloadCapacityLb);
    const length = positiveIntegerOrNull(body?.cargoLengthIn);
    const width = positiveIntegerOrNull(body?.cargoWidthIn);
    const height = positiveIntegerOrNull(body?.cargoHeightIn);

    if (!Number.isInteger(payload) || payload <= 0 || length === "invalid" || width === "invalid" || height === "invalid") {
      return routeFailure("invalid_input", "Vehicle capacity details need attention.");
    }

    const result = await updateMyVehicleCapabilities({
      userId: auth.userId,
      vehicleId: params.id,
      expectedVersion,
      payloadCapacityLb: payload,
      cargoLengthIn: length,
      cargoWidthIn: width,
      cargoHeightIn: height,
      enclosed: Boolean(body?.enclosed),
      hasRamp: Boolean(body?.hasRamp),
      hasDolly: Boolean(body?.hasDolly),
      hasTieDowns: Boolean(body?.hasTieDowns),
      weatherProtection: Boolean(body?.weatherProtection),
    });
    if (isDriverProfileFailure(result)) return failureResponse(result);
    return NextResponse.json({ vehicle: result.value });
  }

  return routeFailure("invalid_input", "Unknown vehicle action.");
}
