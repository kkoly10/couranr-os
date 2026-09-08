import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES, GENERAL_CATEGORY } from "@/lib/couranr/categories/registry";
import {
  BUSINESSES_STRIP_PHOTOS,
  CATEGORY_BREADTH_PHOTOS,
  CONFIRMATION_PHOTO,
  OUTCOME_PRIMARY_PHOTO,
  OUTCOME_SUPPORTING_PHOTO,
  CATEGORY_SYSTEM_PHOTOS,
  PROOF_ARTIFACT_PHOTOS,
  RESERVE_PHOTO_IDS,
  SERVICE_CORRIDOR_MAP,
  intrinsic,
  largestSrc,
  srcSetFor,
  type MarketingPhoto,
} from "@/lib/couranr/public/marketingPhotos";

/**
 * The owner-accepted 2026-08-28 photography, held to the decisions that
 * accepted it.
 *
 * There are THREE independent records of this set — the render-time module the
 * pages import, the generator that writes the visual-authority registry, and
 * `OWNER_VISUAL_DECISION_2026-08-28.md`'s counts. Nothing made them agree.
 * Alt text in particular is the kind of string that gets retyped and quietly
 * drifts from the description the owner approved.
 *
 * The evidence boundary is the part worth a test rather than a comment.
 * Couranr has no owner-approved delivery evidence, so no alt string may say or
 * imply that a photograph shows a Couranr customer, a Couranr delivery or a
 * Couranr driver. That is a claim, and a claim in an alt attribute is still a
 * claim — it is what a screen-reader user is told the picture is.
 */

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = JSON.parse(
  readFileSync(path.join(ROOT, "docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json"), "utf8"),
) as { photography: Array<Record<string, unknown>> };

const HOMEPAGE = [
  ...CATEGORY_BREADTH_PHOTOS,
  OUTCOME_PRIMARY_PHOTO,
  OUTCOME_SUPPORTING_PHOTO,
];
const ALL = [...HOMEPAGE, ...BUSINESSES_STRIP_PHOTOS, CONFIRMATION_PHOTO];

const accepted = new Map(
  REGISTRY.photography
    .filter((p) => String(p.asset_id).startsWith("couranr-mkt-2026-08-"))
    .map((p) => [String(p.asset_id), p]),
);

