import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESSES_STRIP_PHOTOS,
  CATEGORY_BREADTH_PHOTOS,
  CHANNELS_INSET_PHOTO,
  CONFIRMATION_PHOTO,
  OUTCOME_PRIMARY_PHOTO,
  OUTCOME_SUPPORTING_PHOTO,
  RESERVE_PHOTO_IDS,
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
  CHANNELS_INSET_PHOTO,
];
const ALL = [...HOMEPAGE, ...BUSINESSES_STRIP_PHOTOS, CONFIRMATION_PHOTO];

const accepted = new Map(
  REGISTRY.photography
    .filter((p) => String(p.asset_id).startsWith("couranr-mkt-2026-08-"))
    .map((p) => [String(p.asset_id), p]),
);

describe("the 2026-08-28 marketing photography", () => {
  it("registers every accepted asset, used and reserve", () => {
    // 11 accepted 2026-08-28, plus 4 accepted 2026-08-29. The number moves only
    // when the owner accepts more; it is asserted so a silently-added asset
    // fails rather than appearing.
    expect(accepted.size).toBe(15);
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
  it("uses exactly the locked counts — 4 + 2 + 1 on the homepage, 3 on /businesses, 1 on /how-it-works", () => {
    expect(CATEGORY_BREADTH_PHOTOS).toHaveLength(4);
    // 4 category-breadth + 2 outcomes + 1 order-channels inset.
    expect(HOMEPAGE).toHaveLength(7);
    expect(BUSINESSES_STRIP_PHOTOS).toHaveLength(3);
    expect(CONFIRMATION_PHOTO).toBeDefined();
    expect(ALL).toHaveLength(11);
    expect(new Set(ALL.map((p) => p.id)).size).toBe(11);
  });

  it("keeps the two reserves off the site", () => {
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
