/**
 * MKT-005 parity: the copy module must say exactly what the decision says.
 *
 * The registry is the authority for these strings; `masterSameDayCopy.ts` is
 * the render-time implementation of it. Without this test the two drift the
 * first time someone tweaks a headline in the module — the same failure mode
 * `governed.ts` has been guarded against since the pricing values landed.
 *
 * Byte-exact, both directions, and deliberately unforgiving about punctuation:
 * the owner brief itself spelled two strings with an ASCII apostrophe in one
 * place and U+2019 in another, which is exactly the kind of difference a
 * human reviewer reads straight past.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MKT_005_COPY, SAME_DAY_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { PROHIBITED_CLASSES } from "@/lib/couranr/shipment/facts";
import { PROHIBITED_LABELS } from "@/lib/couranr/public/prohibitedSummary";

const ROOT = path.join(__dirname, "..");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
const MKT005 = REGISTRY.decisions.find((r: { id: string }) => r.id === "MKT-005");

/** "master.hero_headline" -> string | string[], for both sides. */
function flatten(node: unknown, trail: string[] = []): Record<string, unknown> {
  if (typeof node === "string" || Array.isArray(node)) return { [trail.join(".")]: node };
  if (node && typeof node === "object") {
    return Object.entries(node).reduce(
      (acc, [k, v]) => ({ ...acc, ...flatten(v, [...trail, k]) }),
      {} as Record<string, unknown>,
    );
  }
  return {};
}

const GROUPS = ["master", "same_day", "send", "chrome"] as const;

describe("MKT-005 is materialized", () => {
  it("exists as a decided record with a structured value", () => {
    expect(MKT005).toBeTruthy();
    expect(MKT005.status).toBe("decided");
    expect(typeof MKT005.value).toBe("object");
    for (const g of GROUPS) expect(MKT005.value[g], `MKT-005.value.${g}`).toBeTruthy();
  });

  it("stores no route or URL — routes belong to the screen source", () => {
    const strings = Object.values(flatten(MKT_005_COPY)).flat().filter((s) => typeof s === "string");
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings as string[]) {
      expect(s, `copy string contains a path: ${s}`).not.toMatch(/(^|\s)\/[a-z[]/);
      expect(s, `copy string contains a URL: ${s}`).not.toMatch(/https?:\/\//);
    }
  });

  /* Decision-dependent values have their own records and their own module.
     A price or a market name typed into locked copy would be a second
     authority for a fact PRC-001, MIL-002, MKT-001 and HRS-001 already own. */
  it("stores no price, market name or operating hour", () => {
    const strings = Object.values(flatten(MKT_005_COPY)).flat() as string[];
    for (const s of strings) {
      expect(s, `price literal: ${s}`).not.toMatch(/\$\s?\d/);
      expect(s, `operating-hour literal: ${s}`).not.toMatch(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i);
      for (const market of ["Stafford", "Woodbridge", "Fredericksburg", "Washington, DC"]) {
        expect(s, `market literal: ${s}`).not.toContain(market);
      }
    }
  });
});

describe("the copy module and MKT-005 agree", () => {
  const registrySide = flatten(
    Object.fromEntries(GROUPS.map((g) => [g, MKT005.value[g]])),
  );
  const moduleSide = flatten(MKT_005_COPY);

  it("has the same set of keys in both directions", () => {
    expect(Object.keys(moduleSide).sort()).toEqual(Object.keys(registrySide).sort());
    expect(Object.keys(moduleSide).length).toBeGreaterThan(40);
  });

  it("matches every string byte for byte, apostrophes included", () => {
    const mismatches: string[] = [];
    for (const [key, want] of Object.entries(registrySide)) {
      const got = moduleSide[key];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push(`${key}\n    registry: ${JSON.stringify(want)}\n    module:   ${JSON.stringify(got)}`);
      }
    }
    expect(mismatches.join("\n  ")).toBe("");
  });

  /* U+2019 everywhere, as MKT-005.value.apostrophe_normalization records. An
     ASCII apostrophe reaching either side is the exact defect that entry
     exists to prevent, and it is invisible in a diff. */
  it("uses U+2019 for every apostrophe, on both sides", () => {
    for (const [side, flat] of [["registry", registrySide], ["module", moduleSide]] as const) {
      const ascii = Object.entries(flat)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map((s) => [k, s] as const) : [[k, v] as const]))
        .filter(([, s]) => typeof s === "string" && s.includes("'"))
        .map(([k, s]) => `${side}.${k}: ${s}`);
      expect(ascii).toEqual([]);
    }
    /* The normalization is only meaningful if U+2019 is actually in use. */
    const curly = Object.values(moduleSide).flat().filter((s) => typeof s === "string" && s.includes("’"));
    expect(curly.length).toBeGreaterThan(5);
  });

  it("POSITIVE CONTROL: a one-character copy edit is detected", () => {
    const tampered = { ...moduleSide, "master.hero_headline": "Local delivery, built around you" };
    expect(tampered["master.hero_headline"]).not.toBe(registrySide["master.hero_headline"]);
  });
});

