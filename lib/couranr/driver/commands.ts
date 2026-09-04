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
  CODE_SHOWN_ONCE_WARNING,
  type CodeKind,
  generateHandoffCode,
  handoffCodeDigest,
  isWellFormedHandoffCode,
  redactHandoffCodes,
} from "./codes";
import { HandoffSecretUnavailable } from "./handoffSecret";
import type { PinOutcome } from "./states";

assertServerOnly("lib/couranr/driver/commands.ts");

/**
 * The driver-execution command layer.
 *
 * Every function here is a thin, typed wrapper over an accepted SQL command.
 * The SQL is the authority on preconditions; this layer's job is to (a) never
 * let a browser-supplied identity through, (b) turn a database refusal into a
 * closed public result, and (c) keep raw PostgreSQL text server-side.
 *
 * THE IDENTITY RULE, STATED ONCE. No command takes a driver id. Every one
 * takes the AUTHENTICATED USER ID and lets `couranr_driver_assignment_for`
 * derive the caller's own driver profile and active assignment inside the
 * transaction. The delivery id a caller supplies can only NARROW that
 * assignment — it is checked against it, never used to find it. So an
 * unassigned driver and a driver naming someone else's delivery both get
 * CR403 `not_your_delivery`, byte-identical, and neither learns the delivery
 * exists.
 */

export type DriverFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
  reason?: string;
};
export type DriverResult<T> = { ok: true; value: T } | DriverFailure;

export function isDriverFailure(r: { ok: boolean }): r is DriverFailure {
  return r.ok === false;
}

/**
 * Reason codes the UI switches on. Closed, and matched against the SQL's own
 * exception messages — the commands raise a message that IS the code.
 */
const DRIVER_REASONS = new Set([
  "not_your_delivery",
  "delivery_not_in_expected_state",
  "location_required",
  "location_out_of_range",
  "package_count_required",
  "staff_identifier_required",
  "vehicle_mismatch",
  "pickup_discrepancy_open",
  "pickup_code_not_accepted",
  "shipment_photo_required",
  "condition_photo_required",
  "securement_photo_required",
  "loading_participants_required",
  "loading_equipment_required",
  "existing_damage_statement_required",
  "driver_acknowledgement_required",
  "wrong_proof_method",
  "recipient_first_name_required",
  "recipient_code_not_accepted",
  "signer_first_name_required",
  "signature_required",
  "safe_location_confirmation_required",
  "weather_confirmation_required",
  "delivery_photo_required",
  "too_late_to_unassign",
  "no_active_assignment",
  "reason_required",
  "discrepancy_not_open",
  "delivery_already_settled",
  "upload_expired",
  "upload_already_used",
  "assignment_changed",
  "assignment_version_changed",
  "proof_stage_not_valid_here",
  "object_path_mismatch",
  "object_empty",
  "object_size_mismatch",
  "object_too_large",
  "object_mime_mismatch",
  "object_mime_not_allowed",
]);

