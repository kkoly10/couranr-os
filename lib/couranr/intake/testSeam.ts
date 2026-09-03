/**
 * P5-001 — the ONLY sanctioned test boundary for Smart Intake.
 *
 * Two things live here and nowhere else: the deterministic FAKE provider,
 * and a process-wide registration slot that `resolveSmartIntakeProvider`
 * consults before it reads the environment. Both are fenced twice against a
 * production build:
 *
 *   1. `registerSmartIntakeTestProvider` THROWS when `NODE_ENV` is
 *      "production", so a test double cannot be installed there at all;
 *   2. `getRegisteredSmartIntakeTestProvider` answers null in production
 *      even if something was registered before the environment flipped, so
 *      a double installed earlier in a process cannot outlive the flip.
 *
 * `resolveSmartIntakeProvider` adds its own third check on the env object it
 * was handed. The positive controls for all three are in
 * `tests/couranr-intake-boundary.test.ts`.
 *
 * Application code must never import this module. It is server-only so a
 * bundle can never carry a mutable "which provider answers merchants" slot.
 */

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import type { IntakeProviderResult, SmartIntakeProvider } from "./provider";

assertServerOnly("lib/couranr/intake/testSeam.ts");

export const FAKE_INTAKE_MODEL = "fake-deterministic-v0";

let registered: SmartIntakeProvider | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Installs (or with null, removes) the provider every resolution will return. */
export function registerSmartIntakeTestProvider(provider: SmartIntakeProvider | null): void {
  if (isProduction()) {
    throw new Error("smart intake test seam is unavailable in production");
  }
  registered = provider;
}

/** The second fence: null in production regardless of what was registered. */
export function getRegisteredSmartIntakeTestProvider(): SmartIntakeProvider | null {
  if (isProduction()) return null;
  return registered;
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
    requestedModel: FAKE_INTAKE_MODEL,
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
        model: FAKE_INTAKE_MODEL,
        rawJson: JSON.stringify({ facts, overallConfidence: 80 }),
        usage: null,
      };
    },
  };
}
