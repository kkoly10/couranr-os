import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { PickupManifestInput, PickupManifestView } from "./types";
import { pickupManifestFromRow } from "./types";

assertServerOnly("lib/couranr/pickup/manifest.ts");

export type PickupManifestFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type PickupManifestResult =
  | { ok: true; value: PickupManifestView }
  | PickupManifestFailure;

export function isPickupManifestFailure(
  r: { ok: boolean },
): r is PickupManifestFailure {
  return r.ok === false;
}

function failure(operation: string, error: any, message?: string): PickupManifestFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation,
    code: classifyDatabaseError(error),
    detail: { code: error?.code, message: error?.message },
  });
  return {
    ok: false,
    code: classifyDatabaseError(error),
    correlationId,
    message,
  };
}

async function rpc(
  operation: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<PickupManifestResult> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as {
    data: any;
    error: any;
  };
  if (error) {
    const publicMessage =
      error?.message === "pickup_manifest_locked"
        ? "Pickup details are already locked for this delivery."
        : error?.message === "pickup_manifest_version_conflict"
          ? "Pickup details changed in another tab. Reload and try again."
          : undefined;
    return failure(operation, error, publicMessage);
  }
  const view = pickupManifestFromRow(data);
  if (!view) {
    return failure(operation, { code: "CR409", message: "pickup_manifest_missing" });
  }
  return { ok: true, value: view };
}

function manifestArgs(input: PickupManifestInput) {
  return {
    p_description: input.description,
    p_package_count: input.packageCount,
    p_order_reference: input.orderReference,
    p_handling_notes: input.handlingNotes,
  };
}

export function setBusinessPickupManifest(input: {
  requestId: string;
  businessAccountId: string;
  actorUserId: string;
  expectedManifestVersion: number;
  manifest: PickupManifestInput;
}) {
  return rpc("setBusinessPickupManifest", "couranr_set_business_pickup_manifest", {
    p_request_id: input.requestId,
    p_business_account_id: input.businessAccountId,
    p_actor_user_id: input.actorUserId,
    p_expected_manifest_version: input.expectedManifestVersion,
    ...manifestArgs(input.manifest),
  });
}

export function setOperationsPickupManifest(input: {
  requestId: string;
  actorUserId: string;
  expectedManifestVersion: number;
  manifest: PickupManifestInput;
}) {
  return rpc("setOperationsPickupManifest", "couranr_set_operations_pickup_manifest", {
    p_request_id: input.requestId,
    p_actor_user_id: input.actorUserId,
    p_expected_manifest_version: input.expectedManifestVersion,
    ...manifestArgs(input.manifest),
  });
}

export function setConsumerPickupManifest(input: {
  guestSessionId: string;
  expectedManifestVersion: number;
  manifest: PickupManifestInput;
}) {
  return rpc("setConsumerPickupManifest", "couranr_set_consumer_pickup_manifest", {
    p_guest_session_id: input.guestSessionId,
    p_expected_manifest_version: input.expectedManifestVersion,
    ...manifestArgs(input.manifest),
  });
}

export function setHostedCustomerPickupManifest(input: {
  intakeId: string;
  expectedManifestVersion: number;
  manifest: PickupManifestInput;
}) {
  return rpc("setHostedCustomerPickupManifest", "couranr_set_hosted_customer_pickup_manifest", {
    p_intake_id: input.intakeId,
    p_expected_manifest_version: input.expectedManifestVersion,
    ...manifestArgs(input.manifest),
  });
}

export function confirmHostedPickupManifest(input: {
  requestId: string;
  hostBusinessAccountId: string;
  actorUserId: string;
  expectedManifestVersion: number;
  manifest: PickupManifestInput;
}) {
  return rpc("confirmHostedPickupManifest", "couranr_confirm_hosted_pickup_manifest", {
    p_request_id: input.requestId,
    p_host_business_account_id: input.hostBusinessAccountId,
    p_actor_user_id: input.actorUserId,
    p_expected_manifest_version: input.expectedManifestVersion,
    ...manifestArgs(input.manifest),
  });
}