const REASON_MESSAGES: Record<string, string> = {
  not_your_delivery: "That delivery is not assigned to you.",
  delivery_not_in_expected_state: "This delivery has already moved on. Reload to see where it is.",
  location_required: "Couranr needs your location for this step. Turn on location and try again.",
  location_out_of_range: "The reported location is not a valid position.",
  package_count_required: "Enter how many packages you are collecting.",
  staff_identifier_required: "Enter the first name of the person handing the shipment over.",
  vehicle_mismatch: "This is not the vehicle assigned to this delivery. Report a discrepancy.",
  pickup_discrepancy_open: "Couranr is reviewing the issue you reported. You cannot complete pickup yet.",
  pickup_code_not_accepted: "Enter the sender's pickup code first.",
  shipment_photo_required: "Add the shipment photo.",
  condition_photo_required: "Add the condition photo.",
  securement_photo_required: "This load needs a securement photo.",
  loading_participants_required: "Record who helped load.",
  loading_equipment_required: "Record what equipment was used.",
  existing_damage_statement_required: "Record any existing damage, or state that there is none.",
  driver_acknowledgement_required: "Confirm you have checked the load.",
  wrong_proof_method: "This delivery is proven a different way. Reload to see what is required.",
  recipient_first_name_required: "Enter the recipient's first name.",
  recipient_code_not_accepted: "Enter the recipient's code first.",
  signer_first_name_required: "Enter the signer's first name.",
  signature_required: "Capture the signature first.",
  safe_location_confirmation_required: "Confirm the location is safe.",
  weather_confirmation_required: "Confirm the weather is suitable.",
  delivery_photo_required: "Add the delivery photo.",
  too_late_to_unassign: "The driver has already reached pickup. This delivery can no longer be unassigned.",
  no_active_assignment: "This delivery has no active assignment.",
  reason_required: "A reason is required.",
  discrepancy_not_open: "That issue has already been resolved.",
  delivery_already_settled: "This delivery is already finished.",
  upload_expired: "That upload window has closed. Take the photo again.",
  upload_already_used: "That upload has already been recorded.",
  assignment_changed: "This delivery was reassigned. Reload before continuing.",
  assignment_version_changed: "This delivery was reassigned. Reload before continuing.",
  proof_stage_not_valid_here: "That proof does not belong at this step.",
  object_path_mismatch: "The uploaded file did not match what Couranr expected.",
  object_empty: "The upload did not arrive. Try again.",
  object_size_mismatch: "The upload arrived incomplete. Try again.",
  object_too_large: "That image is too large.",
  object_mime_mismatch: "The uploaded file was not the type Couranr expected.",
  object_mime_not_allowed: "That file type is not accepted.",
};

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
  reason?: string;
}): DriverFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: p.operation,
    code: p.code,
    // Defence in depth: nothing in this module puts a code into a detail, but
    // the next `detail:` added here will pass through the same scrub.
    detail: scrub(p.detail),
  });
  const out: DriverFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  if (p.reason) out.reason = p.reason;
  return out;
}

/** Recursively strips anything six-digit-shaped from a diagnostic payload. */
function scrub(v: unknown): unknown {
  if (typeof v === "string") return redactHandoffCodes(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = scrub(val);
    return out;
  }
  return v;
}

function fromRpcError(operation: string, error: any): DriverFailure {
  const raw = typeof error?.message === "string" ? error.message : "";
  const reason = DRIVER_REASONS.has(raw) ? raw : undefined;
  return fail({
    operation,
    code: classifyDatabaseError(error),
    detail: { code: error?.code, message: raw },
    message: reason ? REASON_MESSAGES[reason] : undefined,
    reason,
  });
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<DriverResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) return fromRpcError(operation, error);
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/** The public shape of a delivery after a transition. Never the whole row. */
export type DeliveryStateView = {
  deliveryId: string;
  fulfillmentState: string;
  version: number;
};

function stateView(row: any): DeliveryStateView {
  return {
    deliveryId: String(row?.id ?? ""),
    fulfillmentState: String(row?.fulfillment_state ?? ""),
    version: Number(row?.version ?? 0),
  };
}

type Base = { userId: string; deliveryId: string; expectedVersion: number };
type WithLocation = Base & { latitude: number; longitude: number; accuracyM?: number | null };

/* ============================================ A. fulfillment transitions == */

export async function startRouteToPickup(p: Base): Promise<DriverResult<DeliveryStateView>> {
  const r = await callRpc("startRouteToPickup", "couranr_start_route_to_pickup", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: p.userId,
  });
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

export async function arriveAtPickup(p: WithLocation): Promise<DriverResult<DeliveryStateView>> {
  const r = await callRpc("arriveAtPickup", "couranr_arrive_at_pickup", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: p.userId,
    p_latitude: p.latitude,
    p_longitude: p.longitude,
    p_accuracy_m: p.accuracyM ?? null,
  });
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

