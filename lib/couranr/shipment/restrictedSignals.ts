/**
 * P5-001 — restricted-item SIGNAL scanner over a merchant's raw description.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A SIGNAL, NOT A CLASSIFIER
 * ---------------------------------------------------------------------------
 *
 * `scanRestrictedSignals` reads the merchant's prose and reports which
 * PROHIBITED_CLASSES the wording RESEMBLES. That is all it knows. Under §11 of
 * the batch authority a signal may ESCALATE — raise a risk signal, force
 * `needs_review`, prompt the one restricted-class clarification — and may
 * NEVER prohibit: hard `prohibited` needs a trusted actor's confirmation and
 * comes from `evaluateShipmentPolicy` over the structured fact set, which
 * remains the authority. Nothing here mutates anything; the caller decides
 * what to do with the scan.
 *
 * Determinism: pure function of the input text and the versioned lexicon.
 * No I/O, no model. Same text + same `RESTRICTED_SIGNAL_LEXICON_VERSION` →
 * byte-identical output, so a stored scan can be replayed for audit.
 *
 * ---------------------------------------------------------------------------
 * HOW IT WORKS (deliberately simple and readable)
 * ---------------------------------------------------------------------------
 *
 *   1. NORMALIZE. Lower-case, NFKD-decompose and strip combining marks
 *      (so "tequíla" reads as "tequila"), fold curly quotes, collapse
 *      whitespace, and cut to MAX_RAW_DESCRIPTION_LENGTH (4000) chars — the
 *      same bound the fact store enforces — so work is bounded regardless of
 *      what a caller passes.
 *   2. EXCLUDE. Every entry in `RESTRICTED_SIGNAL_EXCLUSIONS` is a compound
 *      or negated phrase whose surface word looks restricted but whose meaning
 *      is not ("alcohol-free", "toy gun", "glue gun", "battery-powered",
 *      "wine glasses", "gun safe", "root beer"). Each match is blanked to
 *      spaces BEFORE any class pattern runs, so a class pattern can never see
 *      the excluded words. Exclusion is the only negation handling there is:
 *      "not alcohol" and "no fireworks" still signal, on purpose — a signal
 *      that a human dismisses in one glance is cheaper than one that is
 *      silently swallowed by clever parsing.
 *   3. MATCH. Every `RESTRICTED_SIGNAL_LEXICON` entry is a word-boundary-aware
 *      regular expression tagged with one closed `ProhibitedClass` id and a
 *      strength: `strong` means the phrase names the restricted thing itself
 *      ("case of wine", "9mm rounds"); `weak` means the word is suggestive
 *      but commonly innocent ("rounds", "gun", "spirits", "rx"). Patterns are
 *      plain alternations with bounded quantifiers only — no nested repeats —
 *      so matching stays linear in the input.
 *   4. REPORT. Signals are deduplicated per (class, matchedText), ordered
 *      strong-first then by class order then by position, and `material` is
 *      true when at least one strong signal exists. A weak-only scan is a
 *      hint for a clarification prompt, never grounds for review on its own —
 *      that judgement belongs to the caller.
 *
 * Adding or changing a phrase is a lexicon version bump: every stored scan
 * names the version that produced it.
 */

import {
  MAX_RAW_DESCRIPTION_LENGTH,
  PROHIBITED_CLASSES,
  type ProhibitedClass,
} from "./facts";

export const RESTRICTED_SIGNAL_LEXICON_VERSION = "couranr-restricted-lexicon-v0-2026-09-02";

export type SignalStrength = "strong" | "weak";

export type RestrictedSignal = {
  prohibitedClass: ProhibitedClass;
  /** The normalized span of merchant text that fired, for a human to read. */
  matchedText: string;
  strength: SignalStrength;
};

export type RestrictedSignalScan = {
  signals: RestrictedSignal[];
  /** True when at least one `strong` signal exists. */
  material: boolean;
};

export type LexiconEntry = {
  prohibitedClass: ProhibitedClass;
  /** Stored WITHOUT the `g` flag; the scanner compiles its own global copy. */
  pattern: RegExp;
  strength: SignalStrength;
  /** Human label for audit output. */
  label: string;
};

export type ExclusionEntry = {
  pattern: RegExp;
  label: string;
};

/* --------------------------------------------------------------- exclusions */

