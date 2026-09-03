/**
 * P5-001 — reconciling the STRUCTURED form with the intake fact record.
 *
 * The merchant has two ways to state a commercial fact: the Smart Intake
 * conversation and the structured fields below it. The form is always the
 * LATER statement (it is what they press Calculate with), so on every
 * calculate the fact record is brought into agreement with it before policy
 * runs and before the commit command re-validates the arguments against the
 * trusted facts. Without this step the primary flow dead-ends: intake
 * confirms "12 lb exact", the merchant flips the select to "More than 25 lb, up to 50 lb", and
 * the commit refuses the band as contradicting the exact.
 *
 * Pure planning here; the writes happen in commands.ts. Rules:
 *
 *   - EITHER an exact weight OR a band is stated, never both (§9). Stating
 *     one withdraws the other.
 *   - A trusted fact that already equals the form value is left alone — no
 *     revision bump, no audit noise.
 *   - A trusted fact the form contradicts is OVERRIDDEN (the audit trail says
 *     so); a proposal or unknown is CONFIRMED.
 *   - Only the six commercial/safety keys the commit check compares are touched.
 *     Everything else the conversation produced stands as it is.
 */

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import type { TimingIntent } from "@/lib/couranr/timing/policy";
import {
  isTrustedAuthority,
  validateFactValue,
  type FactAuthority,
  type FactKey,
  type RestrictedClassDeclaration,
  type WeightBand,
} from "@/lib/couranr/shipment/facts";

assertServerOnly("lib/couranr/intake/sync.ts");

/** The commercial facts the structured form states. */
export type IntakeFormStatement = {
  weightLb: number | null;
  weightBand: WeightBand | null;
  /** The shipment-safety declaration — always stated by the form. */
  restrictedClass: RestrictedClassDeclaration;
  serviceLevel: string;
  timingIntent: TimingIntent;
  requestedPickupLocal: string | null;
};

/** The subset of a stored fact row the plan needs. */
export type ExistingFact = {
  fact_key: string;
  value: unknown;
  authority: FactAuthority | string;
};

export type FactSyncStep =
  | { op: "confirm"; factKey: FactKey; value: unknown; authority: "confirmed" | "overridden" }
  | { op: "retract"; factKey: FactKey };

/** The six keys the commit commands compare against the trusted facts. */
export const SYNCED_FACT_KEYS = [
  "weight_lb_exact",
  "weight_band",
  "restricted_class",
  "service_level",
  "timing_intent",
  "requested_pickup_local",
] as const satisfies readonly FactKey[];

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function planIntakeFactSync(
  existing: ExistingFact[],
  statement: IntakeFormStatement
): FactSyncStep[] {
  const byKey = new Map(existing.map((f) => [f.fact_key, f]));
  const steps: FactSyncStep[] = [];

  const state = (key: FactKey, value: unknown) => {
    const row = byKey.get(key);
    if (row && isTrustedAuthority(row.authority as FactAuthority) && sameValue(row.value, value)) {
      return;
    }
    // A value the schema refuses never reaches the database from here; the
    // commit check will then surface the disagreement loudly (CR409) rather
    // than this layer writing something malformed to make it pass.
    if (!validateFactValue(key, value)) return;
    const authority =
      row && isTrustedAuthority(row.authority as FactAuthority) ? "overridden" : "confirmed";
    steps.push({ op: "confirm", factKey: key, value, authority });
  };
  const withdraw = (key: FactKey) => {
    const row = byKey.get(key);
    if (!row || row.authority === "unknown") return;
    steps.push({ op: "retract", factKey: key });
  };

  if (statement.weightLb !== null) {
    state("weight_lb_exact", statement.weightLb);
    withdraw("weight_band");
  } else if (statement.weightBand !== null) {
    state("weight_band", statement.weightBand);
    withdraw("weight_lb_exact");
  }

  state("restricted_class", statement.restrictedClass);
  state("service_level", statement.serviceLevel);
  state("timing_intent", statement.timingIntent);
  if (statement.timingIntent === "scheduled" && statement.requestedPickupLocal !== null) {
    state("requested_pickup_local", statement.requestedPickupLocal);
  } else {
    withdraw("requested_pickup_local");
  }

  return steps;
}
