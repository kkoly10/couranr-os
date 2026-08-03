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

/**
 * The sanitized projection a driver may see while an assignment is ACTIVE.
 *
 * Mirrors `AssignedDeliveryProjection` in lib/couranr/dispatch/projection.ts,
 * which is server-only and cannot be imported here. `tests/couranr-dispatch`
 * holds the two in step; the allow-list on the server is the authority.
 */
export type AssignedDeliveryView = {
  deliveryId: string;
  /**
   * The compare-and-set token every driver command must send. Null only if the
   * server could not determine one, in which case the action is blocked rather
   * than sent with a guess — see `readDeliveryVersion`.
   */
  version: number | null;
  fulfillmentState: string;
  serviceLevel: string;
  scheduledPickupStart: string;
  scheduledPickupEnd: string;
  timezone: string;
  pickup: DeliveryAddressView;
  dropoff: DeliveryAddressView;
  merchant: { name: string; phone: string };
  recipient: { name: string; phone: string };
  shipment: {
    packageCount: number | null;
    declaredWeightLb: number | null;
    additionalStops: number | null;
  };
  proof: { method: string; signatureRequired: boolean };
  vehicleRequirement: { vehicleClass: string | null; maxPayloadLb: number | null };
  assignment: {
    assignmentId: string;
    assignedAt: string;
    vehicle: { id: string; name: string; vehicleClass: string } | null;
  };
};

export type DeliveryAddressView = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  instructions: string;
};

/**
 * What survives completion. Six fields, and the absences are the point: no
 * address, no recipient contact, no merchant note, no money, no object path,
 * no signed URL. A finished delivery stops being readable rather than
 * lingering on a success screen.
 */
export type DriverCompletionReceipt = {
  deliveryId: string;
  assignmentId: string;
  deliveredAt: string;
  proofMethod: string;
  pickupProofComplete: boolean;
  deliveryProofComplete: boolean;
};

/**
 * Three states, discriminated, and NONE of them means "the request failed".
 *
 * That distinction is the whole reason this is a union rather than a nullable
 * field. `{ assigned: null }` collapsed "you have no work" and "we could not
 * find out" into one shape, and this repo has already shipped a screen that
 * rendered a failed lookup as "you have no business". A failure is an
 * `ApiFailure` from `call`, and every consumer must handle it separately.
 */
export type DriverAssignmentResponse =
  | { status: "active"; assigned: AssignedDeliveryView }
  | { status: "recently_completed"; receipt: DriverCompletionReceipt }
  | { status: "none"; assigned: null };

/** The sanitized projection for the CALLING driver. No id is required. */
export function fetchMyAssignment(deliveryId?: string) {
  const qs = deliveryId ? `?deliveryId=${encodeURIComponent(deliveryId)}` : "";
  return call<DriverAssignmentResponse>(`/api/couranr/driver/assignment${qs}`);
}

/* ------------------------------------------------ driver execution calls -- */

type Located = { latitude: number; longitude: number; accuracyM: number | null };

export function startRouteToPickup(deliveryId: string, expectedVersion: number) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/driver/deliveries/${deliveryId}/start-pickup-route`,
    { method: "POST", body: { expectedVersion } }
  );
}

export function arriveAtPickup(deliveryId: string, expectedVersion: number, at: Located) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/driver/deliveries/${deliveryId}/arrive-at-pickup`,
    { method: "POST", body: { expectedVersion, ...at } }
  );
}

export function startRouteToDropoff(deliveryId: string, expectedVersion: number) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/driver/deliveries/${deliveryId}/start-dropoff-route`,
    { method: "POST", body: { expectedVersion } }
  );
}

export function arriveAtDropoff(deliveryId: string, expectedVersion: number, at: Located) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/driver/deliveries/${deliveryId}/arrive-at-dropoff`,
    { method: "POST", body: { expectedVersion, ...at } }
  );
}

