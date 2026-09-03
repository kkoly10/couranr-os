/**
 * P5-001 — restricted-item SIGNAL scanner. The contract under test is the §11
 * asymmetry at the prose layer: a keyword may escalate and may never
 * prohibit, and the canonical false positives ("alcohol-free cleaner", a toy
 * gun, a battery-powered drill, a laptop) must not even look material.
 */
import { describe, expect, it } from "vitest";
import { PROHIBITED_CLASSES, type ProhibitedClass } from "@/lib/couranr/shipment/facts";
import {
  RESTRICTED_SIGNAL_EXCLUSIONS,
  RESTRICTED_SIGNAL_LEXICON,
  RESTRICTED_SIGNAL_LEXICON_VERSION,
  normalizeDescription,
  scanRestrictedSignals,
  strongestSignal,
  type RestrictedSignalScan,
} from "@/lib/couranr/shipment/restrictedSignals";

const strongClasses = (scan: RestrictedSignalScan): ProhibitedClass[] =>
  scan.signals.filter((s) => s.strength === "strong").map((s) => s.prohibitedClass);

/** No strong signal for `cls`; whatever remains is weak, and the scan is not material. */
function expectNotStrong(text: string, cls: ProhibitedClass) {
  const scan = scanRestrictedSignals(text);
  expect(strongClasses(scan)).not.toContain(cls);
  expect(scan.material).toBe(false);
  for (const s of scan.signals) expect(s.strength).toBe("weak");
  return scan;
}

function expectNone(text: string) {
  const scan = scanRestrictedSignals(text);
  expect(scan.signals).toEqual([]);
  expect(scan.material).toBe(false);
  expect(strongestSignal(scan)).toBeNull();
}

function expectStrong(text: string, cls: ProhibitedClass) {
  const scan = scanRestrictedSignals(text);
  expect(scan.material).toBe(true);
  expect(strongClasses(scan)).toContain(cls);
  return scan;
}

describe("false-positive guards — the canonical innocents never look material", () => {
  it('"alcohol-free cleaner" → no strong alcohol signal, not material', () => {
    expectNotStrong("alcohol-free cleaner", "alcohol");
  });

  it('"toy gun" → no strong firearms signal', () => {
    expectNotStrong("toy gun", "firearms");
  });

  it('"gunmetal lamp" → no signal at all', () => {
    expectNone("gunmetal lamp");
  });

  it('"toy pistol" → no strong firearms signal (toy exclusion covers every firearm noun)', () => {
    expectNotStrong("toy pistol", "firearms");
    expectNotStrong("two toy rifles and a toy shotgun", "firearms");
  });

  it('"spinach dip" / "ranch dip" → bare "dip" is at most weak tobacco, never material', () => {
    expectNotStrong("spinach dip and chips", "tobacco");
    expectNotStrong("a tray of ranch dip", "tobacco");
  });

  it('"a can of dip" / "dipping tobacco" → strong tobacco', () => {
    expectStrong("a can of dip", "tobacco");
    expectStrong("two tins of dip", "tobacco");
    expectStrong("dipping tobacco", "tobacco");
  });


  it('"battery-powered drill" → no battery / dangerous-goods signal (installed battery is not hazmat)', () => {
    const scan = expectNotStrong("battery-powered drill", "regulated_dangerous_goods");
    expect(scan.signals.filter((s) => s.prohibitedClass === "regulated_dangerous_goods")).toEqual([]);
    expect(scan.signals).toEqual([]);
  });

  it('"laptop" → none', () => {
    expectNone("laptop");
  });

  it('"phone" → none', () => {
    expectNone("phone");
  });

  it('"wine glasses" (glassware) → not alcohol-strong', () => {
    expectNotStrong("wine glasses", "alcohol");
  });

  it('"gun safe" → weak at most', () => {
    expectNotStrong("gun safe", "firearms");
  });

  it("other compound exclusions the header documents: nerf, water gun, glue gun, caulking gun, root beer", () => {
    for (const text of ["nerf blaster", "water gun", "glue gun", "caulking gun", "root beer float"]) {
      expectNone(text);
    }
  });
});

