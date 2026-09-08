export const HELP_RESOLUTION_REASONS = [
  "customer_request",
  "recipient_unavailable",
  "address_or_access_problem",
  "weather_or_safety",
  "damage_or_condition",
  "other",
] as const;

export type HelpResolutionReason = (typeof HELP_RESOLUTION_REASONS)[number];

export const HELP_RESOLUTION_REASON_LABELS: Record<HelpResolutionReason, string> = {
  customer_request: "I need this delivery cancelled or returned",
  recipient_unavailable: "The recipient will not be available",
  address_or_access_problem: "There is an address or access problem",
  weather_or_safety: "Weather or safety makes the handoff unsafe",
  damage_or_condition: "There is a damage or condition concern",
  other: "Something else",
};

export type HelpResolutionRequestKind =
  | "cancellation_review"
  | "operations_review"
  | "return_review"
  | "none";

export type HelpResolutionPolicy =
  | {
      available: true;
      stage:
        | "before_arrival"
        | "at_pickup"
        | "in_custody"
        | "return_in_progress"
        | "returned"
        | "delivered"
        | "terminal";
      requestKind: HelpResolutionRequestKind;
      canSubmit: boolean;
      title: string;
      stageLabel: string;
      policySummary: string;
      submitLabel: string | null;
      policyReference: "CAN-001 + REF-003";
    }
  | { available: false };

export function isHelpResolutionReason(v: unknown): v is HelpResolutionReason {
  return (
    typeof v === "string" &&
    (HELP_RESOLUTION_REASONS as readonly string[]).includes(v)
  );
}