export function completePickup(
  deliveryId: string,
  body: {
    expectedVersion: number;
    observedPackageCount: number;
    staffFirstName: string;
    confirmedVehicleId: string;
    dimensions?: Record<string, unknown> | null;
    loadingParticipants?: string | null;
    loadingEquipment?: string | null;
    existingDamage?: string | null;
    driverAcknowledged?: boolean | null;
  } & Located
) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/driver/deliveries/${deliveryId}/complete-pickup`,
    { method: "POST", body }
  );
}

export type CompletionResult = {
  delivery: DeliveryStateView;
  receipt: DriverCompletionReceipt | null;
};

export function completeDirectHandoff(
  deliveryId: string,
  body: { expectedVersion: number; recipientFirstName: string } & Located
) {
  return call<CompletionResult>(
    `/api/couranr/driver/deliveries/${deliveryId}/complete-direct-handoff`,
    { method: "POST", body }
  );
}

export function completeSignature(
  deliveryId: string,
  body: { expectedVersion: number; signerFirstName: string } & Located
) {
  return call<CompletionResult>(
    `/api/couranr/driver/deliveries/${deliveryId}/complete-signature`,
    { method: "POST", body }
  );
}

export function completeLeaveAtDoor(
  deliveryId: string,
  body: { expectedVersion: number; safeLocation: boolean; weatherSuitable: boolean } & Located
) {
  return call<CompletionResult>(
    `/api/couranr/driver/deliveries/${deliveryId}/complete-leave-at-door`,
    { method: "POST", body }
  );
}

export function reportDiscrepancy(deliveryId: string, body: { reason: string; notes?: string }) {
  return call<{ discrepancy: { discrepancyId: string; state: string; version: number } }>(
    `/api/couranr/driver/deliveries/${deliveryId}/discrepancy`,
    { method: "POST", body }
  );
}

/** Closed outcomes only. No attempt count, no generation, no lock metadata. */
export type PinAttempt = { outcome: "accepted" | "invalid" | "locked" | "expired" };

export function verifyPickupCode(deliveryId: string, code: string) {
  return call<PinAttempt>(`/api/couranr/driver/deliveries/${deliveryId}/verify-pickup-code`, {
    method: "POST",
    body: { code },
  });
}

export function verifyRecipientCode(deliveryId: string, code: string) {
  return call<PinAttempt>(`/api/couranr/driver/deliveries/${deliveryId}/verify-recipient-code`, {
    method: "POST",
    body: { code },
  });
}

export type DeliveryStateView = {
  deliveryId: string;
  fulfillmentState: string;
  version: number;
};

/** The raw code exists in THIS response and nowhere else, ever. */
export type IssuedHandoffCodeView = {
  code: string;
  kind: "merchant_pickup" | "recipient_dropoff";
  generation: number;
  expiresAt: string;
  warning: string;
};

export function issueMerchantPickupCode(deliveryId: string) {
  return call<{ handoffCode: IssuedHandoffCodeView }>(
    `/api/couranr/merchant/deliveries/${deliveryId}/pickup-code`,
    { method: "POST", body: {} }
  );
}

export function issueMerchantRecipientCode(deliveryId: string) {
  return call<{ handoffCode: IssuedHandoffCodeView }>(
    `/api/couranr/merchant/deliveries/${deliveryId}/recipient-code`,
    { method: "POST", body: {} }
  );
}

export function issueOperationsPickupCode(deliveryId: string) {
  return call<{ handoffCode: IssuedHandoffCodeView }>(
    `/api/couranr/operations/deliveries/${deliveryId}/pickup-code`,
    { method: "POST", body: {} }
  );
}

export function issueOperationsRecipientCode(deliveryId: string) {
  return call<{ handoffCode: IssuedHandoffCodeView }>(
    `/api/couranr/operations/deliveries/${deliveryId}/recipient-code`,
    { method: "POST", body: {} }
  );
}

/** Metadata only. There is no `url` and no `path` field, by construction. */
export type ProofMetadataView = {
  proofId: string;
  proofStage: string;
  proofType: string;
  finalizedAt: string;
  hasMedia: boolean;
};

export function fetchMerchantProof(deliveryId: string) {
  return call<{ proof: ProofMetadataView[] }>(
    `/api/couranr/merchant/deliveries/${deliveryId}/proof`
  );
}

export function fetchOperationsProofUrl(proofId: string) {
  return call<{ url: string; expiresInSeconds: number }>(
    `/api/couranr/operations/proof/${proofId}/url`
  );
}

export function unassignBeforePickup(
  deliveryId: string,
  body: { expectedVersion: number; reason: string }
) {
  return call<{ delivery: DeliveryStateView }>(
    `/api/couranr/operations/deliveries/${deliveryId}/unassign`,
    { method: "POST", body }
  );
}

export function resolveDiscrepancySafeToContinue(
  discrepancyId: string,
  body: { expectedVersion: number; note?: string }
) {
  return call<{ discrepancy: { discrepancyId: string; state: string } }>(
    `/api/couranr/operations/discrepancies/${discrepancyId}/safe-to-continue`,
    { method: "POST", body }
  );
}

/* ------------------------------------------------------------- proof I/O -- */

export type ProofUploadTicketView = {
  uploadId: string;
  signedUrl: string;
  token: string;
  expectedBytes: number;
  expectedMime: string;
  expiresInSeconds: number;
};

export function requestProofUpload(
  deliveryId: string,
  body: { stage: string; proofType: string; expectedMime: string; expectedBytes: number }
) {
  return call<ProofUploadTicketView>(
    `/api/couranr/driver/deliveries/${deliveryId}/proof-upload`,
    { method: "POST", body }
  );
}

export function finalizeProofUpload(body: {
  uploadId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  discrepancyId?: string | null;
}) {
  return call<{ proof: { proofId: string; proofStage: string; proofType: string; finalizedAt: string; byteSize: number | null } }>(
    "/api/couranr/driver/proof/finalize",
    { method: "POST", body }
  );
}

export type { ApiResult };