describe("true positives — restricted wording is strong and material", () => {
  it('"12 bottles of beer" → alcohol', () => {
    const scan = expectStrong("12 bottles of beer", "alcohol");
    expect(strongestSignal(scan)).toBe("alcohol");
    expect(scan.signals[0]).toMatchObject({ strength: "strong", matchedText: "bottles of beer" });
  });

  it('"box of 9mm ammunition" → ammunition', () => {
    expectStrong("box of 9mm ammunition", "ammunition");
  });

  it('"9mm rounds" → ammunition (caliber + rounds; neither alone is strong)', () => {
    expectStrong("9mm rounds", "ammunition");
    expectNotStrong("9mm socket set", "ammunition");
    expectNotStrong("three rounds of golf", "ammunition");
  });

  it('"prescription oxycodone" → prescription_medication AND controlled_substances', () => {
    const scan = expectStrong("prescription oxycodone", "prescription_medication");
    expect(strongClasses(scan)).toContain("controlled_substances");
  });

  it('"fireworks" → fireworks', () => {
    expectStrong("fireworks", "fireworks");
  });

  it('"explosive" → explosives', () => {
    expectStrong("explosive", "explosives");
  });

  it('"hazardous material" → regulated_dangerous_goods, matched as the whole phrase', () => {
    const scan = expectStrong("hazardous material", "regulated_dangerous_goods");
    expect(scan.signals[0].matchedText).toBe("hazardous material");
  });

  it('"case of wine" → alcohol', () => {
    expectStrong("case of wine", "alcohol");
  });

  it('"a carton of cigarettes" → tobacco', () => {
    expectStrong("a carton of cigarettes", "tobacco");
  });

  it('"live puppy" → live_animals', () => {
    expectStrong("live puppy", "live_animals");
  });

  it("a loaded magazine is ammunition; a magazine subscription is not", () => {
    expectStrong("30-round magazine with 50 rounds", "ammunition");
    expectNone("magazine subscription, 12 issues");
  });

  it("negation is NOT parsed — 'no fireworks' still signals, for a human to dismiss", () => {
    expectStrong("no fireworks in this box", "fireworks");
  });
});

describe("normalization", () => {
  it("is case- and diacritic-insensitive and folds curly quotes", () => {
    expectStrong("TEQUÍLA", "alcohol");
    expectStrong("Cashier’s check", "negotiable_instruments");
    expect(normalizeDescription("  Wine\n\tGlasses ")).toBe("wine glasses");
  });

  it("bounds the input at 4000 characters", () => {
    const filler = "a".repeat(4000);
    expect(normalizeDescription(filler + " fireworks")).toHaveLength(4000);
    expect(scanRestrictedSignals(filler + " fireworks").signals).toEqual([]);
  });

  it("empty and non-string inputs are empty scans", () => {
    expectNone("");
    expectNone("   ");
    expectNone(undefined as unknown as string);
  });
});

describe("strongestSignal", () => {
  it("returns the strong class when material, the first weak class otherwise, null for nothing", () => {
    expect(strongestSignal(scanRestrictedSignals("case of wine and a gun"))).toBe("alcohol");
    expect(strongestSignal(scanRestrictedSignals("gun"))).toBe("firearms");
    expect(strongestSignal(scanRestrictedSignals("laptop"))).toBeNull();
  });

  it("strong signals are listed before weak ones, in closed-class order", () => {
    const scan = scanRestrictedSignals("rounds, a puppy, and beer");
    const strengths = scan.signals.map((s) => s.strength);
    const firstWeak = strengths.indexOf("weak");
    expect(strengths.slice(0, firstWeak === -1 ? undefined : firstWeak).every((s) => s === "strong")).toBe(true);
    const strongOrder = scan.signals
      .filter((s) => s.strength === "strong")
      .map((s) => PROHIBITED_CLASSES.indexOf(s.prohibitedClass));
    expect([...strongOrder].sort((a, b) => a - b)).toEqual(strongOrder);
  });
});

