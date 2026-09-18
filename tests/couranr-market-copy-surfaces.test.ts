/**
 * MKT-006 — the right market sentence on the right surface.
 *
 * MKT-001 has ONE public market sentence and it opens "Local BUSINESS delivery
 * across …". That was correct while Couranr was a merchant-only brand. MKT-004
 * expanded the brand to two entry paths, and the sentence then shipped verbatim
 * on both surfaces MKT-004 created: a person reading `/sameday` — a page whose
 * entire job is to offer THEM a delivery — was told Couranr delivers for
 * businesses, and the master homepage carried the businesses-only description
 * that MKT-004.value.product_description_after had already retired.
 *
 * Nothing caught it. The copy test only compares the module against the
 * registry, and both sides said the same wrong thing; the composition gates
 * read attributes, not sentences. So this test asserts the SURFACE, which is
 * where the defect actually lived: which page renders which sentence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MARKETED_MARKETS,
  MARKETS_PUBLIC_COPY,
  MARKETS_PUBLIC_COPY_NEUTRAL,
} from "@/lib/couranr/public/governed";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const REGISTRY = JSON.parse(read("02_DECISION_REGISTRY.json"));
const rec = (id: string) =>
  REGISTRY.decisions.find((r: { id: string }) => r.id === id);

/** The two consumer-and-master surfaces MKT-006 governs. */
const NEUTRAL_SURFACES = [
  "app/(couranr)/(public)/(master-public)/page.tsx",
  "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx",
];

/** Business public surfaces, which keep MKT-001's sentence unchanged. */
const BUSINESS_SURFACES = [
  "app/(couranr)/(public)/(business-public)/business/page.tsx",
  "app/(couranr)/(public)/(business-public)/service-areas/page.tsx",
];

describe("MKT-006 is materialized", () => {
  it("exists as a decided record that amends MKT-001", () => {
    const m6 = rec("MKT-006");
    expect(m6).toBeTruthy();
    expect(m6.status).toBe("decided");
    expect(m6.amends).toBe("MKT-001");
    expect(rec("MKT-001").amended_by).toContain("MKT-006");
  });

  it("matches the module byte for byte", () => {
    expect(MARKETS_PUBLIC_COPY_NEUTRAL).toBe(rec("MKT-006").value.public_copy_neutral);
    expect(MARKETS_PUBLIC_COPY).toBe(rec("MKT-001").value.public_copy);
  });

  it("leaves MKT-001's own sentence untouched", () => {
    expect(MARKETS_PUBLIC_COPY).toMatch(/^Local business delivery across/);
  });

  /* The point of the amendment is FRAMING, not a different coverage claim. If
     the two sentences ever named different places, one of them would be a
     second market authority — exactly what routing everything through MKT-001
     exists to prevent. */
  it("names the same markets as MKT-001, in the same order", () => {
    const shortName = (m: string) => (m === "Washington, DC" ? "DC" : m);
    for (const sentence of [MARKETS_PUBLIC_COPY, MARKETS_PUBLIC_COPY_NEUTRAL]) {
      let cursor = -1;
      for (const market of MARKETED_MARKETS) {
        const at = sentence.indexOf(shortName(market));
        expect(at, `${market} missing from: ${sentence}`).toBeGreaterThan(-1);
        expect(at, `${market} out of order in: ${sentence}`).toBeGreaterThan(cursor);
        cursor = at;
      }
      expect(sentence).toContain("surrounding areas");
    }
  });

  /* SVC-002 is UNRESOLVED and MKT-001 excludes Maryland from initial
     marketing. Neither sentence may quietly acquire either. */
  it("invents no boundary and markets no Maryland", () => {
    for (const sentence of [MARKETS_PUBLIC_COPY, MARKETS_PUBLIC_COPY_NEUTRAL]) {
      expect(sentence).not.toMatch(/radius|polygon|\bZIP\b|\bmiles?\b|Maryland|\bMD\b/i);
    }
  });
});

