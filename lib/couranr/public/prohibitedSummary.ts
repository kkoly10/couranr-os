import { PROHIBITED_CLASSES, type ProhibitedClass } from "@/lib/couranr/shipment/facts";

/**
 * The PUBLIC, READABLE rendering of the prohibited-item vocabulary.
 *
 * MKT-ARCH §6 asks `/sameday` to state what Couranr will not carry and says it
 * in one sentence that decides the whole design of this file: "Do NOT create a
 * second policy list that can silently drift."
 *
 * So this module holds NO policy. It holds a PRESENTATION keyed by
 * `PROHIBITED_CLASSES` — the single vocabulary `lib/couranr/shipment/policy.ts`
 * and the `/send` funnel already enforce. Every entry here is looked up BY the
 * canonical id:
 *
 *   - `LABELS` maps each id to the words a customer reads. It is a translation
 *     of the vocabulary, not a second copy of it.
 *   - `GROUPS` maps readable group headings onto ids from that same vocabulary.
 *
 * `tests/couranr-prohibited-summary.test.ts` asserts the parity that makes the
 * drift impossible rather than unlikely: every canonical class has exactly one
 * label and appears in exactly one group, and neither structure names an id the
 * vocabulary does not have. Adding a 24th prohibited class turns that test red
 * instead of silently shipping a marketing page that omits it.
 *
 * The labels deliberately do NOT live in MKT-005. The copy-parity test forbids
 * typing a category name into locked marketing copy, precisely so this stays
 * the one place the words are derived from the enforced vocabulary.
 */

/** One customer-readable label per canonical class. Keyed, so it cannot drift. */
export const PROHIBITED_LABELS: Record<ProhibitedClass, string> = {
  alcohol: "Alcohol",
  tobacco: "Tobacco",
  vaping_nicotine: "Vaping and nicotine products",
  cannabis_thc: "Cannabis and THC products",
  firearms: "Firearms",
  ammunition: "Ammunition",
  prescription_medication: "Prescription medication",
  controlled_substances: "Controlled substances",
  fuel: "Fuel",
  compressed_gas: "Compressed gas",
  corrosive_hazmat: "Corrosive materials",
  toxic_hazmat: "Toxic materials",
  infectious_material: "Infectious material",
  regulated_dangerous_goods: "Other regulated dangerous goods",
  fireworks: "Fireworks",
  explosives: "Explosives",
  illegal_goods: "Illegal goods",
  stolen_goods: "Stolen goods",
  cash: "Cash",
  negotiable_instruments: "Checks and other negotiable instruments",
  biological_specimens: "Biological specimens",
  live_animals: "Live animals",
  people: "People",
};

export type ProhibitedGroup = {
  /** The heading a reader sees. */
  title: string;
  /** Members, as canonical ids — never as prose. */
  classes: readonly ProhibitedClass[];
};

/**
 * Six readable groups over the twenty-three classes.
 *
 * Grouping is presentation and nothing more: it changes how the same twenty-
 * three prohibitions are read, never which ones exist. A class in no group, or
 * in two, fails the parity test.
 */
export const PROHIBITED_GROUPS: readonly ProhibitedGroup[] = [
  {
    title: "Age-restricted and controlled",
    classes: [
      "alcohol",
      "tobacco",
      "vaping_nicotine",
      "cannabis_thc",
      "prescription_medication",
      "controlled_substances",
    ],
  },
  { title: "Weapons", classes: ["firearms", "ammunition"] },
  {
    title: "Hazardous and dangerous goods",
    classes: [
      "fuel",
      "compressed_gas",
      "corrosive_hazmat",
      "toxic_hazmat",
      "fireworks",
      "explosives",
      "regulated_dangerous_goods",
    ],
  },
  { title: "Money and negotiable value", classes: ["cash", "negotiable_instruments"] },
  {
    title: "Living things and biological material",
    classes: ["people", "live_animals", "biological_specimens", "infectious_material"],
  },
  { title: "Unlawful goods", classes: ["illegal_goods", "stolen_goods"] },
];

/** A group's members as the sentence a page renders. */
export function groupLabels(group: ProhibitedGroup): string[] {
  return group.classes.map((c) => PROHIBITED_LABELS[c]);
}

/** Every canonical class, in vocabulary order, as customer-readable words. */
export function allProhibitedLabels(): string[] {
  return PROHIBITED_CLASSES.map((c) => PROHIBITED_LABELS[c]);
}