describe("the 2026-08-28 marketing photography", () => {
  it("registers every accepted asset, used and reserve", () => {
    // 11 accepted 2026-08-28, plus 4 accepted 2026-08-29, plus the 3 consumer
    // photographs the owner delivered with the V10 work order on 2026-08-30.
    // The number moves only when the owner accepts more; it is asserted so a
    // silently-added asset fails rather than appearing.
    expect(accepted.size).toBe(18);

    /* The three V10 consumer photographs, named so the count above cannot be
       satisfied by three DIFFERENT assets. Each carries its locked alt text and
       claims only the surfaces MKT-004 gave it. */
    const CONSUMER = {
      "couranr-mkt-2026-08-consumer-doorstep-handoff": ["PUB-012", "PUB-013"],
      "couranr-mkt-2026-08-consumer-dry-cleaning-pickup": ["PUB-013"],
      "couranr-mkt-2026-08-consumer-send-from-office": ["PUB-013"],
    };
    for (const [id, surfaces] of Object.entries(CONSUMER)) {
      const rec = accepted.get(id);
      expect(rec, `${id} is not in the registry`).toBeDefined();
      expect(rec!.status, `${id}`).toBe("approved");
      expect(rec!.allowed_surfaces, `${id} surfaces`).toEqual(surfaces);
      expect(String(rec!.alt).length, `${id} has no alt text`).toBeGreaterThan(20);
    }

    /* PUB-012's business door reuses an ALREADY approved Business photograph
       rather than generating a new one — the work order's instruction, and the
       reason its allowed surfaces had to widen rather than a duplicate asset
       being registered. */
    const gift = accepted.get("couranr-mkt-2026-08-gift-stationery");
    expect(gift!.allowed_surfaces).toEqual(["PUB-009", "PUB-012"]);
    for (const id of RESERVE_PHOTO_IDS) {
      const rec = accepted.get(id);
      expect(rec, `${id} is not in the registry`).toBeDefined();
      // A reserve is accepted and deliberately unused. Recording it as
      // `approved` with no surfaces would read as an oversight.
      expect(rec!.status, `${id}`).toBe("approved-reserve");
      expect(rec!.allowed_surfaces, `${id} must claim no surface`).toEqual([]);
    }
  });

  /**
   * The counts OWNER_VISUAL_DECISION_2026-08-28.md fixes. These are not
   * stylistic: ADVERSARIAL_REVIEW.md records "all eleven photos on the
   * homepage" as the rejected package's first and worst defect, so the homepage
   * total is a decision with a number, and a number can be asserted.
   */
  it("uses exactly the locked counts — 4 + 2 on the homepage, 3 on /businesses, 1 on /how-it-works", () => {
    expect(CATEGORY_BREADTH_PHOTOS).toHaveLength(4);
    // 4 category-breadth + 2 outcomes. An order-channels inset was added on
    // 2026-08-29 and REMOVED the same day on owner instruction — the
    // photograph made the section look awkward — so the homepage total is
    // back to the locked six.
    expect(HOMEPAGE).toHaveLength(6);
    expect(BUSINESSES_STRIP_PHOTOS).toHaveLength(3);
    expect(CONFIRMATION_PHOTO).toBeDefined();
    expect(ALL).toHaveLength(10);
    expect(new Set(ALL.map((p) => p.id)).size).toBe(10);
  });

  it("keeps the reserves off the site", () => {
    for (const id of RESERVE_PHOTO_IDS) {
      expect(ALL.map((p) => p.id), `${id} is a reserve and must not be rendered`).not.toContain(id);
    }
  });

  it("renders each asset only on the surface the registry allows", () => {
    const surfaceOf = (p: MarketingPhoto) =>
      BUSINESSES_STRIP_PHOTOS.includes(p)
        ? "PUB-009"
        : p === CONFIRMATION_PHOTO
          ? "PUB-011"
          : "PUB-001";
    for (const p of ALL) {
      const rec = accepted.get(p.id);
      expect(rec, `${p.id} is rendered but not registered`).toBeDefined();
      expect(rec!.allowed_surfaces, `${p.id}`).toContain(surfaceOf(p));
    }
  });

  it("carries the same alt text the registry records", () => {
    for (const p of ALL) {
      expect(accepted.get(p.id)!.alt, `${p.id} alt drifted from the registry`).toBe(p.alt);
    }
  });

  /**
   * The evidence boundary, as an assertion. Every one of these words would turn
   * a category illustration into a claim about a delivery that did not happen.
   */
  it("claims nothing — no alt string implies Couranr evidence", () => {
    const banned = /\b(couranr|driver|courier|delivered|delivery|parcel|package|our customer|client)\b/i;
    const offenders = ALL.filter((p) => banned.test(p.alt)).map((p) => `${p.id}: "${p.alt}"`);
    expect(offenders).toEqual([]);
  });

  it("gives every photograph a real description", () => {
    for (const p of ALL) {
      expect(p.alt.length, `${p.id} alt is too short to describe anything`).toBeGreaterThan(25);
      expect(p.alt.trim().endsWith("."), `${p.id} alt is not a sentence`).toBe(true);
      // "Image of", "Photo of" — a screen reader already says it is an image.
      expect(p.alt, `${p.id}`).not.toMatch(/^(image|photo|picture) of/i);
    }
  });

  /**
   * Every file the pages ask the browser for has to exist. A 404 on a
   * `srcSet` candidate is invisible in development — the browser silently falls
   * back to another width — and shows up as a blank frame only at the width
   * that picks the missing file.
   */
  it("every derivative it references exists on disk", () => {
    const missing: string[] = [];
    for (const p of ALL) {
      const shapes: Array<"wide" | "square"> = p.square ? ["wide", "square"] : ["wide"];
      for (const shape of shapes) {
        for (const entry of srcSetFor(p, shape).split(", ")) {
          const file = entry.split(" ")[0];
          if (!existsSync(path.join(ROOT, "public", file))) missing.push(file);
        }
      }
      if (!existsSync(path.join(ROOT, "public", largestSrc(p)))) missing.push(largestSrc(p));
    }
    expect(missing).toEqual([]);
  });

  it("keeps the accepted sources installed and unmodified in shape", () => {
    for (const p of ALL) {
      const src = accepted.get(p.id)!.derived_from as string;
      expect(src, `${p.id}`).toMatch(/^public\/images\/marketing\/2026-08\/[0-9]{2}-[a-z-]+\.png$/);
      expect(existsSync(path.join(ROOT, src)), `${src} is missing`).toBe(true);
    }
  });

  it("declares intrinsic dimensions so no frame reflows on load", () => {
    for (const p of ALL) {
      const box = intrinsic(p);
      expect(box.width, `${p.id}`).toBeGreaterThan(0);
      expect(box.height, `${p.id}`).toBeGreaterThan(0);
      const [rw, rh] = p.wide.ratio;
      expect(Math.abs(box.width / box.height - rw / rh), `${p.id} box is not its ratio`).toBeLessThan(0.02);
    }
  });
});