export async function startRouteToDropoff(p: Base): Promise<DriverResult<DeliveryStateView>> {
  const r = await callRpc("startRouteToDropoff", "couranr_start_route_to_dropoff", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: p.userId,
  });
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

export async function arriveAtDropoff(p: WithLocation): Promise<DriverResult<DeliveryStateView>> {
  const r = await callRpc("arriveAtDropoff", "couranr_arrive_at_dropoff", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: p.userId,
    p_latitude: p.latitude,
    p_longitude: p.longitude,
    p_accuracy_m: p.accuracyM ?? null,
  });
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

export async function completePickup(
  p: WithLocation & {
    observedPackageCount: number;
    staffFirstName: string;
    confirmedVehicleId: string;
    dimensions?: Record<string, unknown> | null;
    loadingParticipants?: string | null;
    loadingEquipment?: string | null;
    existingDamage?: string | null;
    driverAcknowledged?: boolean | null;
  }
): Promise<DriverResult<DeliveryStateView>> {
  const r = await callRpc("completePickup", "couranr_complete_pickup", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: p.userId,
    p_observed_package_count: p.observedPackageCount,
    p_staff_first_name: p.staffFirstName,
    p_confirmed_vehicle_id: p.confirmedVehicleId,
    p_latitude: p.latitude,
    p_longitude: p.longitude,
    p_accuracy_m: p.accuracyM ?? null,
    p_dimensions: p.dimensions ?? null,
    p_loading_participants: p.loadingParticipants ?? null,
    p_loading_equipment: p.loadingEquipment ?? null,
    p_existing_damage: p.existingDamage ?? null,
    p_driver_acknowledged: p.driverAcknowledged ?? null,
  });
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

/* ================================================= B. delivery completion = */

export type CompletionReceipt = {
  deliveryId: string;
  assignmentId: string;
  deliveredAt: string;
  proofMethod: string;
  pickupProofComplete: boolean;
  deliveryProofComplete: boolean;
};

/**
 * The receipt, read back through the SQL function whose SELECT list IS the
 * privacy boundary. Read rather than assembled here so the completion response
 * and the 24-hour lookup cannot diverge — one query, one shape, one place to
 * audit.
 */
async function receiptFor(userId: string): Promise<CompletionReceipt | null> {
  const { data } = (await supabaseAdmin.rpc("couranr_driver_completion_receipt", {
    p_actor_user_id: userId,
  })) as { data: any };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    deliveryId: String(row.delivery_id),
    assignmentId: String(row.assignment_id),
    deliveredAt: String(row.delivered_at),
    proofMethod: String(row.proof_method),
    pickupProofComplete: row.pickup_proof_complete === true,
    deliveryProofComplete: row.delivery_proof_complete === true,
  };
}

export async function driverCompletionReceipt(userId: string): Promise<CompletionReceipt | null> {
  return receiptFor(userId);
}

type CompletionValue = { delivery: DeliveryStateView; receipt: CompletionReceipt | null };

async function completeWith(
  operation: string,
  fn: string,
  userId: string,
  args: Record<string, unknown>
): Promise<DriverResult<CompletionValue>> {
  const r = await callRpc(operation, fn, args);
  if (!r.ok) return r;
  // Returned immediately so the driver's success screen needs no second call —
  // and so it renders the SAME sanitized shape the 24-hour lookup returns.
  return { ok: true, value: { delivery: stateView(r.value), receipt: await receiptFor(userId) } };
}

export function completeDirectHandoffDelivery(
  p: WithLocation & { recipientFirstName: string }
): Promise<DriverResult<CompletionValue>> {
  return completeWith(
    "completeDirectHandoffDelivery",
    "couranr_complete_direct_handoff_delivery",
    p.userId,
    {
      p_delivery_id: p.deliveryId,
      p_expected_version: p.expectedVersion,
      p_actor_user_id: p.userId,
      p_recipient_first_name: p.recipientFirstName,
      p_latitude: p.latitude,
      p_longitude: p.longitude,
      p_accuracy_m: p.accuracyM ?? null,
    }
  );
}