/**
 * Compound / negated phrases blanked BEFORE class matching. Keep each one
 * narrow: an exclusion that is too broad hides a real restricted item, and
 * that is the one direction this module must never err in.
 */
export const RESTRICTED_SIGNAL_EXCLUSIONS: readonly ExclusionEntry[] = [
  // "-free" / "-powered" / "-operated" compounds: alcohol-free, nicotine-free,
  // smoke-free, battery-powered, battery-operated, gas-powered …
  { label: "hyphenated -free/-powered/-operated compound", pattern: /\b[a-z0-9]+-(free|powered|operated)\b/ },
  { label: "spaced 'X free' compound", pattern: /\b(alcohol|nicotine|tobacco|smoke|thc|lead)\s+free\b/ },
  { label: "battery powered/operated (installed battery)", pattern: /\b(battery|batteries|solar|usb|hand)\s+(powered|operated)\b/ },
  // Guns that are tools or toys.
  { label: "toy weapon", pattern: /\btoy\s+(gun|guns|pistol|pistols|rifle|rifles|handgun|handguns|shotgun|shotguns|weapon|weapons|firearm|firearms|grenade|grenades|ammo|bullets?)\b/ },
  { label: "tool 'gun'", pattern: /\b(glue|hot[\s-]glue|caulk|caulking|nail|heat|staple|spray|paint|grease|rivet|tack|soldering|brad|air|radar|speed|massage|tattoo|label|price|tagging|water|squirt|bubble|foam|dart|cap|laser|bb|airsoft|paintball|pellet|spud|potato)\s+guns?\b/ },
  { label: "nerf", pattern: /\bnerf(\s+(gun|guns|blaster|blasters|dart|darts|rifle|pistol|ammo))?\b/ },
  { label: "gunmetal (a colour)", pattern: /\bgun[\s-]?metal\b/ },
  // Weapon ACCESSORIES that contain no weapon: gun safe, rifle scope, pistol
  // grip (a drill feature), holster, cleaning kit.
  { label: "weapon accessory", pattern: /\b(gun|guns|rifle|pistol|handgun|shotgun|firearm)\s+(safe|safes|cabinet|cabinets|scope|scopes|grip|grips|sling|slings|lock|locks|rack|racks|holster|holsters|cleaning|oil|case|cases)\b/ },
  // Barware and drink hardware.
  { label: "barware / glassware", pattern: /\b(wine|beer|champagne|whiskey|whisky|cocktail|shot|liquor|bar)\s+(glass|glasses|glassware|rack|racks|opener|openers|key|keys|stopper|stoppers|aerator|aerators|decanter|decanters|mug|mugs|stein|steins|tap|taps|cabinet|cabinets|tumbler|tumblers|flute|flutes|fridge|fridges|label|labels|cork|corks|tote|totes)\b/ },
  { label: "non-alcoholic 'beer'/'ale'", pattern: /\b(root|ginger)\s+(beer|ale)\b/ },
  { label: "non-alcoholic wine terms", pattern: /\bwine\s+(vinegar|gum|gums|coloured|colored|colou?r)\b/ },
  // Smoking accessories that contain no tobacco.
  { label: "smoking accessory", pattern: /\bcigar(ette)?\s+(lighter|lighters|case|cases|holder|holders|ashtray|ashtrays)\b/ },
  // Fuel-system parts and propane fittings, not fuel or gas.
  { label: "fuel-system part", pattern: /\bfuel\s+(pump|pumps|filter|filters|line|lines|injector|injectors|gauge|gauges|cap|caps)\b/ },
  { label: "propane fitting", pattern: /\bpropane\s+(grill|grills|regulator|regulators|hose|hoses|adapter|adapters|fitting|fittings)\b/ },
  // Pet supplies, not pets.
  { label: "pet supplies", pattern: /\b(dog|cat|puppy|kitten|pet|bird|fish|hamster|rabbit|reptile)\s+(food|foods|treat|treats|toy|toys|bed|beds|leash|leashes|collar|collars|litter|bowl|bowls|pad|pads|supplies|shampoo|tank|tanks|brush|brushes|costume|costumes)\b/ },
  // Cash HARDWARE and payment phrasing, not currency.
  { label: "cash hardware / phrasing", pattern: /\bcash\s+(register|registers|drawer|drawers|box|boxes|on\s+delivery|app|back)\b/ },
];