describe("lexicon is closed, versioned and inspectable", () => {
  it("names the version", () => {
    expect(RESTRICTED_SIGNAL_LEXICON_VERSION).toBe("couranr-restricted-lexicon-v0-2026-09-02");
  });

  it("every entry names a PROHIBITED_CLASSES id, a strength and a non-global pattern", () => {
    expect(RESTRICTED_SIGNAL_LEXICON.length).toBeGreaterThan(30);
    for (const e of RESTRICTED_SIGNAL_LEXICON) {
      expect(PROHIBITED_CLASSES).toContain(e.prohibitedClass);
      expect(["strong", "weak"]).toContain(e.strength);
      expect(e.pattern.global).toBe(false);
      expect(e.label.length).toBeGreaterThan(0);
    }
    for (const x of RESTRICTED_SIGNAL_EXCLUSIONS) expect(x.pattern.global).toBe(false);
  });

  it("covers every class the task names", () => {
    const covered = new Set(RESTRICTED_SIGNAL_LEXICON.map((e) => e.prohibitedClass));
    for (const cls of [
      "alcohol",
      "tobacco",
      "vaping_nicotine",
      "prescription_medication",
      "controlled_substances",
      "firearms",
      "ammunition",
      "fireworks",
      "explosives",
      "fuel",
      "compressed_gas",
      "corrosive_hazmat",
      "toxic_hazmat",
      "regulated_dangerous_goods",
      "live_animals",
      "cash",
    ] as const) {
      expect(covered.has(cls)).toBe(true);
    }
  });

  it("a scan is deterministic and does not depend on prior calls (no regex lastIndex leakage)", () => {
    // A reader that probes the exported patterns with .test() must not change
    // what the scanner reports afterwards.
    for (const e of RESTRICTED_SIGNAL_LEXICON) e.pattern.test("case of wine beer beer");
    const a = scanRestrictedSignals("beer beer wine");
    const b = scanRestrictedSignals("beer beer wine");
    expect(a).toEqual(b);
    expect(a.signals.map((s) => s.matchedText)).toEqual(["beer", "wine"]);
  });
});

describe("properties", () => {
  /** Deterministic PRNG so a failure reproduces. */
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const VOCAB = [
    "beer", "beer", "wine", "case", "of", "bottles", "9mm", "rounds", "ammo", "gun", "toy", "safe",
    "alcohol-free", "cleaner", "laptop", "puppy", "live", "cash", "fireworks", "flares", "road",
    "magazine", "prescription", "rx", "propane", "battery-powered", "lithium", "batteries", "spare",
    "cigarettes", "carton", "vape", "weed", "killer", "hazardous", "material", "the", "a", "and", ".",
    ",", "12", "30-round", "glasses", "root", "hot", "glue", "TEQUÍLA", "Cashier’s", "check",
  ];

  it("no input yields two signals with the same class and matchedText", () => {
    const rnd = mulberry32(20260902);
    for (let i = 0; i < 300; i++) {
      const words = Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]);
      const text = words.join(rnd() < 0.2 ? "  " : " ");
      const scan = scanRestrictedSignals(text);
      const keys = scan.signals.map((s) => `${s.prohibitedClass}|${s.matchedText}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(scan.material).toBe(scan.signals.some((s) => s.strength === "strong"));
      for (const s of scan.signals) expect(PROHIBITED_CLASSES).toContain(s.prohibitedClass);
    }
  });

  it("a 4000-character input scans quickly (bounded work)", () => {
    const rnd = mulberry32(7);
    let text = "";
    while (text.length < 4000) text += VOCAB[Math.floor(rnd() * VOCAB.length)] + " ";
    text = text.slice(0, 4000);
    scanRestrictedSignals(text); // warm the regex engine once
    const t0 = performance.now();
    const scan = scanRestrictedSignals(text);
    const ms = performance.now() - t0;
    expect(scan.signals.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });
});