describe("each surface renders the sentence written for its audience", () => {
  /* Comments stripped first. Both pages explain in prose WHY they no longer
     read `MARKETS_PUBLIC_COPY`, and a rule about what the page renders must not
     be tripped by a sentence describing the bug it fixed. */
  const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it.each(NEUTRAL_SURFACES)("%s reads the neutral sentence, not the business one", (file) => {
    const src = code(file);
    expect(src).toContain("MARKETS_PUBLIC_COPY_NEUTRAL");
    /* `MARKETS_PUBLIC_COPY_NEUTRAL` contains `MARKETS_PUBLIC_COPY` as a
       substring, so a bare `toContain` would pass on the neutral import alone.
       The boundary is what makes this assertion mean anything. */
    expect(src, `${file} still reads MKT-001's business sentence`).not.toMatch(
      /MARKETS_PUBLIC_COPY(?!_NEUTRAL)/,
    );
  });

  it.each(BUSINESS_SURFACES)("%s keeps MKT-001's business sentence", (file) => {
    expect(code(file)).toMatch(/MARKETS_PUBLIC_COPY(?!_NEUTRAL)/);
  });

  /* Neither sentence may be typed into a page: MKT-001 owns the markets and
     the work order says so in as many words for PUB-012. */
  it.each([...NEUTRAL_SURFACES, ...BUSINESS_SURFACES])(
    "%s types no market name of its own",
    (file) => {
      const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const market of ["Stafford", "Woodbridge", "Fredericksburg"]) {
        expect(src, `${file} types "${market}"`).not.toContain(market);
      }
    },
  );

  it("POSITIVE CONTROL: the business sentence on a neutral surface is detected", () => {
    const tampered = 'import { MARKETS_PUBLIC_COPY } from "@/lib/couranr/public/governed";';
    expect(tampered).toMatch(/MARKETS_PUBLIC_COPY(?!_NEUTRAL)/);
  });
});

/**
 * THE 2026-09 MARKETING-ARCHITECTURE LOCK — one claim, one sentence, however
 * many surfaces render it.
 *
 * The brief's adversarial review asks, in as many words, "do supporting pages
 * and overview pages contradict each other?" The answer is a property of the
 * source, not of a reading: a claim boundary that exists twice in prose will
 * eventually exist twice in two different wordings, and the reader who meets
 * both is the one who finds out.
 *
 * Two claim boundaries now cross page families and are asserted here.
 */
const MASTER_SURFACE = "app/(couranr)/(public)/(master-public)/page.tsx";

