/**
 * The MANUAL structured path, made exactly as safe as the AI path.
 *
 * A delivery created without a Smart Intake session still has to pass the
 * deterministic shipment policy, and the policy needs facts. The structured
 * form IS a merchant statement — every field on it is a trusted, confirmed
 * fact — so this module turns the normalized draft into the same FactMap the
 * intake path builds, and the same evaluator runs over it. There is no
 * second policy, and no path on which "no AI signal" can read as "no safety
 * concern": the declaration comes from the form's required control, and a
 * missing one is `unknown`, which is review.
 */

import type { DeliveryRequestDraft } from "@/lib/couranr/requests/input";
import type { FactMap, ShipmentFact } from "./facts";

function stated(key: ShipmentFact["key"], value: unknown): ShipmentFact {
  return {
    key,
    value,
    confidence: null,
    source: "merchant_statement",
    sourceEvidence: null,
    requiresConfirmation: false,
    authority: "confirmed",
  };
}

export function factsFromDraft(
  draft: Pick<
    DeliveryRequestDraft,
    "weightLb" | "weightBand" | "restrictedClass" | "serviceLevel" | "timingIntent" | "requestedPickupLocal"
  >
): FactMap {
  const facts: FactMap = {
    restricted_class: stated("restricted_class", draft.restrictedClass),
    service_level: stated("service_level", draft.serviceLevel),
    timing_intent: stated("timing_intent", draft.timingIntent),
  };
  if (draft.weightLb !== null) facts.weight_lb_exact = stated("weight_lb_exact", draft.weightLb);
  else if (draft.weightBand !== null) facts.weight_band = stated("weight_band", draft.weightBand);
  if (draft.timingIntent === "scheduled" && draft.requestedPickupLocal) {
    facts.requested_pickup_local = stated("requested_pickup_local", draft.requestedPickupLocal);
  }
  return facts;
}