/* ── the 2026-09 product-surface set: DECORATIVE ──────────────────────────
   The 2026-08 rule above bans nine words from an alt string because that set is
   CATEGORY illustration: a photograph of a shop that said "delivery" would have
   implied a delivery that did not happen. The owner narrowed that rule for this
   set on 2026-09-08, and these five were first written with descriptive alt
   text under the narrowed rule.

   Reviewing the rendered markup is what changed it, and the change is the
   finding rather than a preference. The four proof frames sit in a list headed
   "What Couranr records as proof", each beside its own label and detail —
   "Recipient PIN" / "Four digits, verified at the door" — which carry the whole
   product fact in text. So describing the scene did two unwanted things at
   once: it repeated information a screen-reader user had already been given,
   and, under that heading, it asserted the frame IS a Couranr delivery, which
   is a stronger claim than a sighted reader takes from the same picture.

   W3C WAI's decorative-images tutorial is the ordinary rule for exactly this
   shape — an image "already sufficiently described by the adjacent text" takes
   a null alt — so all five now carry alt="".
   https://www.w3.org/WAI/tutorials/images/decorative/

   These assertions are therefore about SILENCE, not wording. A word ban over a
   set of empty strings is a test that cannot fail, which is the failure mode
   this file has already been bitten by; what is worth guarding is that the
   emptiness is deliberate, recorded, and cannot be reverted in one file alone. */