describe("cross-surface claim boundaries are single-sourced", () => {
  const BUSINESS_OVERVIEW = "app/(couranr)/(public)/(business-public)/business/page.tsx";
  const BUSINESS_TYPES = "app/(couranr)/(public)/(business-public)/businesses/page.tsx";
  const SAMEDAY = "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx";

  it("the category-does-not-decide-eligibility line is ONE governed constant", () => {
    /* PUB-001 §6 teases the category system and PUB-009 owns it. Both have to
       say that a category tunes recommendations and never decides what can be
       sent — and both render `CATEGORY_PURPOSE_COPY` rather than saying it in
       their own words. The brief proposed separate wording for the overview
       page; using the constant instead is the deviation this asserts. */
    for (const f of [BUSINESS_OVERVIEW, BUSINESS_TYPES]) {
      expect(read(f), `${f} does not render the governed category sentence`).toContain(
        "CATEGORY_PURPOSE_COPY",
      );
    }
    // And nobody retypes it. The words themselves must appear in exactly one
    // place: the registry module. FOUR surfaces render this sentence, and
    // onboarding carried its own paraphrase until 2026-09 — the screen where a
    // merchant actually picks a category was the one place the overstated
    // "does not limit what you can send" was most likely to be believed.
    const RENDERERS = [
      BUSINESS_OVERVIEW,
      BUSINESS_TYPES,
      "components/couranr/settings/MerchantSettings.tsx",
      "components/couranr/onboarding/OnboardingForm.tsx",
    ];
    const sentence = "shapes what Couranr suggests";
    /* COMMENTS STRIPPED. A note explaining which wording a file replaced quotes
       that wording, and a raw scan reads the explanation as the violation it
       describes — the same lesson the prohibited-claims scanner and the
       destructive-migration scanner both wrote down. */
    const code = (f: string) =>
      read(f)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const f of RENDERERS) {
      expect(code(f), `${f} does not render the governed category sentence`).toContain(
        "CATEGORY_PURPOSE_COPY",
      );
      expect(code(f), `${f} retypes the governed category sentence`).not.toContain(sentence);
    }
    expect(read("lib/couranr/categories/registry.ts")).toContain(sentence);
    /* The claim boundary itself, asserted where it lives so a future edit
       cannot quietly restore the absolute the rendered page contradicted.
       Comments stripped for the same reason as above — the constant's own note
       records the wording it replaced, which is exactly the string checked. */
    expect(code("lib/couranr/categories/registry.ts")).not.toContain(
      "never limits what you can send",
    );
  });

  it("both prohibition surfaces derive from the enforced vocabulary", () => {
    /* PUB-013 §6 expands every prohibited class; PUB-001 §11 shows the group
       headings only. Two DEPTHS of one list is fine. Two LISTS is the drift —
       so both read PROHIBITED_GROUPS and neither types a category. */
    for (const f of [SAMEDAY, BUSINESS_OVERVIEW]) {
      expect(read(f), `${f} does not derive its prohibition summary`).toContain(
        "PROHIBITED_GROUPS",
      );
    }
    for (const f of [SAMEDAY, BUSINESS_OVERVIEW]) {
      const src = read(f);
      for (const typed of ["Alcohol", "Firearms", "Live animals", "Prescription medication"]) {
        expect(src, `${f} types "${typed}" instead of deriving it`).not.toContain(typed);
      }
    }
  });

  it("the locked product distinction is ONE string, rendered on both surfaces", () => {
    /* "Same Day solves a delivery. Couranr for Business helps your business
       offer delivery." is the owner-locked positioning. The master homepage and
       the business overview both make the argument; if the sentence existed
       twice, the two pages could end up describing one product differently. */
    for (const f of [MASTER_SURFACE, BUSINESS_OVERVIEW]) {
      expect(read(f), `${f} does not render the locked distinction`).toContain(
        "MASTER_COPY.network_statement",
      );
    }
    const words = "Same Day solves a delivery";
    for (const f of [MASTER_SURFACE, BUSINESS_OVERVIEW]) {
      expect(read(f), `${f} retypes the locked distinction`).not.toContain(words);
    }
    expect(read("lib/couranr/public/masterSameDayCopy.ts")).toContain(words);
  });

  /**
   * THE CEILING BAN, SPLIT 2026-09-17.
   *
   * WHAT CHANGED AND WHY. This banned a declared-value ceiling on ALL FOUR
   * public surfaces, on the ground that "the value-tiered custody work it
   * belongs to is not in this build". That work IS in this build —
   * `deriveProtection` derives the level, the SQL re-derives it, and
   * `private.couranr_enforce_consumer_custody_sequence` enforces the ceremony —
   * so the ban is now scoped to the surfaces it was always really about.
   *
   * THE SCOPE IS WHAT MATTERS, and it is unchanged: the protection authority
   * governs CONSUMER Same Day and nothing else.
   * `private.couranr_delivery_protection_level` returns null unless the request
   * carries a `protection_policy_version`, and the only writer of that column
   * is `couranr_record_consumer_trust`, which resolves a consumer guest session
   * and filters `requester_kind='consumer'`. So a business delivery derives no
   * level, and the master and business surfaces must still never state one — a
   * merchant reading a ceiling would be reading a policy their deliveries are
   * not held to.
   */
  it("the master and business surfaces state no declared-value ceiling", () => {
    for (const f of [MASTER_SURFACE, BUSINESS_OVERVIEW, BUSINESS_TYPES]) {
      const src = read(f);
      expect(src, `${f} states a declared-value ceiling`).not.toMatch(/declared value/i);
      expect(src, `${f} states a maximum value`).not.toMatch(/maximum (declared )?value/i);
    }
  });

  /* PUB-013 is the consumer surface, so it is the ONE page that owes the
     figure. What it may not do is type it: the amounts are composed from
     `lib/couranr/consumer/protection.ts`, the module the server and the SQL
     both derive from. Comments stripped for the same reason as the category
     scanner above — the block explaining which constant was rejected names
     that constant, and a raw scan reads the explanation as the violation. */
  it("PUB-013 states the ceiling, and composes it from the protection module", () => {
    const code = read(SAMEDAY)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(code, "PUB-013 no longer renders the accepted maximum").toContain(
      "acceptedDeclaredValueCents",
    );
    expect(code).toContain("declaredValueDollars");
    expect(code, "PUB-013 types a dollar amount").not.toMatch(/\$\s?\d/);
  });
});