export function completeSignatureDelivery(
  p: WithLocation & { signerFirstName: string }
): Promise<DriverResult<CompletionValue>> {
  return completeWith(
    "completeSignatureDelivery",
    "couranr_complete_signature_delivery",
    p.userId,
    {
      p_delivery_id: p.deliveryId,
      p_expected_version: p.expectedVersion,
      p_actor_user_id: p.userId,
      p_signer_first_name: p.signerFirstName,
      p_latitude: p.latitude,
      p_longitude: p.longitude,
      p_accuracy_m: p.accuracyM ?? null,
    }
  );
}

export function completeLeaveAtDoorDelivery(
  p: WithLocation & { safeLocation: boolean; weatherSuitable: boolean }
): Promise<DriverResult<CompletionValue>> {
  return completeWith(
    "completeLeaveAtDoorDelivery",
    "couranr_complete_leave_at_door_delivery",
    p.userId,
    {
      p_delivery_id: p.deliveryId,
      p_expected_version: p.expectedVersion,
      p_actor_user_id: p.userId,
      p_safe_location: p.safeLocation,
      p_weather_suitable: p.weatherSuitable,
      p_latitude: p.latitude,
      p_longitude: p.longitude,
      p_accuracy_m: p.accuracyM ?? null,
    }
  );
}

/* ======================================================== C. discrepancy == */

export async function reportPickupDiscrepancy(p: {
  userId: string;
  deliveryId: string;
  reason: string;
  notes?: string | null;
}): Promise<DriverResult<{ discrepancyId: string; state: string; version: number }>> {
  const r = await callRpc("reportPickupDiscrepancy", "couranr_report_pickup_discrepancy", {
    p_delivery_id: p.deliveryId,
    p_actor_user_id: p.userId,
    p_reason: p.reason,
    p_notes: p.notes ?? null,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      discrepancyId: String(r.value.id),
      state: String(r.value.discrepancy_state),
      version: Number(r.value.version),
    },
  };
}

/**
 * §31 — the assigned driver records a problem AFTER pickup (picked_up /
 * in_transit / at_dropoff; the SQL command enforces the states and the
 * assignment). Evidence only: it gates nothing for the driver, but an OPEN
 * dropoff exception is one of the two halves Operations needs before
 * `couranr_close_delivery_undeliverable` will release a driver who has
 * custody (review item 4).
 */
export async function reportDropoffException(p: {
  userId: string;
  deliveryId: string;
  reason: string;
  notes?: string | null;
}): Promise<DriverResult<{ discrepancyId: string; state: string; version: number }>> {
  const r = await callRpc("reportDropoffException", "couranr_report_dropoff_exception", {
    p_delivery_id: p.deliveryId,
    p_actor_user_id: p.userId,
    p_reason: p.reason,
    p_notes: p.notes ?? null,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      discrepancyId: String(r.value.id),
      state: String(r.value.discrepancy_state),
      version: Number(r.value.version),
    },
  };
}

/** Operations only — the gate is the route's actor check plus this one. */
export async function resolveSafePickupDiscrepancy(p: {
  actor: RequestActor;
  discrepancyId: string;
  expectedVersion: number;
  note?: string | null;
}): Promise<DriverResult<{ discrepancyId: string; state: string }>> {
  if (p.actor?.kind !== "operations") {
    return fail({
      operation: "resolveSafePickupDiscrepancy",
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can clear a pickup issue.",
    });
  }
  const r = await callRpc(
    "resolveSafePickupDiscrepancy",
    "couranr_resolve_pickup_discrepancy_safe_to_continue",
    {
      p_discrepancy_id: p.discrepancyId,
      p_expected_version: p.expectedVersion,
      p_actor_user_id: (p.actor as any).userId,
      p_note: p.note ?? null,
    }
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: { discrepancyId: String(r.value.id), state: String(r.value.discrepancy_state) },
  };
}

