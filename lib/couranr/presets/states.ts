/**
 * ACP-025 — the preset states MER-010 and MER-011 must render.
 *
 * `UI_SCREEN_REGISTRY.md`:
 *   MER-010 required states: "Global recommendation; customized;
 *     merchant-created; update suggested; archived."
 *   MER-011 required states: "New; edited; version conflict; recommendation
 *     available."
 *
 * Every one is DERIVED from stored facts. None is a stored flag, and that is
 * the point: a flag can drift from the rows it describes, and "update
 * suggested" drifting means a merchant is either nagged about an update that
 * does not exist or never told about one that does.
 *
 * Pure, so the whole state machine is testable without a database.
 */

/** What a preset IS, on the MER-010 list. */
export const PRESET_STATES = [
  /** A Couranr global preset this merchant has not customized. */
  "couranr_global",
  /** Customized from a global one, and still level with it. */
  "customized",
  /** Customized from a global one that has since moved on. */
  "update_suggested",
  /** The merchant's own, from nothing. */
  "merchant_created",
  /** Archived. Kept, because deliveries still cite it. */
  "archived",
] as const;
export type PresetState = (typeof PRESET_STATES)[number];

export const PRESET_STATE_LABELS: Readonly<Record<PresetState, string>> = {
  couranr_global: "Couranr suggestion",
  customized: "Yours, from a Couranr suggestion",
  update_suggested: "Couranr has an update",
  merchant_created: "Yours",
  archived: "Archived",
};

export const PRESET_STATE_TONE: Readonly<
  Record<PresetState, "neutral" | "info" | "success" | "warning">
> = {
  couranr_global: "info",
  customized: "success",
  update_suggested: "warning",
  merchant_created: "success",
  archived: "neutral",
};

/**
 * What each state means, in a sentence a merchant can act on.
 *
 * `update_suggested` is the one that matters: it must say plainly that nothing
 * changed on its own, because the entire no-overwrite rule is invisible to a
 * merchant unless someone tells them it held.
 */
export const PRESET_STATE_DESCRIPTIONS: Readonly<Record<PresetState, string>> = {
  couranr_global:
    "Couranr suggests this for your kind of business. Use it as it is, or make it yours and change anything.",
  customized: "You changed this from a Couranr suggestion. It is yours now.",
  update_suggested:
    "Couranr has changed its suggestion since you customized this. Nothing of yours was changed — look at the update and take it only if you want it.",
  merchant_created: "You created this one.",
  archived:
    "Archived, so it is not offered when you create a delivery. Deliveries that used it are unaffected.",
};

export type PresetFacts = {
  archivedAt?: string | null;
  /** Set when this preset was customized from a Couranr global one. */
  sourcePresetId?: string | null;
  /** The global version it was customized FROM. */
  sourceVersion?: number | null;
  /** The global preset's CURRENT version, when it is known. */
  currentSourceVersion?: number | null;
  /** True for a Couranr global preset being listed as a suggestion. */
  isGlobal?: boolean;
};

/**
 * The state of one preset.
 *
 * Order matters and is deliberate:
 *
 *  1. ARCHIVED wins over everything. An archived preset is not a live thing
 *     with an available update; telling a merchant to review an update to
 *     something they retired is noise.
 *  2. A GLOBAL preset is a suggestion, whatever else is true of it.
 *  3. `update_suggested` only when the source version is KNOWN to have moved.
 *     An unknown current version is NOT an update — a failed lookup must not
 *     manufacture a nag.
 */
export function presetState(facts: PresetFacts): PresetState {
  if (facts.archivedAt) return "archived";
  if (facts.isGlobal) return "couranr_global";
  if (!facts.sourcePresetId) return "merchant_created";

  const from = facts.sourceVersion;
  const now = facts.currentSourceVersion;
  if (typeof from === "number" && typeof now === "number" && now > from) {
    return "update_suggested";
  }
  return "customized";
}

/** Is Couranr suggesting an update to this one? */
export function hasSuggestedUpdate(facts: PresetFacts): boolean {
  return presetState(facts) === "update_suggested";
}

/* ------------------------------------------------------------------ MER-011 */

/** The builder's states. */
export const BUILDER_STATES = [
  /** Nothing saved yet. */
  "new",
  /** Differs from what is stored. */
  "edited",
  /** Someone else saved while this was open. */
  "version_conflict",
  /** A Couranr update exists for the preset being edited. */
  "recommendation_available",
] as const;
export type BuilderState = (typeof BUILDER_STATES)[number];

export type BuilderFacts = {
  /** Null until the preset exists. */
  storedVersion: number | null;
  /** The version the form was loaded from. */
  loadedVersion: number | null;
  dirty: boolean;
  recommendationAvailable: boolean;
};

/**
 * The builder's state.
 *
 * VERSION CONFLICT OUTRANKS EVERYTHING except being new. A merchant editing a
 * preset someone else has already saved must be told before anything else —
 * their next save would otherwise overwrite a colleague's work with a body
 * built from a version that no longer exists.
 *
 * `recommendation_available` outranks `edited` because it is information the
 * merchant may want BEFORE they finish editing; a nag after they save is a nag
 * about work they have already redone.
 */
export function builderState(facts: BuilderFacts): BuilderState | null {
  if (facts.storedVersion === null) return "new";
  if (
    typeof facts.loadedVersion === "number" &&
    facts.storedVersion > facts.loadedVersion
  ) {
    return "version_conflict";
  }
  if (facts.recommendationAvailable) return "recommendation_available";
  if (facts.dirty) return "edited";

  /*
   * NULL, not "edited".
   *
   * A saved, current, unchanged form is none of the registry's four states,
   * and the first draft of this function returned "edited" for it with a
   * comment admitting that was wrong. A state machine that reports the
   * nearest state rather than no state is how a screen ends up showing
   * "unsaved changes" to someone who has changed nothing — and once that
   * happens the badge means nothing on the occasions it is true.
   */
  return null;
}

/** True when the builder must refuse to save until the merchant reloads. */
export function saveIsBlocked(facts: BuilderFacts): boolean {
  return builderState(facts) === "version_conflict";
}