describe("the 2026-09 product-surface set", () => {
  const NEW = [...PROOF_ARTIFACT_PHOTOS, SERVICE_CORRIDOR_MAP];

  it("is the five frames the sections render, with unique ids", () => {
    expect(PROOF_ARTIFACT_PHOTOS).toHaveLength(4);
    expect(new Set(NEW.map((p) => p.id)).size).toBe(5);
    for (const p of NEW) expect(p.id.startsWith("couranr-mkt-2026-09-"), p.id).toBe(true);
  });

  it("renders every one of them decoratively", () => {
    for (const p of NEW) expect(p.alt, `${p.id} must carry alt=""`).toBe("");
  });

  it("serves derivatives that exist on disk", () => {
    for (const p of NEW) {
      for (const url of [largestSrc(p), ...srcSetFor(p, "wide").split(", ").map((s) => s.split(" ")[0])]) {
        expect(existsSync(path.join(ROOT, "public", url)), `${p.id}: ${url} is missing`).toBe(true);
      }
    }
  });

  it("reserves a box before the image decodes", () => {
    // The mosaic cost 232px of layout shift across four frames when a dimension
    // was missing. Every one of these renders width/height from `intrinsic`.
    for (const p of NEW) {
      const box = intrinsic(p);
      expect(box.width, p.id).toBeGreaterThan(0);
      expect(box.height, p.id).toBeGreaterThan(0);
    }
  });

  it("renders the record's alt, never a literal typed into the page", () => {
    /* The three assertions above guarantee the RECORD is empty. They say
       nothing about the page, and the page is what ships — `alt="a courier
       enters…"` typed straight into the JSX would satisfy every one of them
       while putting the claim back on the surface.

       So this reads the source. PUB-001 is the only surface these five are
       allowed on, and both call sites must take the string from the record. */
    const page = readFileSync(
      path.join(ROOT, "app/(couranr)/(public)/(business-public)/business/page.tsx"),
      "utf8",
    );
    expect(page, "the proof chip must render a.photo.alt").toContain("alt={a.photo.alt}");
    // The corridor map is a single element, so its empty alt is written out.
    expect(page).toMatch(/className="cr-mkt-map"[\s\S]{0,400}?alt=""/);
    // And no literal from the retired descriptive set survives anywhere in it.
    for (const phrase of [
      "enters a four-digit code",
      "sealed cardboard box on a doormat",
      "phone showing a map pin",
      "signs with a fingertip",
    ]) {
      expect(page, `"${phrase}" is a retired alt string and must not be in the page`)
        .not.toContain(phrase);
    }
  });

  it("keeps its sources unmodified in the 2026-09 batch", () => {
    for (const slug of [
      "09-proof-pin", "10-proof-photo", "11-proof-location",
      "12-proof-signature", "13-service-corridor-map",
    ]) {
      expect(
        existsSync(path.join(ROOT, `public/images/marketing/2026-09/${slug}.png`)),
        `${slug}.png source is missing`,
      ).toBe(true);
    }
  });
});

/* ── the eight category frames, which no module imports yet ────────────────
   They are OWNER-ACCEPTED for PUB-001's "Built for real local businesses"
   grid and the grid that renders them is not built. Their alt text therefore
   lives only in the visual-authority registry right now, which is exactly the
   condition under which a claim goes unnoticed: the 2026-08 boundary test
   reads marketingPhotos.ts, and these are not in it.

   So they are policed from the REGISTRY, and under the STRICT 2026-08 rule
   rather than the narrowed one — these are category illustrations, the same
   class the word ban was written for. A photograph of a boutique that said
   "delivery" would claim a delivery that did not happen, and it would say so
   in the attribute a screen-reader user hears. */