/* ------------------------------------------------------------------ lexicon */

const strong = (prohibitedClass: ProhibitedClass, label: string, pattern: RegExp): LexiconEntry => ({
  prohibitedClass,
  label,
  pattern,
  strength: "strong",
});
const weak = (prohibitedClass: ProhibitedClass, label: string, pattern: RegExp): LexiconEntry => ({
  prohibitedClass,
  label,
  pattern,
  strength: "weak",
});

/**
 * Curated phrase table. Grouped by closed class id; every id is a member of
 * `PROHIBITED_CLASSES` (asserted at module load and by test). Short on
 * purpose: this is a first-pass tripwire, not a taxonomy.
 */
export const RESTRICTED_SIGNAL_LEXICON: readonly LexiconEntry[] = [
  /* ---- alcohol -------------------------------------------------------- */
  strong("alcohol", "beverage alcohol nouns", /\b(beer|beers|wine|wines|liquor|liquors|vodka|whiskey|whisky|bourbon|tequila|champagne|prosecco|rum|brandy|cognac|scotch|mezcal|sake|lager|lagers|pilsner|ipa|ipas|keg|kegs|moonshine)\b/),
  strong("alcohol", "quantity of alcohol", /\b(bottles?|cases?|cans?|six[\s-]?packs?|6[\s-]?packs?|kegs?|cartons?)\s+of\s+(beer|wine|liquor|vodka|whiskey|whisky|bourbon|tequila|champagne|rum|gin|spirits|booze)\b/),
  strong("alcohol", "alcoholic beverages", /\b(alcoholic\s+(beverages?|drinks?)|hard\s+(seltzer|seltzers|cider|ciders|liquor|lemonade)|booze)\b/),
  weak("alcohol", "bare 'alcohol' (also rubbing/isopropyl)", /\balcohol\b/),
  weak("alcohol", "ambiguous drink words", /\b(gin|ale|ales|cider|ciders|spirits|cocktails?|liqueur|liqueurs)\b/),

  /* ---- tobacco -------------------------------------------------------- */
  strong("tobacco", "tobacco products", /\b(cigarettes?|cigars?|cigarillos?|tobacco|chewing\s+tobacco|dip(ping)?\s+tobacco|(cans?|tins?)\s+of\s+dip|snus|shisha)\b/),
  strong("tobacco", "carton of cigarettes", /\b(cartons?|packs?|cases?)\s+of\s+(cigarettes|cigs|smokes)\b/),
  weak("tobacco", "smoking-adjacent (bare 'dip' is usually food)", /\b(cigs|smokes|hookah|hookahs|snuff|rolling\s+papers|dip)\b/),

  /* ---- vaping_nicotine ------------------------------------------------ */
  strong("vaping_nicotine", "vape products", /\b(vape\s+(pen|pens|juice|pods?|cartridges?)|vape|vapes|vaping|e[\s-]?cigarettes?|e[\s-]?cigs?|e[\s-]?liquids?|e[\s-]?juice|nicotine\s+pouches|nicotine)\b/),
  weak("vaping_nicotine", "vaporizer (also humidifiers)", /\bvapori[sz]ers?\b/),

  /* ---- cannabis_thc --------------------------------------------------- */
  strong("cannabis_thc", "cannabis products", /\b(cannabis|marijuana|marihuana|thc\s+(gummies|edibles|vapes?|carts?)|thc|pre[\s-]?rolls?|hashish|hash\s+oil)\b/),
  weak("cannabis_thc", "'weed' unless a garden tool", /\bweed\b(?!\s+(killer|killers|whacker|whackers|eater|eaters|trimmer|trimmers|barrier|control|puller|pullers))/),
  weak("cannabis_thc", "cannabis-adjacent", /\b(edibles|cbd|dispensary|hemp)\b/),

  /* ---- firearms ------------------------------------------------------- */
  strong("firearms", "firearm nouns", /\b(firearms?|handguns?|pistols?|rifles?|shotguns?|revolvers?|carbines?|assault\s+(rifle|weapon)s?|ar[\s-]?15s?|ak[\s-]?47s?|(lower|upper)\s+receivers?|suppressors?|silencers?)\b/),
  weak("firearms", "bare 'gun'/'weapon'", /\b(guns?|weapons?|stun\s+guns?)\b/),

  /* ---- ammunition ----------------------------------------------------- */
  strong("ammunition", "ammunition nouns", /\b(ammunition|ammo|bullets|shotgun\s+shells|hollow[\s-]?points?|fmj|live\s+rounds?)\b/),
  strong("ammunition", "caliber + rounds", /\b(9\s*mm|10\s*mm|5\.56|7\.62|\.\d{2,3}|(12|16|20|28|410)\s*(gauge|ga)|\d{2,3}\s*(cal|caliber))\s+(rounds?|ammo|ammunition|cartridges?|bullets?|shells?)\b/),
  strong("ammunition", "loaded magazine", /\b(\d{1,3}[\s-]?round\s+(magazines?|mags?)|magazines?[^.]{0,40}?\b(rounds?|ammo|ammunition)\b|\b(rounds?|ammo|ammunition)\b[^.]{0,40}?\bmagazines?)\b/),
  weak("ammunition", "bare caliber", /(?<![\w.])(9\s*mm|10\s*mm|5\.56|7\.62|\.(22|223|243|270|308|357|38|380|40|45|50)|(12|16|20|28|410)[\s-]?gauge)\b/),
  weak("ammunition", "ambiguous ammunition words", /\b(rounds|cartridges|bullet|primers)\b/),

  /* ---- prescription_medication ---------------------------------------- */
  strong("prescription_medication", "prescription phrasing", /\b(prescriptions?|prescribed|prescription\s+(meds?|medications?|drugs?)|rx\s+(meds?|medications?|drugs?))\b/),
  weak("prescription_medication", "medication-adjacent", /\b(rx|medications?|meds|pharmacy|pharmaceuticals?|insulin|antibiotics?|pills?)\b/),

  /* ---- controlled_substances ------------------------------------------ */
  strong("controlled_substances", "controlled substances", /\b(controlled\s+substances?|narcotics?|opioids?|opiates?|oxycodone|oxycontin|hydrocodone|vicodin|percocet|adderall|ritalin|xanax|alprazolam|valium|diazepam|fentanyl|morphine|codeine|methadone|ketamine|cocaine|heroin|methamphetamine|lsd|mdma|psilocybin|anabolic\s+steroids?)\b/),
  weak("controlled_substances", "controlled-adjacent", /\b(schedule\s+(ii|iii|iv|2|3|4)|meth|ecstasy|steroids?|testosterone)\b/),

  /* ---- fuel ----------------------------------------------------------- */
  strong("fuel", "liquid fuels", /\b(gasoline|petrol|diesel|kerosene|jet\s+fuel|lighter\s+fluid|camp\s+fuel|white\s+gas|gas\s+cans?|jerry\s+cans?|fuel\s+cans?)\b/),
  weak("fuel", "bare fuel words", /\b(fuel|fuels|ethanol|gas\s+tanks?)\b/),

  /* ---- compressed_gas ------------------------------------------------- */
  strong("compressed_gas", "compressed gas", /\b(propane|butane|compressed\s+gas|gas\s+(cylinders?|canisters?|bottles?)|(oxygen|helium|co2|nitrogen|acetylene|nitrous)\s+(tanks?|cylinders?)|nitrous\s+oxide)\b/),
  weak("compressed_gas", "pressurized containers", /\b(aerosols?|spray\s+paint|fire\s+extinguishers?|co2\s+cartridges?)\b/),

  /* ---- corrosive_hazmat ----------------------------------------------- */
  strong("corrosive_hazmat", "corrosives", /\b(corrosives?|battery\s+acid|(sulfuric|sulphuric|hydrochloric|muriatic|nitric)\s+acid|lye|caustic\s+soda|sodium\s+hydroxide|drain\s+cleaners?)\b/),
  weak("corrosive_hazmat", "bleach (bulk is the concern)", /\bbleach\b/),

  /* ---- toxic_hazmat --------------------------------------------------- */
  strong("toxic_hazmat", "toxic products", /\b(pesticides?|insecticides?|herbicides?|fungicides?|rodenticides?|weed\s+killers?|rat\s+poison|antifreeze|cyanide|arsenic|asbestos)\b/),
  weak("toxic_hazmat", "toxic-adjacent", /\b(poisons?|toxic|mercury|chlorine|pool\s+chemicals)\b/),

  /* ---- infectious_material -------------------------------------------- */
  strong("infectious_material", "infectious material", /\b(infectious|biohazards?|biohazardous|medical\s+waste|used\s+(needles|syringes)|pathogens?)\b/),
  weak("infectious_material", "sharps", /\bsharps\b/),

  /* ---- regulated_dangerous_goods -------------------------------------- */
  strong("regulated_dangerous_goods", "dangerous-goods phrasing", /\b(hazardous\s+materials?|hazardous|hazmat|dangerous\s+goods|flammable|oxidi[sz]ers?|radioactive)\b/),
  weak("regulated_dangerous_goods", "loose / spare lithium batteries", /\b((loose|spare|bulk|extra|replacement)\s+(lithium[\s-]?ion\s+|lithium\s+|li[\s-]?ion\s+|lipo\s+)?(battery|batteries|battery\s+packs?|cells)|lithium([\s-]?ion)?\s+(battery|batteries|cells)|li[\s-]?ion\s+(battery|batteries|cells)|power\s+banks?|18650|21700|lipo\s+(battery|batteries|packs?))\b/),
  weak("regulated_dangerous_goods", "dry ice", /\bdry\s+ice\b/),

  /* ---- fireworks ------------------------------------------------------ */
  strong("fireworks", "fireworks", /\b(fireworks?|firecrackers?|roman\s+candles?|bottle\s+rockets?|m[\s-]?80s?|pyrotechnics?|smoke\s+bombs?)\b/),
  weak("fireworks", "sparklers", /\bsparklers?\b/),

  /* ---- explosives ----------------------------------------------------- */
  strong("explosives", "explosives", /\b(explosives?|gunpowder|black\s+powder|smokeless\s+powder|dynamite|tnt|nitroglycerin|blasting\s+caps?|detonators?|grenades?)\b/),
  strong("explosives", "signal flares", /\b(road|emergency|signal|marine|safety|hand)\s+flares?\b/),
  weak("explosives", "'flares' unless clothing/fittings", /\bflares?\b(?!\s+(jeans|pants|skirts?|leggings|nuts?|fittings?|tools?))/),
  weak("explosives", "c4 (also a supplement)", /\bc[\s-]?4\b/),

  /* ---- illegal_goods -------------------------------------------------- */
  strong("illegal_goods", "illegal goods", /\b(contraband|counterfeits?|fake\s+ids?|forged\s+documents?)\b/),
  weak("illegal_goods", "knockoffs", /\b(knock[\s-]?offs?|bootlegs?|replicas?)\b/),

  /* ---- stolen_goods --------------------------------------------------- */
  strong("stolen_goods", "stolen", /\bstolen\b/),

  /* ---- cash ----------------------------------------------------------- */
  strong("cash", "cash and currency", /\b(cash|currency|currencies|banknotes?|bank\s+notes?|gold\s+(bars?|bullion|coins?)|silver\s+(bars?|bullion)|bullion)\b/),
  weak("cash", "coins", /\bcoins?\b/),

  /* ---- negotiable_instruments ----------------------------------------- */
  strong("negotiable_instruments", "negotiable instruments", /\b(cashier'?s\s+che(ck|que)s?|money\s+orders?|bearer\s+bonds?|travell?er'?s\s+che(ck|que)s?|stock\s+certificates?|blank\s+che(ck|que)s?)\b/),
  weak("negotiable_instruments", "gift cards / checks", /\b(gift\s+cards?|che(ck|que)s)\b/),

  /* ---- biological_specimens ------------------------------------------- */
  strong("biological_specimens", "specimen phrasing", /\b((blood|urine|tissue|stool|saliva|biological|lab|laboratory|pathology)\s+(samples?|specimens?)|vials?\s+of\s+blood)\b/),
  weak("biological_specimens", "specimens", /\bspecimens?\b/),

  /* ---- live_animals --------------------------------------------------- */
  strong("live_animals", "live animal", /\blive\s+(animals?|pets?|puppy|puppies|kittens?|dogs?|cats?|birds?|fish|reptiles?|snakes?|lizards?|hamsters?|rabbits?|bunny|bunnies|chicks?|chickens?|insects?|crickets?|bees|livestock)\b/),
  strong("live_animals", "unmistakable animal nouns", /\b(puppy|puppies|kittens?|livestock|poultry)\b/),
  weak("live_animals", "animal-adjacent", /\b(hamsters?|reptiles?|bees|chicks|dogs?|cats?|rabbits?|bunny|bunnies)\b/),

  /* ---- people --------------------------------------------------------- */
  strong("people", "passenger phrasing", /\b(passengers?|needs?\s+a\s+ride|give\s+(me|him|her|them|us)\s+a\s+ride|transport\s+(me|him|her|them|us|a\s+person|people))\b/),
  weak("people", "ride phrasing", /\b(rideshare|ride[\s-]share|carpool|pick\s+me\s+up|a\s+ride)\b/),
];

