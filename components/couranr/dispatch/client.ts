"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/**
 * Browser calls for managed dispatch.
 *
 * Everything goes through `call`, which attaches the Bearer token — a
 * hand-rolled fetch carries none, and every canonical route resolves its actor
 * from one. The bodies here carry IDENTIFIERS and a version, never a
 * capability and never a target state.
 */

export type DispatchDriver = {
  id: string;
  display_name: string;
  contact_phone: string | null;
  driver_state: string;
  availability_state: string;
  active: boolean;
  market: string | null;
  version: number;
};

export type DispatchVehicle = {
  id: string;
  assigned_driver_id: string | null;
  name: string;
  vehicle_class: string;
  payload_capacity_lb: number;
  active: boolean;
  availability_state: string;
  version: number;
};

export type DispatchAssignment = {
  id: string;
  delivery_id: string;
  driver_id: string;
  vehicle_id: string;
  assignment_state: string;
  assigned_at: string;
  ended_at: string | null;
  end_reason: string | null;
  version: number;
};

export type DispatchPanelView = {
  delivery: {
    id: string;
    fulfillment_state: string;
    vehicle_requirement: { vehicleClass?: string; maxPayloadLb?: number };
    scheduled_pickup_start: string;
    scheduled_pickup_end: string;
    timezone: string;
    version: number;
  } | null;
  assignment: DispatchAssignment | null;
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
  events: Array<{
    id: string;
    command: string;
    actor_type: string;
    created_at: string;
    metadata: Record<string, any>;
  }>;
};

export function fetchDispatchPanel(deliveryId: string) {
  return call<DispatchPanelView>(`/api/couranr/operations/deliveries/${deliveryId}/assignment`);
}

/** Assign. Carries two ids and the delivery version — nothing else. */
export function assignDeliveryFromBrowser(input: {
  deliveryId: string;
  expectedVersion: number;
  driverId: string;
  vehicleId: string;
}) {
  return call<{ assignment: DispatchAssignment }>(
    `/api/couranr/operations/deliveries/${input.deliveryId}/assignment`,
    {
      method: "POST",
      body: {
        expectedVersion: input.expectedVersion,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
      },
    }
  );
}

/**
 * Replace before pickup. Scoped to the assignment being replaced, and to ITS
 * version — the delivery does not move during a replacement, so a delivery
 * version here would be the same on every attempt.
 */
export function replaceAssignmentFromBrowser(input: {
  deliveryId: string;
  replacedAssignmentId: string;
  expectedAssignmentVersion: number;
  driverId: string;
  vehicleId: string;
  reason?: string;
}) {
  return call<{ assignment: DispatchAssignment }>(
    `/api/couranr/operations/deliveries/${input.deliveryId}/assignment`,
    {
      method: "PUT",
      body: {
        replacedAssignmentId: input.replacedAssignmentId,
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        reason: input.reason ?? null,
      },
    }
  );
}

export function fetchDispatchVehicles() {
  return call<{ vehicles: DispatchVehicle[] }>("/api/couranr/operations/vehicles");
}

export function fetchDispatchDrivers() {
  return call<{ drivers: DispatchDriver[] }>("/api/couranr/operations/drivers");
}

export function createDispatchVehicleFromBrowser(input: {
  name: string;
  vehicleClass: string;
  payloadCapacityLb: number;
}) {
  return call<{ vehicle: DispatchVehicle }>("/api/couranr/operations/vehicles", {
    method: "POST",
    body: input,
  });
}

/** `availability` names a DESTINATION; the server maps it to a named command. */
export function setVehicleAvailabilityFromBrowser(input: {
  vehicleId: string;
  expectedVersion: number;
  availability: "available" | "unavailable";
}) {
  return call<{ vehicle: DispatchVehicle }>(
    `/api/couranr/operations/vehicles/${input.vehicleId}`,
    {
      method: "PATCH",
      body: { expectedVersion: input.expectedVersion, availability: input.availability },
    }
  );
}

/** The sanitized projection for the CALLING driver. No id is required. */
export function fetchMyAssignment(deliveryId?: string) {
  const qs = deliveryId ? `?deliveryId=${encodeURIComponent(deliveryId)}` : "";
  return call<{ assigned: any | null }>(`/api/couranr/driver/assignment${qs}`);
}

export type { ApiResult };
