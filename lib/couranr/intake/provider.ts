/**
 * P5-001 — the Smart Intake provider boundary.
 *
 * ---------------------------------------------------------------------------
 * NO VENDOR IS INVENTED HERE (§18)
 * ---------------------------------------------------------------------------
 *
 * The repository establishes no approved Couranr AI provider — no AI SDK is a
 * dependency and no deployment convention names one. So this module defines
 * the NEUTRAL seam and exactly two implementations:
 *
 *   - the deterministic FAKE provider, for tests and for the disposable
 *     harness, structurally unreachable in production (see
 *     `resolveSmartIntakeProvider`);
 *   - "no provider", which is a first-class production state: interpretation
 *     reports `unavailable` and the flow degrades to manual structured
 *     intake without blocking anything.
 *
 * When an owner approves a real provider, its adapter implements
 * `SmartIntakeProvider` behind `COURANR_SMART_INTAKE_PROVIDER` and nothing
 * above this seam changes.
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

assertServerOnly("lib/couranr/intake/provider.ts");

export const PROMPT_VERSION = "couranr-intake-prompt-v0-2026-09-02";
export const PROVIDER_TIMEOUT_MS = 10_000;

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

export type IntakeProviderResult =
  | { outcome: "success"; rawJson: string; model: string | null }
  | { outcome: "timeout" }
  | { outcome: "unavailable" }
  | { outcome: "malformed" };

export interface SmartIntakeProvider {
  readonly name: string;
  interpret(request: IntakeProviderRequest, signal: AbortSignal): Promise<IntakeProviderResult>;
}

/* ------------------------------------------------------- fake provider -- */

/**
 * Deterministic fake for tests. Either replays scripted outputs, or derives
 * a small honest proposal set from obvious phrases. It deliberately has no
 * intelligence: its job is to exercise the VALIDATION and PERSISTENCE
 * boundaries, which must hold even against a hostile or broken provider.
 */
export function createFakeSmartIntakeProvider(
  scripted?: IntakeProviderResult[]
): SmartIntakeProvider {
  const queue = scripted ? [...scripted] : null;
  return {
    name: "fake",
    async interpret(request) {
      if (queue) {
        const next = queue.shift();
        return next ?? { outcome: "unavailable" };
      }
      const text = request.shipmentDescription;
      const facts: Array<Record<string, unknown>> = [];
      const qty = /(\d{1,4})\s+(?:boxed?|boxes|packages?|pieces?|arrangements?)/i.exec(text);
      if (qty) {
        facts.push({
          key: "package_count",
          value: Number(qty[1]),
          confidence: 90,
          sourceEvidence: qty[0],
        });
      }
      const lb = /about\s+(\d{1,4})\s*lb/i.exec(text);
      if (lb) {
        facts.push({
          key: "weight_lb_exact",
          value: Number(lb[1]),
          confidence: 70,
          sourceEvidence: lb[0],
        });
      }
      return {
        outcome: "success",
        model: "fake-deterministic-v0",
        rawJson: JSON.stringify({ facts, overallConfidence: 80 }),
      };
    },
  };
}

/* ---------------------------------------------------------- resolution -- */

/**
 * The ONLY path to a live provider, and the §29-style positive control lives
 * on it: in a production build the fake is structurally unavailable, so no
 * configuration mistake can put a test double behind real merchants. With no
 * approved real provider configured this returns null and Smart Intake runs
 * in its honest degraded mode.
 */
export function resolveSmartIntakeProvider(
  env: NodeJS.ProcessEnv = process.env
): SmartIntakeProvider | null {
  const configured = (env.COURANR_SMART_INTAKE_PROVIDER ?? "").trim();
  if (configured === "") return null;
  if (configured === "fake") {
    if (env.NODE_ENV === "production") return null;
    return createFakeSmartIntakeProvider();
  }
  // An unrecognized provider name is a configuration error, not a reason to
  // guess a vendor. Unavailable — loudly visible in the run audit.
  return null;
}