export async function unassignDeliveryBeforePickup(p: {
  actor: RequestActor;
  deliveryId: string;
  expectedVersion: number;
  reason: string;
}): Promise<DriverResult<DeliveryStateView>> {
  if (p.actor?.kind !== "operations") {
    return fail({
      operation: "unassignDeliveryBeforePickup",
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can unassign a delivery.",
    });
  }
  const r = await callRpc(
    "unassignDeliveryBeforePickup",
    "couranr_unassign_delivery_before_pickup",
    {
      p_delivery_id: p.deliveryId,
      p_expected_version: p.expectedVersion,
      p_actor_user_id: (p.actor as any).userId,
      p_reason: p.reason,
    }
  );
  return r.ok ? { ok: true, value: stateView(r.value) } : r;
}

/* ================================================ D. handoff credentials == */

export type IssuedCode = {
  code: string;
  kind: CodeKind;
  generation: number;
  expiresAt: string;
  warning: string;
};

/**
 * Issue or regenerate. There is no "mode" parameter: the SQL command owns the
 * generation behaviour — it supersedes every live generation of THIS kind and
 * mints the next one — so issuing and regenerating are the same call, and a
 * caller cannot select between two behaviours.
 *
 * The raw code exists only in this return value. It is never stored, never
 * logged, and there is no route anywhere that reads one back.
 */
export async function issueHandoffCode(p: {
  actorUserId: string;
  deliveryId: string;
  kind: CodeKind;
  ttlMinutes?: number;
}): Promise<DriverResult<IssuedCode>> {
  const operation = "issueHandoffCode";
  const MAX_GENERATION_ATTEMPTS = 4;

  /**
   * Generation is part of the HMAC domain, so the raw code and the generation
   * the database stores must be committed together. The SQL command now takes
   * p_expected_generation and checks it while holding the delivery row lock,
   * BEFORE superseding the current credential. If another issuer wins between
   * this read and that lock, CR409 handoff_generation_conflict writes nothing;
   * we refresh and mint a NEW raw code for the new generation.
   */
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const { data: cur, error: generationError } = (await supabaseAdmin
      .from("couranr_handoff_codes")
      .select("generation")
      .eq("delivery_id", p.deliveryId)
      .eq("code_kind", p.kind)
      .order("generation", { ascending: false })
      .limit(1)) as { data: any; error: any };

    if (generationError) {
      return fail({
        operation,
        code: classifyDatabaseError(generationError),
        detail: { reason: "generation_read_failed", code: generationError?.code },
      });
    }

    const generation = Number(cur?.[0]?.generation ?? 0) + 1;
    const code = generateHandoffCode();

    let digest: string;
    try {
      digest = handoffCodeDigest({
        kind: p.kind,
        deliveryId: p.deliveryId,
        generation,
        code,
      });
    } catch (e: any) {
      // A missing or unusable secret fails CLOSED. No credential row is
      // written and the raw code is discarded with this stack frame.
      return fail({
        operation,
        code: "internal",
        detail: {
          reason:
            e instanceof HandoffSecretUnavailable
              ? "handoff_secret_unavailable"
              : "digest_failed",
        },
      });
    }

    const { data, error } = (await supabaseAdmin.rpc("couranr_issue_handoff_code", {
      p_delivery_id: p.deliveryId,
      p_code_kind: p.kind,
      p_expected_generation: generation,
      p_code_digest: digest,
      p_actor_user_id: p.actorUserId,
      p_ttl_minutes: p.ttlMinutes ?? 1440,
    })) as { data: any; error: any };

    if (error) {
      if (error?.code === "CR409" && error?.message === "handoff_generation_conflict") {
        continue;
      }
      return fromRpcError(operation, error);
    }

    if (!data) {
      return fail({ operation, code: "conflict", detail: { reason: "no row returned" } });
    }

    const storedGeneration = Number(data.generation);
    if (storedGeneration !== generation) {
      // Defense in depth. The SQL CAS should make this impossible; returning a
      // raw code signed for a different generation would be worse than failing.
      return fail({
        operation,
        code: "internal",
        detail: { reason: "handoff_generation_mismatch" },
      });
    }

    return {
      ok: true,
      value: {
        code,
        kind: p.kind,
        generation: storedGeneration,
        expiresAt: String(data.expires_at),
        warning: CODE_SHOWN_ONCE_WARNING,
      },
    };
  }

  return fail({
    operation,
    code: "conflict",
    detail: { reason: "handoff_generation_contention" },
    message: "The handoff code changed at the same time. Try again.",
  });
}

