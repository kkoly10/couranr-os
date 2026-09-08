import {
  lifecycleStage,
  type LifecycleInput,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";

export const OPERATIONS_WORKBENCH_PHASES = [
  "review",
  "commercial",
  "plan",
  "dispatch",
  "execute",
  "complete",
] as const;

export type OperationsWorkbenchPhase = (typeof OPERATIONS_WORKBENCH_PHASES)[number];

export const OPERATIONS_WORKBENCH_LABELS: Readonly<
  Record<OperationsWorkbenchPhase, string>
> = {
  review: "Review",
  commercial: "Commercial",
  plan: "Plan",
  dispatch: "Dispatch",
  execute: "Execute",
  complete: "Complete",
};

const TERMINAL_FULFILLMENT = new Set(["delivered", "could_not_deliver", "cancelled"]);

export type OperationsWorkbenchInput = LifecycleInput & {
  fulfillmentState?: string | null;
};

export type OperationsWorkbenchState = {
  phase: OperationsWorkbenchPhase;
  lifecycleStage: LifecycleStage;
};

/**
 * One Operations case, one current phase.
 *
 * The queue and the workbench both start from the canonical lifecycle
 * derivation. This helper only groups those server-backed stages into the six
 * jobs an operator actually understands. It never invents or stores a second
 * lifecycle state.
 */
export function operationsWorkbenchState(
  input: OperationsWorkbenchInput
): OperationsWorkbenchState {
  const stage = lifecycleStage(input);

  if (
    input.canonicalDeliveryExists &&
    input.fulfillmentState &&
    TERMINAL_FULFILLMENT.has(input.fulfillmentState)
  ) {
    return { phase: "complete", lifecycleStage: stage };
  }

  switch (stage) {
    case "pending_review":
      return { phase: "review", lifecycleStage: stage };

    case "proof_sync_attention":
      return { phase: "execute", lifecycleStage: stage };

    case "automation_exception":
      switch (input.automationExceptionStage) {
        case "review":
          return { phase: "review", lifecycleStage: stage };
        case "commercial":
          return { phase: "commercial", lifecycleStage: stage };
        case "dispatch":
          return { phase: "dispatch", lifecycleStage: stage };
        case "planning":
        default:
          return { phase: "plan", lifecycleStage: stage };
      }

    case "awaiting_payment_authorization":
    case "payment_reauthorization_required":
    case "capture_pending":
      return { phase: "commercial", lifecycleStage: stage };

    case "merchant_preparing":
    case "ready_for_planning":
    case "service_plan_confirmed":
    case "captured_not_scheduled":
      return { phase: "plan", lifecycleStage: stage };

    case "automatic_scheduled":
    case "captured_scheduled":
      return { phase: "dispatch", lifecycleStage: stage };

    case "driver_assigned":
      return { phase: "execute", lifecycleStage: stage };

    case "not_actionable":
    default:
      return { phase: "complete", lifecycleStage: stage };
  }
}
