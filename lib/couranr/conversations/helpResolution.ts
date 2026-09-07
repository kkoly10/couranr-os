import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  type HelpFailure,
  type HelpResult,
} from "./help";
import type { CustomerTopic } from "./states";
import {
  HELP_RESOLUTION_REASON_LABELS,
  isHelpResolutionReason,
  type HelpResolutionPolicy,
  type HelpResolutionReason,
} from "./helpResolutionTypes";

assertServerOnly("lib/couranr/conversations/helpResolution.ts");

const NOTE_MAX = 1200;

function fail(params: {
  code: PublicErrorCode;
  operation: string;
  detail?: unknown;
  message?: string;
}): HelpFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: HelpFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

/**
 * CUS-002 policy projection.
 *
 * IMPORTANT REACHABILITY FACT: a Delivery Help token is keyed to a canonical
 * delivery, and a canonical delivery is created only after payment capture.
 * Therefore pre-authorization and pre-confirmation CAN-001 stages cannot occur
 * on this route. This mapper covers the states that a real /help/[token] can
 * actually reach and refuses to pretend otherwise.
 */
export function resolutionPolicyForFulfillmentState(
  state: unknown
): HelpResolutionPolicy | null {
  if (
    state === "not_scheduled" ||
    state === "scheduled" ||
    state === "assigned" ||
    state === "en_route_to_pickup"
  ) {
    return {
      available: true,
      stage: "before_arrival",
      requestKind: "cancellation_review",
      canSubmit: true,
      title: "Request cancellation review",
      stageLabel: "Before driver arrival",
      policySummary:
        "For a customer-request cancellation after Couranr confirmation and before driver arrival, CAN-001 retains $8 from the delivery-service charge. A Couranr-caused cancellation is $0. Weather before pickup is handled separately: if Couranr pauses or cancels for weather, the authorization is released or the delivery-service charge is refunded with no cancellation fee. Operations applies the rule that matches the verified reason. This does not mean you personally owe $8; this link does not expose payer identity.",
      submitLabel: "Send cancellation request",
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (state === "at_pickup") {
    return {
      available: true,
      stage: "at_pickup",
      requestKind: "operations_review",
      canSubmit: true,
      title: "Request Operations review",
      stageLabel: "Driver has arrived at pickup",
      policySummary:
        "Couranr does not claim an automatic customer-cancellation amount at this stage. The $15 failed-pickup retention applies only when pickup cannot occur because the package or merchant is unavailable, plus any approved waiting. Operations must review the evidence before deciding the outcome.",
      submitLabel: "Send review request",
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (state === "picked_up" || state === "in_transit" || state === "at_dropoff") {
    return {
      available: true,
      stage: "in_custody",
      requestKind: "return_review",
      canSubmit: true,
      title: "Request return review",
      stageLabel: "Shipment is in Couranr custody",
      policySummary:
        "The original delivery remains charged. A physical return is a new Pricing V2 route from the failed or current location to the return destination. Couranr does not show a return amount until that route is governed and quoted. If Couranr caused the corrective return, the payer owes $0 for that return.",
      submitLabel: "Send return request",
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (state === "return_required" || state === "returning") {
    return {
      available: true,
      stage: "return_in_progress",
      requestKind: "none",
      canSubmit: false,
      title: "Return already in progress",
      stageLabel: state === "return_required" ? "Return required" : "Returning to sender",
      policySummary:
        "Couranr has already opened the governed return path. Sending another return request would not change custody or pricing. Use the message form below if you need to add information.",
      submitLabel: null,
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (state === "returned") {
    return {
      available: true,
      stage: "returned",
      requestKind: "none",
      canSubmit: false,
      title: "Return completed",
      stageLabel: "Returned to sender",
      policySummary:
        "Couranr has recorded the physical return as complete. Use the return and delivery-refund status on this page for the delivery-service outcome.",
      submitLabel: null,
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (state === "delivered") {
    return {
      available: true,
      stage: "delivered",
      requestKind: "none",
      canSubmit: false,
      title: "Delivery already completed",
      stageLabel: "Delivered",
      policySummary:
        "A completed delivery is not cancelled through this form. Product returns, product refunds and replacements are the selling business's responsibility. Use the delivery-problem or message form below for a Couranr delivery-service issue.",
      submitLabel: null,
      policyReference: "CAN-001 + REF-003",
    };
  }

  if (
    state === "cancelled" ||
    state === "could_not_deliver" ||
    state === "attempt_failed"
  ) {
    return {
      available: true,
      stage: "terminal",
      requestKind: "none",
      canSubmit: false,
      title: "Delivery is already closed",
      stageLabel: state === "cancelled" ? "Cancelled" : "Could not deliver",
      policySummary:
        "This delivery is already in a terminal state. Use the message form below if the recorded outcome needs Couranr review.",
      submitLabel: null,
      policyReference: "CAN-001 + REF-003",
    };
  }

  return null;
}

type OpenHelpResolutionPolicy = Extract<HelpResolutionPolicy, { available: true }>;

type HelpResolutionSnapshot = {
  fulfillmentState: string;
  policy: OpenHelpResolutionPolicy;
};

async function readHelpResolutionSnapshot(
  deliveryId: string
): Promise<HelpResolutionSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from("couranr_deliveries")
    .select("fulfillment_state")
    .eq("id", deliveryId)
    .maybeSingle();

  if (error || !data) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: "help.resolution.read",
      code: "internal",
      detail: error ?? { reason: "delivery_missing" },
    });
    return null;
  }

  const policy = resolutionPolicyForFulfillmentState(data.fulfillment_state);
  if (!policy?.available) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: "help.resolution.vocabulary",
      code: "internal",
      detail: { fulfillmentState: data.fulfillment_state },
    });
    return null;
  }

  return {
    fulfillmentState: String(data.fulfillment_state),
    policy,
  };
}

export async function readHelpResolutionPolicy(
  deliveryId: string
): Promise<HelpResolutionPolicy> {
  const snapshot = await readHelpResolutionSnapshot(deliveryId);
  return snapshot?.policy ?? { available: false };
}

function topicForReason(reason: HelpResolutionReason): CustomerTopic {
  if (reason === "recipient_unavailable") return "availability";
  if (reason === "address_or_access_problem") return "address_concern";
  if (reason === "weather_or_safety" || reason === "damage_or_condition") {
    return "delivery_problem";
  }
  return "other";
}

/**
 * Submit a REVIEW REQUEST, not a cancellation/return command.
 *
 * The server re-reads the current fulfillment state at submission time and
 * derives request kind, stage and policy copy itself. The browser supplies only
 * a reason, optional note and idempotency key. The one durable effect is the
 * existing Delivery Help message write; no fulfillment, payment, pricing,
 * refund, return or custody command is imported here.
 */
export async function submitHelpResolutionRequest(params: {
  tokenId: string;
  deliveryId: string;
  reason: unknown;
  note: unknown;
  idempotencyKey: string;
}): Promise<
  HelpResult<{
    messageId: string;
    requestKind: Exclude<HelpResolutionPolicy, { available: false }>["requestKind"];
  }>
> {
  if (!isHelpResolutionReason(params.reason)) {
    return fail({
      code: "invalid_input",
      operation: "help.resolution.reason",
      message: "Choose why you need Couranr to review this delivery.",
    });
  }

  const note = typeof params.note === "string" ? params.note.trim() : "";
  if (note.length > NOTE_MAX) {
    return fail({
      code: "invalid_input",
      operation: "help.resolution.note",
      message: "Keep the additional details under 1200 characters.",
    });
  }

  const snapshot = await readHelpResolutionSnapshot(params.deliveryId);
  if (!snapshot) {
    return fail({
      code: "internal",
      operation: "help.resolution.policy_unavailable",
      detail: { deliveryId: params.deliveryId },
      message: "Couranr could not load the current cancellation or return policy.",
    });
  }

  const { policy, fulfillmentState } = snapshot;
  if (!policy.canSubmit || policy.requestKind === "none") {
    return fail({
      code: "conflict",
      operation: "help.resolution.not_open",
      detail: { stage: policy.stage },
      message:
        "A new cancellation or return request is not available at this stage. Use Delivery Help if the recorded outcome needs review.",
    });
  }

  const reasonLabel = HELP_RESOLUTION_REASON_LABELS[params.reason];
  const body = [
    policy.title,
    `Reason: ${reasonLabel}`,
    `Stage when submitted: ${policy.stageLabel}`,
    `Delivery-service policy shown: ${policy.policySummary}`,
    note ? `Details: ${note}` : null,
    "This request does not change the delivery on its own. Couranr Operations must review it before any custody, return, refund, price or fee decision changes.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data, error } = await supabaseAdmin.rpc(
    "couranr_help_post_resolution_request",
    {
      p_token_id: params.tokenId,
      p_delivery_id: params.deliveryId,
      p_expected_fulfillment_state: fulfillmentState,
      p_request_kind: policy.requestKind,
      p_body: body,
      p_topic: topicForReason(params.reason),
      p_idempotency_key: params.idempotencyKey,
    }
  );

  if (error) {
    const code = classifyDatabaseError(error);
    return fail({
      code,
      operation: "help.resolution.submit_atomic",
      detail: error,
      message:
        code === "version_conflict"
          ? "This delivery changed while the request was being sent. Refresh Delivery Help and review the current option."
          : undefined,
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const requestKind = row?.out_request_kind;
  if (
    !row?.out_message_id ||
    (requestKind !== "cancellation_review" &&
      requestKind !== "operations_review" &&
      requestKind !== "return_review")
  ) {
    return fail({
      code: "internal",
      operation: "help.resolution.submit_atomic_shape",
      detail: { hasRow: Boolean(row) },
    });
  }

  return {
    ok: true,
    value: {
      messageId: String(row.out_message_id),
      requestKind,
    },
  };
}
