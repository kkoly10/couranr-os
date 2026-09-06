import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { RequestActor } from "@/lib/couranr/requests/permissions";

assertServerOnly("lib/couranr/fulfillment/returns.ts");

export type ReturnFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type ReturnResult<T> = { ok: true; value: T } | ReturnFailure;

export function isReturnFailure(r: { ok: boolean }): r is ReturnFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): ReturnFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: ReturnFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

async function rpc<T>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<ReturnResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: T | null; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error?.code, message: error?.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data };
}

function requireOperations(actor: RequestActor, operation: string): ReturnFailure | null {
  if (actor.kind === "operations") return null;
  return fail({
    operation,
    code: "not_permitted",
    detail: { reason: "not_operations" },
    message: "Only Couranr Operations can make that custody decision.",
  });
}

export const RETURN_REASONS = [
  "recipient_unavailable",
  "address_or_access_problem",
  "weather_or_safety",
  "damage_or_condition",
  "customer_request",
  "merchant_request",
  "couranr_caused",
  "other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export function isReturnReason(v: unknown): v is ReturnReason {
  return typeof v === "string" && (RETURN_REASONS as readonly string[]).includes(v);
}

export type ReturnView = {
  id: string;
  request_id: string;
  delivery_id: string;
  assignment_id: string;
  source_discrepancy_id: string;
  return_state: "required" | "returning" | "returned";
  reason: ReturnReason;
  source_fulfillment_state: string;
  return_destination_snapshot: Record<string, unknown>;
  pricing_status: "couranr_covered" | "pending_route_quote" | "pending_current_location";
  payer_responsibility: "couranr" | "payer";
  payer_owes_cents: number | null;
  required_at: string;
  started_at: string | null;
  returned_at: string | null;
  version: number;
};

export async function requireReturn(p: {
  actor: RequestActor;
  deliveryId: string;
  expectedVersion: number;
  reason: ReturnReason;
  note?: string | null;
}): Promise<ReturnResult<ReturnView>> {
  const op = "requireReturn";
  const denied = requireOperations(p.actor, op);
  if (denied) return denied;
  return rpc(op, "couranr_require_return", {
    p_delivery_id: p.deliveryId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: (p.actor as Extract<RequestActor, { kind: "operations" }>).userId,
    p_reason: p.reason,
    p_note: p.note ?? null,
  });
}

export async function getReturnForDelivery(deliveryId: string): Promise<ReturnResult<ReturnView | null>> {
  const { data, error } = (await supabaseAdmin
    .from("couranr_delivery_returns")
    .select(
      "id,request_id,delivery_id,assignment_id,source_discrepancy_id,return_state,reason,source_fulfillment_state,return_destination_snapshot,pricing_status,payer_responsibility,payer_owes_cents,required_at,started_at,returned_at,version"
    )
    .eq("delivery_id", deliveryId)
    .maybeSingle()) as { data: ReturnView | null; error: any };
  if (error) {
    return fail({
      operation: "getReturnForDelivery",
      code: classifyDatabaseError(error),
      detail: { code: error?.code },
    });
  }
  return { ok: true, value: data };
}

export const INCIDENT_TYPES = [
  "recipient_unavailable",
  "address_access",
  "weather_safety",
  "damage",
  "wrong_item",
  "missing_item",
  "unsafe_handling",
  "delivery_failure",
  "other",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_STATES = [
  "reported",
  "under_review",
  "awaiting_evidence",
  "resolved",
  "closed",
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export type IncidentView = {
  id: string;
  request_id: string;
  delivery_id: string;
  return_id: string | null;
  source_discrepancy_id: string | null;
  incident_type: IncidentType;
  incident_state: IncidentState;
  severity: "normal" | "urgent";
  summary: string | null;
  opened_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  version: number;
};

export async function listIncidents(): Promise<ReturnResult<IncidentView[]>> {
  const { data, error } = (await supabaseAdmin
    .from("couranr_delivery_incidents")
    .select(
      "id,request_id,delivery_id,return_id,source_discrepancy_id,incident_type,incident_state,severity,summary,opened_at,resolved_at,closed_at,version"
    )
    .order("opened_at", { ascending: false })
    .limit(200)) as { data: IncidentView[] | null; error: any };
  if (error) {
    return fail({
      operation: "listIncidents",
      code: classifyDatabaseError(error),
      detail: { code: error?.code },
    });
  }
  return { ok: true, value: data ?? [] };
}

export async function openIncident(p: {
  actor: RequestActor;
  deliveryId: string;
  incidentType: IncidentType;
  severity: "normal" | "urgent";
  summary?: string | null;
}): Promise<ReturnResult<IncidentView>> {
  const op = "openIncident";
  const denied = requireOperations(p.actor, op);
  if (denied) return denied;
  return rpc(op, "couranr_open_delivery_incident", {
    p_delivery_id: p.deliveryId,
    p_actor_user_id: (p.actor as Extract<RequestActor, { kind: "operations" }>).userId,
    p_incident_type: p.incidentType,
    p_severity: p.severity,
    p_summary: p.summary ?? null,
  });
}

export type IncidentCommand =
  | "start_incident_review"
  | "request_incident_evidence"
  | "resolve_incident"
  | "close_incident";

export async function transitionIncident(p: {
  actor: RequestActor;
  incidentId: string;
  expectedVersion: number;
  command: IncidentCommand;
  note?: string | null;
}): Promise<ReturnResult<IncidentView>> {
  const op = "transitionIncident";
  const denied = requireOperations(p.actor, op);
  if (denied) return denied;
  return rpc(op, "couranr_transition_delivery_incident", {
    p_incident_id: p.incidentId,
    p_expected_version: p.expectedVersion,
    p_actor_user_id: (p.actor as Extract<RequestActor, { kind: "operations" }>).userId,
    p_command: p.command,
    p_note: p.note ?? null,
  });
}
