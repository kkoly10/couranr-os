/**
 * P5-001 — the Smart Intake provider boundary.
 *
 * ---------------------------------------------------------------------------
 * ONE APPROVED VENDOR, GOVERNED HERE (§18)
 * ---------------------------------------------------------------------------
 *
 * The owner selected Anthropic as the Smart Intake provider, with
 * `claude-sonnet-5` as the production model. This module defines the
 * NEUTRAL seam and the resolution rule that decides which implementation —
 * if any — answers a merchant:
 *
 *   - the ANTHROPIC adapter (`anthropicProvider.ts`), reachable only through
 *     `COURANR_SMART_INTAKE_PROVIDER=anthropic` plus a non-empty
 *     `ANTHROPIC_API_KEY`, and only for a model in `GOVERNED_INTAKE_MODELS`;
 *   - the deterministic FAKE, which lives in `testSeam.ts` and is
 *     structurally unreachable in production;
 *   - "no provider", a first-class production state: interpretation reports
 *     `unavailable` and the flow degrades to manual structured intake.
 *
 * Neither the browser nor a request body can choose a provider or a model.
 * Resolution reads the server environment and nothing else, and an env typo
 * — an unknown provider name, a model outside the governed list — resolves
 * to NO provider with a one-line configuration warning, never to a guess.
 *
 * ---------------------------------------------------------------------------
 * WHAT A PROVIDER IS ALLOWED TO SEE (§17)
 * ---------------------------------------------------------------------------
 *
 * `IntakeProviderRequest` is the WHOLE contract — there is no field for
 * recipient contact details, addresses, payment data or auth material, so a
 * caller structurally cannot leak them. The request carries the shipment
 * description, the versioned business category, and already-confirmed
 * NON-PII shipment facts. Nothing else.
 */

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { createAnthropicSmartIntakeProvider } from "./anthropicProvider";
import {
  createFakeSmartIntakeProvider,
  getRegisteredSmartIntakeTestProvider,
} from "./testSeam";

assertServerOnly("lib/couranr/intake/provider.ts");

export const PROMPT_VERSION = "couranr-intake-prompt-v1-2026-09-02";
export const PROVIDER_TIMEOUT_MS = 10_000;

/**
 * The closed list of models Smart Intake may run on. A model is added here
 * by a decision, not by an environment variable: `COURANR_SMART_INTAKE_MODEL`
 * may pick from this list and nothing outside it.
 */
export const GOVERNED_INTAKE_MODELS = ["claude-sonnet-5"] as const;
export type GovernedIntakeModel = (typeof GOVERNED_INTAKE_MODELS)[number];
export const DEFAULT_INTAKE_MODEL: GovernedIntakeModel = "claude-sonnet-5";

export function isGovernedIntakeModel(v: unknown): v is GovernedIntakeModel {
  return typeof v === "string" && (GOVERNED_INTAKE_MODELS as readonly string[]).includes(v);
}

export type IntakeProviderRequest = {
  promptVersion: string;
  factSchemaVersion: string;
  /** The merchant's words — HOSTILE UNTRUSTED DATA, bounded upstream. */
  shipmentDescription: string;
  /** Versioned category key from the preset substrate, or null. */
  businessCategory: string | null;
  /**
   * Already-confirmed NON-PII shipment facts (weight band, fragility, …) so
   * the model does not re-ask what a trusted actor already answered.
   */
  confirmedFacts: Record<string, unknown>;
};

export type IntakeProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type IntakeProviderResult =
  | {
      outcome: "success";
      rawJson: string;
      /** The model the RESPONSE names — what actually answered. */
      model: string | null;
      usage: IntakeProviderUsage | null;
    }
  | { outcome: "timeout" }
  | { outcome: "unavailable" }
  | { outcome: "malformed" };

export interface SmartIntakeProvider {
  readonly name: string;
  /** The model this provider was CONFIGURED to request, for the run audit. */
  readonly requestedModel: string | null;
  interpret(request: IntakeProviderRequest, signal: AbortSignal): Promise<IntakeProviderResult>;
}

/* ---------------------------------------------------------- resolution -- */

function configWarning(reason: string): void {
  // One line, no values: the key must never be printed and a mistyped env
  // value could be anything, including the key pasted into the wrong slot.
  console.warn(`[smart-intake] configuration: ${reason}; Smart Intake is unavailable`);
}

/**
 * The ONLY path to a live provider, and the §29-style positive control lives
 * on it: in a production build the fake and the test seam are structurally
 * unavailable, so no configuration mistake can put a test double behind
 * real merchants. With nothing approved configured this returns null and
 * Smart Intake runs in its honest degraded mode.
 */
export function resolveSmartIntakeProvider(
  env: NodeJS.ProcessEnv = process.env
): SmartIntakeProvider | null {
  // The test seam is consulted first, and only outside production. The
  // getter carries its own production fence, so this is two checks, not one.
  if (env.NODE_ENV !== "production") {
    const seam = getRegisteredSmartIntakeTestProvider();
    if (seam) return seam;
  }

  const configured = (env.COURANR_SMART_INTAKE_PROVIDER ?? "").trim();
  if (configured === "") return null;

  if (configured === "anthropic") {
    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (apiKey === "") {
      configWarning("COURANR_SMART_INTAKE_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset");
      return null;
    }
    const requested = (env.COURANR_SMART_INTAKE_MODEL ?? "").trim();
    const model = requested === "" ? DEFAULT_INTAKE_MODEL : requested;
    if (!isGovernedIntakeModel(model)) {
      configWarning("COURANR_SMART_INTAKE_MODEL is not in GOVERNED_INTAKE_MODELS");
      return null;
    }
    return createAnthropicSmartIntakeProvider({ apiKey, model });
  }

  if (configured === "fake") {
    if (env.NODE_ENV === "production") return null;
    return createFakeSmartIntakeProvider();
  }

  // An unrecognized provider name is a configuration error, not a reason to
  // guess a vendor. Unavailable — loudly visible in the run audit.
  configWarning("COURANR_SMART_INTAKE_PROVIDER names no approved provider");
  return null;
}