/* Every id in the table MUST be a closed class — enforced at load and in test. */
for (const entry of RESTRICTED_SIGNAL_LEXICON) {
  if (!(PROHIBITED_CLASSES as readonly string[]).includes(entry.prohibitedClass)) {
    throw new Error(`restricted lexicon names an unknown class: ${entry.prohibitedClass}`);
  }
  if (entry.pattern.global) {
    throw new Error(`restricted lexicon pattern must not carry the g flag: ${entry.label}`);
  }
}

/** Private global copies; the exported table stays stateless for readers. */
const COMPILED_EXCLUSIONS: readonly RegExp[] = RESTRICTED_SIGNAL_EXCLUSIONS.map(
  (e) => new RegExp(e.pattern.source, e.pattern.flags.replace("g", "") + "g")
);
const COMPILED_LEXICON: readonly RegExp[] = RESTRICTED_SIGNAL_LEXICON.map(
  (e) => new RegExp(e.pattern.source, e.pattern.flags.replace("g", "") + "g")
);

const CLASS_ORDER: ReadonlyMap<ProhibitedClass, number> = new Map(
  PROHIBITED_CLASSES.map((c, i) => [c, i])
);

/* ------------------------------------------------------------ normalization */

/**
 * Lower-case, strip diacritics, fold quotes, collapse whitespace, bound the
 * length. Exported so a test can assert exactly what the matcher sees.
 */
