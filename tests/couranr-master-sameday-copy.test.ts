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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { MKT_005_COPY, SAME_DAY_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { PROHIBITED_CLASSES } from "@/lib/couranr/shipment/facts";
import { PROHIBITED_LABELS } from "@/lib/couranr/public/prohibitedSummary";
import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_THRESHOLDS,
  deriveProtection,
} from "@/lib/couranr/consumer/protection";
import { LEGAL_DOCUMENTS } from "@/lib/couranr/legal/registry";

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

  /**
   * THE POLICY-DOCUMENT CTA, RESTORED 2026-09-17.
   *
   * WHAT CHANGED AND WHY. This case asserted that `SD` had NO `prohibited_cta`,
   * because MKT-ARCH §6 asked for one and there was no document to point it at:
   * `lib/legal.ts` carried two effective dates and nothing else, so the CTA
   * would have been a dead link or a link to the LEGACY multi-product /terms
   * page. The document exists now — `lib/couranr/legal/registry.ts` owns the
   * `prohibited-items` entry with a title, a slug, a version and
   * `acceptanceIsRecorded: true`, and `/legal/prohibited-items` renders it — so
   * the assertion is INVERTED rather than deleted. A CTA that disappears again
   * must fail.
   *
   * THE TWO REGEXES BELOW ARE UNCHANGED, and that is deliberate: they were
   * never about whether the document existed. They forbid TYPING the document's
   * name into locked copy, which is still the rule. The page renders the title
   * from the registry, so the name a visitor reads and the document behind the
   * link cannot become two different things.
   */
  it("carries the policy CTA without typing the document name", () => {
    expect(SD).toHaveProperty("prohibited_cta");
    expect(SD.prohibited_cta.length).toBeGreaterThan(4);
    const strings = Object.values(SD).flatMap((v) => (Array.isArray(v) ? v : [v]));
    for (const s of strings) {
      expect(s, s).not.toMatch(/prohibited (&|and) restricted items policy/i);
      expect(s, s).not.toMatch(/shipment terms/i);
    }
    /* The name has to actually live in the registry, or the negative above is
       satisfied by a registry entry that was renamed out from under the page —
       a green test over a link whose text no longer names the policy. Asserted
       against the SAME pattern the copy is forbidden to contain, so the two
       halves cannot drift apart. */
    expect(LEGAL_DOCUMENTS["prohibited-items"].title).toMatch(
      /prohibited (&|and) restricted items policy/i,
    );
  });

  /**
   * THE HANDOFF CLAIM LIMIT — the load-bearing assertion in this file.
   *
   * WHAT CHANGED AND WHY, 2026-09-17. This case forbade the words "tamper",
   * "seal" and "declared value" in the handoff copy on the ground that
   * value-tiered custody was "NOT in this build". It IS in this build:
   * `deriveProtection` derives standard / secure_pickup / protected_handoff
   * from the declared value, the SQL re-derives it, and
   * `private.couranr_enforce_consumer_custody_sequence` refuses the
   * at_pickup -> picked_up transition without the prepack photograph, the
   * sealed-package photograph, the seal bound to that photograph and the
   * sender's credential consumed LAST. Forbidding a sentence that is true is
   * the same defect as permitting one that is false, one direction over — so
   * the forbidden list keeps ONLY the claims that are still unsupported, and
   * the custody that is real is now asserted POSITIVELY. A page that quietly
   * drops back to silence about it fails here.
   *
   * THE ONE THAT MOVED FROM "unimplemented" TO "unavailable": recipient
   * identity verification. The adapter exists, Stripe Identity is not
   * activated, and `private.couranr_block_unavailable_protected_handoff`
   * refuses every consumer request at `protected_handoff`. So the copy may
   * describe SECURE PICKUP and may NOT offer protected handoff or an identity
   * check — that would sell a shipment the database refuses.
   */
  it("claims the custody this build performs, and no more", () => {
    const all = [
      SD.handoff_heading,
      SD.handoff_body,
      SD.handoff_progressive,
      SD.handoff_secure_pickup,
      SD.handoff_declared_value,
      SD.handoff_declared_value_close,
      SD.handoff_honesty,
    ].join(" ").toLowerCase();

    /* Still unsupported, every one. The insurance words were never about the
       custody tiers — a declared value is a sender representation, not cover —
       and the identity words describe a level no consumer request can leave
       draft at. */
    for (const forbidden of [
      "insured", "insurance", "guarantee", "guaranteed",
      "fully protected", "verified authentic", "appraised", "certified",
      "identity verification", "verify your identity", "verifies their identity",
      "protected handoff", "id check", "photo id",
    ]) {
      expect(all, `unsupported protection claim: "${forbidden}"`).not.toContain(forbidden);
    }

    /* POSITIVE, because a negative-only list is satisfied by saying nothing at
       all — which is exactly the state this correction is undoing. */
    expect(all, "the sealed-custody ceremony is no longer described").toContain(
      "tamper-evident seal",
    );
    expect(all, "the prepack documentation is no longer described").toContain(
      "before it is packed",
    );
    expect(all, "the sealed-package photograph is no longer described").toContain(
      "sealed package",
    );

    // The honesty sentence is mandatory, not optional. Unchanged.
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
    /* WIDENED 2026-09-17. It scanned `handoff_progressive` alone, which was the
       whole handoff paragraph at the time. The custody correction split that
       paragraph across four keys, and a scan of one of them would have passed a
       signature promised in any of the other three — the same defect in a
       different key, which is the note the prohibition scanner above already
       carries. */
    const h = [
      SD.handoff_progressive,
      SD.handoff_secure_pickup,
      SD.handoff_declared_value,
      SD.handoff_declared_value_close,
    ].join(" ").toLowerCase();
    expect(SD.handoff_progressive.toLowerCase()).toMatch(/code/);
    // The two methods the Same Day funnel can never reach.
    expect(h, SD.handoff_progressive).not.toMatch(/signature/);
    expect(h, SD.handoff_progressive).not.toMatch(/photo at the door|leave (it )?at the door/);
    expect(h).not.toMatch(/every delivery (is|gets)|always (photograph|signed)/);
  });

  /**
   * TRACKING REACH, INVERTED 2026-09-17.
   *
   * WHAT CHANGED AND WHY. This case asserted the copy may NOT say Couranr
   * reaches the recipient. That was correct when a Same Day request carried
   * null recipient name, phone and email and the tracking link rendered on the
   * SENDER's own confirmation screen. Both halves are false now:
   * `recipient_email` is REQUIRED — `lib/couranr/consumer/send.ts` fails
   * `recipient_email_required` without it — and
   * `lib/couranr/email/consumerLifecycle.ts` emails the recipient their own
   * private tracking link, then emails them again out-for-delivery and on
   * arrival. `getConsumerSendView` returns no tracking token at all.
   *
   * So the assertion inverts: the copy MUST say the recipient is reached, and
   * must NOT hand the sender a link the confirmation screen will never show
   * them. The GPS / live-map limits are untouched — they were never about
   * reach, and they are still claims this build cannot make.
   */
  it("gives the recipient their own tracking and promises the sender no link", () => {
    const t = SD.tracking_body.toLowerCase();
    expect(t).not.toMatch(/gps|second-by-second|live map|photo of every/);
    /* The correction, asserted positively — silence would pass a negative. */
    expect(t, SD.tracking_body).toMatch(/recipient/);
    /* The sender is never told they receive, keep or forward the recipient's
       link. getConsumerSendView deliberately returns none, so any of these
       would be a promise the confirmation screen cannot keep. */
    expect(t, SD.tracking_body).not.toMatch(
      /gives you a (private )?tracking link|your (own )?tracking link/,
    );
    expect(t, SD.tracking_body).not.toMatch(
      /to keep or to pass|forward (it|the link)|share (it|the link)|pass (it )?(on|to)/,
    );
  });

  it("keeps the business cross-link about purpose, never speed", () => {
    const all = [SD.crosslink_heading, SD.crosslink_body, SD.crosslink_cta].join(" ").toLowerCase();
    expect(all).not.toMatch(/faster|quicker|priority|speed|upgrade|tier/);
    expect(all).toMatch(/part of your business/);
  });
});