/**
 * PUB-013's marketing copy, after the 2026-09 information-architecture lock.
 *
 * WHAT CHANGED AND WHY. This block used to assert the nine internal address
 * states (idle / focused / typing / suggestions / selected / checking /
 * eligible / review-needed / error) as MARKETING copy. The owner has retired
 * that presentation: those states remain a PRODUCT requirement for /send and
 * are still enforced there, but depicting internal UI state on a marketing
 * page told a visitor nothing about whether Couranr could run their trip.
 * These assertions replace them at equal strength — the availability section
 * still may not invent a boundary, and the new sections carry their own
 * claim limits.
 */
describe("PUB-013 marketing copy limits", () => {
  const SD = SAME_DAY_COPY;

  it("retires the nine interaction states from marketing copy", () => {
    for (const key of ["availability_state_order", "availability_state_labels", "availability_state_captions"]) {
      expect(SD, `${key} is a /send product concern, not marketing copy`).not.toHaveProperty(key);
    }
    expect(SD.availability_headline).toBeTruthy();
    expect(SD.availability_body).toBeTruthy();
  });

  /* SVC-002 (the boundary) is UNRESOLVED, so the availability section may not
     claim a radius, a polygon, a ZIP rule, or that an address is OUT of area.
     This is the same limit the nine captions were held to. */
  it("draws no service-area boundary and rejects nothing", () => {
    for (const s of [SD.availability_headline, SD.availability_body, SD.availability_cta]) {
      expect(s, s).not.toMatch(/radius|polygon|\bZIP\b|zip code|\bmiles?\b/i);
      expect(s, s).not.toMatch(/out of (the )?(service )?area|not available in|ineligible|rejected/i);
    }
  });

  /* The example groups are EXAMPLES. Copy that promised eligibility would
     contradict the shipment policy, which decides per shipment after the
     description is read. */
  it("offers item examples without promising eligibility", () => {
    expect(SD.breadth_group_titles).toHaveLength(SD.breadth_group_bodies.length);
    expect(SD.breadth_group_titles.length).toBeGreaterThanOrEqual(4);
    expect(SD.breadth_disclaimer).toMatch(/not automatic approval/i);
    for (const s of [SD.breadth_headline, SD.breadth_lead, ...SD.breadth_group_bodies]) {
      expect(s, s).not.toMatch(/guarantee|always accepted|any item|anything you/i);
    }
  });

  /* The prohibited section names NO category. The categories render from
     PROHIBITED_CLASSES so the marketing page cannot drift from the policy the
     funnel enforces; a category typed into locked copy would be a second list.

     Scoped to EVERY same-day string, not just the four prohibition ones. The
     narrow version would have passed a category name smuggled into the breadth
     examples or the closing line, which is the same defect in a different key. */
  it("states the prohibition without re-listing the categories", () => {
    const strings = Object.values(SD).flatMap((v) => (Array.isArray(v) ? v : [v]));
    expect(strings.length).toBeGreaterThan(40);
    /* ALL 23 CANONICAL CLASSES, derived — not the seven that were hand-typed
       here. Sixteen were unguarded (cash, explosives, fuel, people, compressed
       gas, corrosive/toxic hazmat, prescription medication, controlled
       substances, illegal/stolen goods, negotiable instruments, biological
       specimens, infectious material, vaping/nicotine, regulated dangerous
       goods), so the exact drift this test exists to prevent — a second policy
       list typed into locked marketing copy — was only partially blocked. The
       list is now read from the vocabulary it is guarding, so a 24th class is
       covered the day it is added. */
    const categories = [
      ...PROHIBITED_CLASSES.map((c) => c.replace(/_/g, " ")),
      ...Object.values(PROHIBITED_LABELS),
    ];
    expect(categories.length).toBeGreaterThan(40);
    for (const s of strings) {
      for (const cat of categories) {
        /* WHOLE PHRASE, word-bounded. Splitting these on "_" and matching
           substrings was tried and is wrong twice over: "live" matches
           "Delivering", and "regulated" is a word `prohibited_body` is
           entitled to use generically ("certain regulated, hazardous or
           unusually high-risk items"). What may not appear is a CATEGORY —
           i.e. the phrase a hand-typed second list would actually contain. */
        const re = new RegExp(`\\b${cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        expect(re.test(s), `"${cat}" is typed into locked copy: ${s}`).toBe(false);
      }
    }
    expect(SD.prohibited_help).toMatch(/before you pay/i);
  });

  /* NO POLICY-DOCUMENT CTA while no policy document exists.
     MKT-ARCH §6 asks for "View Prohibited & Restricted Items Policy →" and
     says to take the destination from the legal registry rather than typing a
     URL. `lib/legal.ts` carries two effective dates and no such document, and
     no canonical screen owns that route — so the CTA would have been a dead
     link or a link to the LEGACY multi-product /terms page. It waits for the
     document, and this fails if the copy comes back before the destination. */
  it("promises no prohibited-items policy document that does not exist", () => {
    expect(SD).not.toHaveProperty("prohibited_cta");
    const strings = Object.values(SD).flatMap((v) => (Array.isArray(v) ? v : [v]));
    for (const s of strings) {
      expect(s, s).not.toMatch(/prohibited (&|and) restricted items policy/i);
      expect(s, s).not.toMatch(/shipment terms/i);
    }
  });

  /**
   * THE HANDOFF CLAIM LIMIT — the load-bearing assertion in this file.
   *
   * Value-tiered custody (a declared-value ceiling, numbered tamper-evident
   * seals, recipient identity verification) is NOT in this build. Copy that
   * described it would be a protection claim Couranr cannot honour, and it
   * would read as insurance. This fails the moment such a sentence is added
   * without the implementation.
   */
  it("claims only the handoff evidence this build records", () => {
    const all = [SD.handoff_heading, SD.handoff_body, SD.handoff_progressive, SD.handoff_honesty].join(" ");
    for (const forbidden of [
      "tamper", "seal", "identity verification", "verify your identity",
      "declared value", "insured", "insurance", "guarantee", "guaranteed",
      "fully protected", "verified authentic", "appraised", "certified",
    ]) {
      expect(all.toLowerCase(), `unsupported protection claim: "${forbidden}"`).not.toContain(forbidden);
    }
    // The honesty sentence is mandatory, not optional.
    expect(SD.handoff_honesty).toMatch(/does not authenticate, appraise or certify/i);
  });

  /**
   * THE DROP-OFF METHOD, CORRECTED 2026-09.
   *
   * This asserted `/\bor\b/` — that the copy offered alternatives — on the
   * reasoning that PRF-001 picks one of three methods per delivery and copy
   * must not promise all three. That is true of the driver PLATFORM and false
   * of the product THIS page sells: both consumer write paths pass a literal
   * `p_proof_method: "photo_or_pin"` (lib/couranr/consumer/send.ts) and
   * SendFlow exposes no choice, so on Same Day a signature and a leave-at-door
   * photograph can never occur. Offering three read as a menu the funnel does
   * not serve. The test now asserts the narrower truth, and — importantly —
   * FAILS if the three-method sentence comes back.
   */
  it("names only the drop-off method Same Day actually uses", () => {
    const h = SD.handoff_progressive.toLowerCase();
    expect(h).toMatch(/code/);
    // The two methods the Same Day funnel can never reach.
    expect(h, SD.handoff_progressive).not.toMatch(/signature/);
    expect(h, SD.handoff_progressive).not.toMatch(/photo at the door|leave (it )?at the door/);
    expect(h).not.toMatch(/every delivery (is|gets)|always (photograph|signed)/);
  });

  /**
   * TRACKING REACH. "Couranr gives the recipient a private tracking
   * experience" was false: a Same Day request carries null recipient name,
   * phone and email, and the link renders on the SENDER's confirmation screen.
   * Couranr has no channel to the recipient, so the copy may not say it
   * delivers anything to them.
   */
  it("does not claim Couranr reaches the recipient directly", () => {
    const t = SD.tracking_body.toLowerCase();
    expect(t).not.toMatch(/gps|second-by-second|live map|photo of every/);
    expect(t, SD.tracking_body).not.toMatch(/gives the recipient|sends? the recipient|notif\w* the recipient/);
  });

  it("keeps the business cross-link about purpose, never speed", () => {
    const all = [SD.crosslink_heading, SD.crosslink_body, SD.crosslink_cta].join(" ").toLowerCase();
    expect(all).not.toMatch(/faster|quicker|priority|speed|upgrade|tier/);
    expect(all).toMatch(/part of your business/);
  });
});