export function normalizeDescription(text: string): string {
  const bounded = typeof text === "string" ? text.slice(0, MAX_RAW_DESCRIPTION_LENGTH) : "";
  return bounded
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function blankExclusions(normalized: string): string {
  let out = normalized;
  for (const re of COMPILED_EXCLUSIONS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => " ".repeat(m.length));
  }
  return out;
}

/* --------------------------------------------------------------------- scan */

type Hit = RestrictedSignal & { position: number };

export function scanRestrictedSignals(text: string): RestrictedSignalScan {
  const normalized = normalizeDescription(text);
  if (normalized === "") return { signals: [], material: false };
  const haystack = blankExclusions(normalized);

  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < COMPILED_LEXICON.length; i++) {
    const entry = RESTRICTED_SIGNAL_LEXICON[i];
    const re = COMPILED_LEXICON[i];
    re.lastIndex = 0;
    for (const m of haystack.matchAll(re)) {
      const matchedText = m[0].replace(/\s+/g, " ").trim();
      if (matchedText === "") continue;
      const key = `${entry.prohibitedClass}\u0000${matchedText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        prohibitedClass: entry.prohibitedClass,
        matchedText,
        strength: entry.strength,
        position: m.index ?? 0,
      });
    }
  }

  hits.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === "strong" ? -1 : 1;
    const ca = CLASS_ORDER.get(a.prohibitedClass) ?? 0;
    const cb = CLASS_ORDER.get(b.prohibitedClass) ?? 0;
    if (ca !== cb) return ca - cb;
    if (a.position !== b.position) return a.position - b.position;
    return a.matchedText < b.matchedText ? -1 : a.matchedText > b.matchedText ? 1 : 0;
  });

  const signals: RestrictedSignal[] = hits.map(({ prohibitedClass, matchedText, strength }) => ({
    prohibitedClass,
    matchedText,
    strength,
  }));
  return { signals, material: signals.some((s) => s.strength === "strong") };
}

/**
 * The class of the strongest signal: the first `strong` one if the scan is
 * material, else the first `weak` one, else `null`. Signals are already
 * ordered strong-first, so this is the head of the list. A weak answer is a
 * hint for the clarification prompt — the caller must still read `material`
 * before treating the class as a proposal worth review.
 */
export function strongestSignal(scan: RestrictedSignalScan): ProhibitedClass | null {
  return scan.signals.length > 0 ? scan.signals[0].prohibitedClass : null;
}