describe("the 2026-09 category frames, in the registry", () => {
  const CATEGORY_IDS = [
    "couranr-mkt-2026-09-print-signage",
    "couranr-mkt-2026-09-event-rentals",
    "couranr-mkt-2026-09-boutique-apparel",
    "couranr-mkt-2026-09-auto-parts",
    "couranr-mkt-2026-09-repair-electronics",
    "couranr-mkt-2026-09-bakery-catering",
    "couranr-mkt-2026-09-florist-gifts",
    "couranr-mkt-2026-09-dry-cleaning-counter",
    "couranr-mkt-2026-09-books-cards-hobby",
    "couranr-mkt-2026-09-furniture-home-goods",
  ];

  const batch09 = REGISTRY.photography.filter((p) =>
    String(p.asset_id).startsWith("couranr-mkt-2026-09-"),
  );
  const byId = new Map(batch09.map((p) => [String(p.asset_id), p]));

  it("registers all fifteen 2026-09 assets", () => {
    /* Asserted as a number so an asset added without provenance fails rather
       than appearing. It moves only when the owner accepts more — it went 13 →
       15 on 2026-09-08 when the last two category frames arrived. */
    expect(batch09).toHaveLength(15);
    for (const id of [
      ...CATEGORY_IDS,
      "couranr-mkt-2026-09-books-cards-hobby",
      "couranr-mkt-2026-09-furniture-home-goods",
      ...PROOF_ARTIFACT_PHOTOS.map((p) => p.id),
      SERVICE_CORRIDOR_MAP.id,
    ]) {
      expect(byId.get(id), `${id} is not in the visual-authority registry`).toBeDefined();
    }
  });

  it("carries provenance and a licence record on every one", () => {
    for (const p of batch09) {
      expect(p.source, `${p.asset_id}`).toBe("owner-supplied-2026-09-08");
      expect(String(p.license_record).length, `${p.asset_id}`).toBeGreaterThan(20);
      expect(String(p.subject).length, `${p.asset_id}`).toBeGreaterThan(20);
      expect(p.allowed_surfaces, `${p.asset_id}`).toEqual(["PUB-001"]);
      expect(p.status, `${p.asset_id}`).toBe("approved");
    }
  });

  it("holds the eight category alts to the STRICT 2026-08 boundary", () => {
    const banned =
      /\b(couranr|driver|courier|delivered|delivery|parcel|package|our customer|client)\b/i;
    const offenders = CATEGORY_IDS.map((id) => byId.get(id)!)
      .filter((p) => banned.test(String(p.alt)))
      .map((p) => `${p.asset_id}: "${p.alt}"`);
    expect(offenders).toEqual([]);
  });

  it("gives each category frame a real description", () => {
    for (const id of CATEGORY_IDS) {
      const alt = String(byId.get(id)!.alt);
      expect(alt.length, `${id} alt is too short to describe anything`).toBeGreaterThan(25);
      expect(alt.trim().endsWith("."), `${id} alt is not a sentence`).toBe(true);
      expect(alt, id).not.toMatch(/^(image|photo|picture) of/i);
    }
  });

  it("keeps the registry alt and the rendered alt identical for the placed five", () => {
    // The 2026-08 set has this check; without it here, an alt edited in one
    // place drifts from the other and the registry stops being the record.
    for (const p of [...PROOF_ARTIFACT_PHOTOS, SERVICE_CORRIDOR_MAP]) {
      expect(byId.get(p.id)!.alt, `${p.id} alt drifted from the registry`).toBe(p.alt);
    }
  });

  it("records every empty alt as a decision, not an omission", () => {
    /* An empty alt is indistinguishable from a forgotten one unless something
       says why, so the reason is a FIELD on each asset and this is what makes
       it load-bearing. All five product-surface frames are decorative; the
       eight category frames are not, and are asserted to carry real strings
       above. */
    for (const p of [...PROOF_ARTIFACT_PHOTOS, SERVICE_CORRIDOR_MAP]) {
      const rec = byId.get(p.id)!;
      expect(rec.alt, `${p.id}`).toBe("");
      expect(
        String(rec.alt_note ?? "").length,
        `${p.id}: an empty alt needs its reason on record`,
      ).toBeGreaterThan(60);
    }

    /* Scoped to the 2026-09 batch, and NOT to the whole registry, because
       running it registry-wide surfaced a separate pre-existing gap worth
       naming rather than quietly absorbing: photo-florist-driver-handoff-wide
       and -portrait carry no `alt` key at all. Those are the PUB-001 hero
       frames; their alt text is real but lives in the page
       (business/page.tsx), so it can drift from the registry with nothing to
       catch it. Widening this assertion would fail on that gap and invite
       someone to close it by pasting a string in — which is a registry change
       about owner-approved hero copy, not this batch's work. */
    const decorative = new Set([...PROOF_ARTIFACT_PHOTOS.map((p) => p.id), SERVICE_CORRIDOR_MAP.id]);
    const unexplained = batch09.filter(
      (p) => !decorative.has(String(p.asset_id)) && !String(p.alt ?? "").trim(),
    );
    expect(unexplained.map((p) => p.asset_id)).toEqual([]);
  });
});

/* ── PUB-001 section 9's image-based category system ───────────────────────
   Ten photographs, one per real business category, adopted on owner
   instruction 2026-09-08. §27 Section 9 always sanctioned this device; what
   arrived was the photography.

   The pairing is the thing worth guarding. A card showing a bakery under the
   label "Furniture and home goods" is the defect this section can actually
   have, and no assertion about counts would catch it. */