/**
 * THE TWO CUSTODY FIGURES ON PUB-013, AND THE TRIGGER THE SECOND ONE DEPENDS ON.
 *
 * NEW 2026-09-17, with the copy correction it guards. MKT-005 forbids a price
 * literal in a locked string, so the amounts cannot live in the copy — they are
 * composed on the page from `lib/couranr/consumer/protection.ts`, which is the
 * same module the server and the SQL derive from. This is the shape SEND_COPY's
 * `declared_value_max_note` already uses; without a test it is a convention, and
 * a convention is what a hardcoded "$150.00" quietly breaks.
 */
describe("PUB-013 renders its custody figures from authority", () => {
  const PAGE_PATH = "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx";
  const PAGE = readFileSync(path.join(ROOT, PAGE_PATH), "utf8");
  /* COMMENTS STRIPPED. The blocks above these renders name the constants and
     the route they replaced, and a raw scan reads the explanation as the
     violation it describes — the same lesson the category scanner in
     couranr-market-copy-surfaces.test.ts already wrote down. */
  const code = PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("composes both thresholds from the protection module and types neither", () => {
    expect(code).toContain("PROTECTION_THRESHOLDS.standardMaxCents");
    expect(code).toContain("PROTECTION_THRESHOLDS.securePickupMaxCents");
    expect(code).toContain("declaredValueDollars");
    expect(code, "a dollar amount is typed onto PUB-013").not.toMatch(/\$\s?\d/);
    // POSITIVE CONTROL: the comment stripper left the render intact.
    expect(code).toContain("SAME_DAY_COPY.handoff_secure_pickup");
    expect(code).toContain("SAME_DAY_COPY.handoff_declared_value");
  });

  it("links the policy through the legal registry, href and title alike", () => {
    expect(code).toContain('legalDocumentHref("prohibited-items")');
    expect(code).toContain('LEGAL_DOCUMENTS["prohibited-items"].title');
    expect(code, "the policy route is typed rather than resolved").not.toContain(
      "/legal/prohibited-items",
    );
    expect(code, "the policy title is typed rather than resolved").not.toContain(
      LEGAL_DOCUMENTS["prohibited-items"].title,
    );
  });

  /**
   * THE ACCEPTED MAXIMUM IS NOT THE POLICY MAXIMUM, and this is what keeps that
   * true.
   *
   * `deriveProtection` sends every value above `securePickupMaxCents` to
   * `protected_handoff`, and `private.couranr_block_unavailable_protected_handoff`
   * — an enabled trigger with no flag and no escape — raises
   * `protected_handoff_identity_unavailable` for any consumer request at that
   * level the moment it leaves draft. So `securePickupMaxCents` is the largest
   * declared value a customer can actually submit, and
   * `CONSUMER_MAX_DECLARED_VALUE_CENTS` is a ceiling nobody can reach.
   *
   * The day that trigger is dropped, protected handoff becomes buyable and this
   * page starts UNDER-stating what Couranr accepts. Nothing else in the suite
   * connects a migration to the marketing sentence it invalidates, so this
   * assertion is that link: a migration that removes the block turns it red and
   * forces the copy to be revisited rather than left quietly stale.
   */
  it("states the maximum a customer can submit, not the policy ceiling", () => {
    const at = deriveProtection(PROTECTION_THRESHOLDS.securePickupMaxCents);
    const over = deriveProtection(PROTECTION_THRESHOLDS.securePickupMaxCents + 1);
    expect(at).toMatchObject({ ok: true, requirements: { level: "secure_pickup" } });
    expect(over).toMatchObject({ ok: true, requirements: { level: "protected_handoff" } });
    expect(PROTECTION_THRESHOLDS.securePickupMaxCents).toBeLessThan(
      CONSUMER_MAX_DECLARED_VALUE_CENTS,
    );

    const MIGRATIONS = path.join(ROOT, "supabase/migrations");
    const TRIGGER = "couranr_dr_block_unavailable_protected_handoff";
    const creators: string[] = [];
    const droppers: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      const creates = new RegExp(`create trigger\\s+${TRIGGER}`, "i").test(sql);
      const drops = new RegExp(`drop trigger[^;]*${TRIGGER}`, "i").test(sql);
      if (creates) creators.push(f);
      /* The idempotent `drop if exists` that PRECEDES a create is not a
         removal. Only a drop with no create beside it retires the block. */
      if (drops && !creates) droppers.push(f);
    }
    // POSITIVE CONTROL: a negative result here is a claim about the scan first.
    expect(creators.length, "the scan cannot find the trigger at all").toBeGreaterThan(0);
    expect(
      droppers,
      "protected handoff was activated — PUB-013 now understates the accepted maximum",
    ).toEqual([]);
  });
});