/**
 * Verify a submitted code. Returns an OUTCOME, never a thrown failure, for the
 * ordinary wrong-code case — that is a business event and the attempt counter
 * it increments is what makes a six-digit credential safe at all.
 */
async function verifyHandoffCode(p: {
  userId: string;
  deliveryId: string;
  kind: CodeKind;
  code: string;
}): Promise<DriverResult<{ outcome: PinOutcome }>> {
  const operation = `verify:${p.kind}`;

  if (!isWellFormedHandoffCode(p.code)) {
    // Refused before a digest is computed, so attacker-shaped input never
    // reaches the HMAC or the database. Reported as `invalid` rather than a
    // validation error: the holder of a wrong code learns the same thing
    // either way, and a distinct shape would be an oracle.
    return { ok: true, value: { outcome: "invalid" } };
  }

  // The digest must be bound to the generation the database currently holds.
  const { data: cur } = (await supabaseAdmin
    .from("couranr_handoff_codes")
    .select("generation")
    .eq("delivery_id", p.deliveryId)
    .eq("code_kind", p.kind)
    .in("code_state", ["active", "locked"])
    .order("generation", { ascending: false })
    .limit(1)) as { data: any };

  const generation = Number(cur?.[0]?.generation ?? 0);
  if (!generation) {
    // Nothing live. Indistinguishable from expiry on purpose — neither answer
    // tells the holder whether a credential ever existed for this delivery.
    return { ok: true, value: { outcome: "expired" } };
  }

  let digest: string;
  try {
    digest = handoffCodeDigest({ kind: p.kind, deliveryId: p.deliveryId, generation, code: p.code });
  } catch {
    return fail({ operation, code: "internal", detail: { reason: "handoff_secret_unavailable" } });
  }

  const r = await callRpc(operation, "couranr_verify_handoff_code", {
    p_delivery_id: p.deliveryId,
    p_code_kind: p.kind,
    p_code_digest: digest,
    // Load-bearing. Without it the SQL scoped nothing to the caller, so ANY
    // authenticated user holding a delivery UUID could burn all five attempts
    // and lock a real delivery's credential — or consume it on a lucky guess.
    // The command now derives the caller's own active assignment first, so a
    // stranger's attempt never reaches the counter at all.
    p_actor_user_id: p.userId,
  });
  if (!r.ok) return r;

  const outcome = String(r.value.outcome) as PinOutcome;
  return { ok: true, value: { outcome } };
}

/** Separate typed entry points, so a caller cannot pass the wrong kind. */
export function verifyPickupPin(p: {
  userId: string;
  deliveryId: string;
  code: string;
}): Promise<DriverResult<{ outcome: PinOutcome }>> {
  return verifyHandoffCode({ ...p, kind: "merchant_pickup" });
}

export function verifyRecipientPin(p: {
  userId: string;
  deliveryId: string;
  code: string;
}): Promise<DriverResult<{ outcome: PinOutcome }>> {
  return verifyHandoffCode({ ...p, kind: "recipient_dropoff" });
}

export { fail as driverFail };