describe("the category system", () => {
  const CATS = Object.keys(CATEGORY_SYSTEM_PHOTOS) as Array<
    keyof typeof CATEGORY_SYSTEM_PHOTOS
  >;

  it("covers every real category exactly once, and not the fallback", () => {
    /* Exhaustiveness is a TYPE guarantee — the map is
       Record<Exclude<BusinessCategory, typeof GENERAL_CATEGORY>, MarketingPhoto>
       and lib/couranr/** compiles strict — so a missing category fails
       typecheck:canonical, not here. What this adds is the other direction and
       the fallback's absence, neither of which the type says. */
    expect(CATS).toHaveLength(BUSINESS_CATEGORIES.length - 1);
    expect(CATS).not.toContain(GENERAL_CATEGORY);
    for (const c of BUSINESS_CATEGORIES) {
      if (c === GENERAL_CATEGORY) continue;
      expect(CATS, `${c} has no photograph`).toContain(c);
    }
    expect(new Set(CATS.map((c) => CATEGORY_SYSTEM_PHOTOS[c].id)).size).toBe(10);
  });

  it("keeps GENERAL_CATEGORY's literal type, which the exhaustive map needs", () => {
    /* THIS IS THE ONE THAT WAS WRONG. The map is typed
       Record<Exclude<BusinessCategory, typeof GENERAL_CATEGORY>, MarketingPhoto>
       and the constant was declared `: BusinessCategory` — the WHOLE union — so
       Exclude evaluated to `never`, `Record<never, T>` accepts any object, and
       the compile-time exhaustiveness this file advertises enforced nothing at
       all. It was caught by `tsc` complaining about `never` in this very file,
       not by any assertion.

       A widening is invisible at runtime, so this reads the source. `satisfies`
       still proves membership in the union; `as const` keeps the literal.
       Re-verified by mutation: dropping a category from the map, and adding an
       eleventh to the registry, both now fail `typecheck:canonical`. */
    const src = readFileSync(path.join(ROOT, "lib/couranr/categories/registry.ts"), "utf8");
    expect(src).toContain('export const GENERAL_CATEGORY = "general_local_business" as const satisfies BusinessCategory');
    expect(src, "a plain annotation re-widens it and the map stops checking")
      .not.toMatch(/export const GENERAL_CATEGORY\s*:\s*BusinessCategory\s*=/);
  });

  it("pairs each photograph with the category it actually shows", () => {
    /* The failure this catches is a bakery under "Furniture and home goods".
       Each entry names the noun the frame must depict, checked against the
       asset id and the alt — the two places the subject is written down. */
    const SHOWS: Record<string, RegExp> = {
      dry_cleaning_laundry_tailoring: /dry.?clean/i,
      printing_signage_promotional: /print/i,
      boutique_clothing_shoes_accessories: /boutique/i,
      florists_gifts_specialty_retail: /florist/i,
      repair_and_electronics: /repair/i,
      auto_parts_and_accessories: /auto.?parts/i,
      furniture_and_home_goods: /furniture|home.?goods/i,
      event_rentals_and_supplies: /event.?rental/i,
      bakeries_prepared_food_catering: /baker|catering/i,
      books_cards_collectibles_hobby: /book/i,
    };
    for (const c of CATS) {
      const p = CATEGORY_SYSTEM_PHOTOS[c];
      const want = SHOWS[c];
      expect(want, `${c} has no expected subject`).toBeDefined();
      expect(p.id, `${c} is paired with ${p.id}`).toMatch(want);
      expect(p.alt, `${c}: "${p.alt}"`).toMatch(want);
    }
  });

  it("keeps the STRICT evidence boundary — these are category illustration", () => {
    // Not the narrowed rule the proof artifacts got. A shop photograph that
    // said "delivery" would claim a delivery that did not happen.
    const banned = /\b(couranr|driver|courier|delivered|delivery|parcel|package|our customer|client)\b/i;
    const offenders = CATS.map((c) => CATEGORY_SYSTEM_PHOTOS[c])
      .filter((p) => banned.test(p.alt))
      .map((p) => `${p.id}: "${p.alt}"`);
    expect(offenders).toEqual([]);
  });

  it("describes each frame — these are NOT decorative", () => {
    /* The proof chips are decorative because their label states the fact. Here
       the label names a CATEGORY and the photograph shows a specific trade at
       work, which the label does not carry — so W3C WAI's adjacent-text test
       comes out the other way and each frame needs a real description. */
    for (const c of CATS) {
      const p = CATEGORY_SYSTEM_PHOTOS[c];
      expect(p.alt.length, `${p.id} alt is too short to describe anything`).toBeGreaterThan(25);
      expect(p.alt.trim().endsWith("."), `${p.id} alt is not a sentence`).toBe(true);
      expect(p.alt, p.id).not.toMatch(/^(image|photo|picture) of/i);
    }
  });

  it("serves BOTH crops, and every candidate exists on disk", () => {
    /* This is the assertion that caught the real one. The narrow crop builds
       as `thumb` in this batch, and srcSetFor's square slot had no per-asset
       shape override, so it asked for `-square-160.webp` — a file that does
       not exist. A missing srcSet candidate fails SILENTLY: the browser picks
       another width, so it shows only as a blurry card at exactly the widths
       that select the small crop. */
    const missing: string[] = [];
    for (const c of CATS) {
      const p = CATEGORY_SYSTEM_PHOTOS[c];
      const urls = [
        largestSrc(p),
        ...srcSetFor(p, "wide").split(", ").map((e) => e.split(" ")[0]),
        ...srcSetFor(p, "square").split(", ").map((e) => e.split(" ")[0]),
      ];
      for (const u of urls) if (!existsSync(path.join(ROOT, "public", u))) missing.push(`${c}: ${u}`);
    }
    expect(missing).toEqual([]);
  });

  it("reserves BOTH boxes, so the art-directed swap costs no layout shift", () => {
    // The mosaic measured 232px of shift across four frames when only the img
    // carried dimensions. There are ten frames here.
    for (const c of CATS) {
      const p = CATEGORY_SYSTEM_PHOTOS[c];
      for (const shape of ["wide", "square"] as const) {
        const box = intrinsic(p, shape);
        expect(box.width, `${p.id} ${shape}`).toBeGreaterThan(0);
        expect(box.height, `${p.id} ${shape}`).toBeGreaterThan(0);
      }
      expect(intrinsic(p, "square").width).toBe(intrinsic(p, "square").height);
    }
  });

  it("registers all ten, and renders each only where the registry allows", () => {
    const reg = new Map(REGISTRY.photography.map((p) => [String(p.asset_id), p]));
    for (const c of CATS) {
      const p = CATEGORY_SYSTEM_PHOTOS[c];
      const rec = reg.get(p.id);
      expect(rec, `${p.id} is rendered but not registered`).toBeDefined();
      expect(rec!.allowed_surfaces, p.id).toContain("PUB-001");
      expect(rec!.alt, `${p.id} alt drifted from the registry`).toBe(p.alt);
    }
  });

  it("renders as a list of eleven non-interactive items", () => {
    /* "Preserve keyboard/focus/click behavior" resolved to: there is none, and
       adding some would be the regression. A category is chosen at sign-up.
       A card that looks pressable and is not is worse than a plain card. */
    const page = readFileSync(
      path.join(ROOT, "app/(couranr)/(public)/(business-public)/business/page.tsx"),
      "utf8",
    );
    const grid = page.slice(page.indexOf('className="cr-mkt-catgrid"'));
    const section = grid.slice(0, grid.indexOf("</ul>"));
    for (const interactive of ["<a ", "<Link", "<button", "onClick", "tabIndex", "role="]) {
      expect(section, `the category grid must not become ${interactive}`).not.toContain(interactive);
    }
    // The fallback is the eleventh ITEM, inside the list — lifting it out would
    // tell a screen reader there are ten categories.
    expect(section).toContain("cr-mkt-catgrid__item--general");
    expect(section).toContain("CATEGORY_LABELS[GENERAL_CATEGORY]");
  });
});