/* ═══════════════════ MKT-005 must DECLARE every surface it governs ════════ */

describe("MKT-005's declared scope matches the surfaces it actually governs", () => {
  /*
   * THE GAP THAT LET A MERGE DROP PUB-001. MKT-005 is rank-1 authority for the
   * locked copy, and `/business` renders its `network_*` strings through
   * MASTER_COPY. A reconciliation merge kept those VALUES and silently dropped
   * PUB-001 and `/business` from the record's `affected_screen_ids` and
   * `affected_routes`, so the authority governed the copy without naming the
   * surface. Every gate stayed green: nothing compared the declared scope to
   * the real one.
   *
   * The fix is not to make a test ignore `/business`. It is to require the
   * record to say where it applies, and to fail when a surface renders a locked
   * string the record does not claim.
   */
  const REGISTRY = JSON.parse(
    readFileSync(path.join(__dirname, "..", "02_DECISION_REGISTRY.json"), "utf8")
  );
  const MKT005 = REGISTRY.decisions.find((r: { id: string }) => r.id === "MKT-005");

  /** Surface -> the screen id and route MKT-005 must declare for it. */
  const GOVERNED: ReadonlyArray<readonly [string, string, string]> = [
    ["app/(couranr)/(public)/(master-public)/page.tsx", "PUB-012", "/"],
    ["app/(couranr)/(public)/(consumer-public)/sameday/page.tsx", "PUB-013", "/sameday"],
    ["app/(couranr)/(public)/(business-public)/business/page.tsx", "PUB-001", "/business"],
  ];

  it.each(GOVERNED.map((g) => [g[1], g] as const))(
    "%s is declared in MKT-005's scope",
    (_id, [file, screenId, route]) => {
      const src = readFileSync(path.join(__dirname, "..", file), "utf8");
      /* Non-vacuous: the surface must actually render locked MKT-005 copy.
         MKT-005 has four groups and a surface may draw on any of them —
         /sameday renders SAME_DAY_COPY, not MASTER_COPY — so the check is that
         it renders one of the governed modules, not one specific group. An
         earlier version of this test demanded MASTER_COPY everywhere and failed
         /sameday, which would have been the test being wrong about the record
         rather than the record being wrong about the surface. */
      expect(src, `${file} renders no MKT-005 copy at all`).toMatch(
        /\b(MASTER_COPY|SAME_DAY_COPY|PUBLIC_CHROME_COPY)\./
      );
      expect(
        MKT005.affected_screen_ids,
        `MKT-005 governs ${file} but does not declare ${screenId}`
      ).toContain(screenId);
      expect(
        MKT005.affected_routes,
        `MKT-005 governs ${file} but does not declare ${route}`
      ).toContain(route);
    }
  );

  it("names the business page among the code paths it governs", () => {
    expect(
      (MKT005.affected_code_paths ?? []).some((p: string) => p.includes("business/page.tsx")),
      "MKT-005 does not list the business page it governs"
    ).toBe(true);
  });

  it("a /business copy edit that retypes a locked string fails", () => {
    /* The drift this exists to catch: someone types the positioning sentence
       into the business page instead of rendering it from MASTER_COPY. The
       string then has two owners and the registry governs only one of them. */
    const src = readFileSync(
      path.join(__dirname, "..", "app/(couranr)/(public)/(business-public)/business/page.tsx"),
      "utf8"
    );
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    const locked = MKT005.value.master.network_statement as string;
    expect(locked.length).toBeGreaterThan(20);
    expect(
      code.includes(locked),
      "/business retypes MKT-005's locked positioning string instead of rendering it"
    ).toBe(false);
    expect(code, "/business stopped rendering the locked string at all").toMatch(
      /MASTER_COPY\.network_statement/
    );
  });
});
