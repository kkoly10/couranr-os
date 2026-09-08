#!/usr/bin/env node
/**
 * Builds the responsive WebP derivatives the public marketing pages serve, from
 * the owner-accepted source PNGs in `public/images/marketing/2026-08/`.
 *
 * WHY A SCRIPT AND NOT A ONE-OFF. The repo has no build-time image pipeline —
 * `next.config.js` sets no `images` config and every existing photograph is a
 * pre-generated `.webp` committed beside a `<picture>` element. That works, but
 * it means a crop is only reproducible if the command that made it is in the
 * tree. The hero's four derivatives are not: nobody can re-cut them from the
 * source without re-deriving the numbers. These are.
 *
 * WHY THE CROPS ARE NOT `fit: "cover"` ALONE. Ten of the eleven accepted
 * sources are 4:3 (1448x1086); only the bakery is natively 3:2. Every 3:2
 * derivative therefore discards about 11% of the frame's height, and a centred
 * crop is a coin flip on whether it lands on the subject. `ASSET_PROVENANCE.json`
 * carries an owner-supplied focal point per asset, so the crop window is
 * positioned about that point and clamped to the source bounds.
 *
 * WHY SQUARE MOBILE DERIVATIVES EXIST. The category-breadth mosaic is four
 * frames. At 1440 each is ~300px wide; at 390 a shrunk desktop mosaic would put
 * them at ~175px, where a person two thirds of the way into a 3:2 frame becomes
 * unreadable. IMPLEMENTATION_SPEC.md §5.3 names this directly: "do not shrink
 * the desktop mosaic until faces become tiny." A 1:1 crop about the same focal
 * point keeps the subject at the same apparent size in a narrower box, which is
 * art direction rather than a resize — the same reason the PUB-001 hero carries
 * a portrait source.
 *
 * Sources are never modified. Run `node scripts/buildMarketingImages.mjs`;
 * `--check` verifies every expected derivative exists and is current without
 * writing.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
/* Batch-aware. Every asset without an explicit `batch` is 2026-08, so the
   accepted set installed on 2026-08-28 keeps its exact paths and filenames and
   its derivatives are byte-identical. The 2026-09 category batch is additive. */
const DEFAULT_BATCH = "2026-08";
const srcDir = (batch = DEFAULT_BATCH) => `public/images/marketing/${batch}`;
const outDir = (batch = DEFAULT_BATCH) => `public/images/marketing/${batch}/w`;

/**
 * Focal points are copied from the package's `ASSET_PROVENANCE.json`, which is
 * the owner's handoff record. They are a starting point, not a guarantee: every
 * derivative in this table was inspected after generation and the ones that
 * clipped a hand or a face were re-cut, with the deviation noted here.
 */
const CATEGORY_DERIVATIVES = [
  /* Desktop/tablet card. 4:3 into a 4:3 source — a resize, not a crop, so no
     part of any frame is discarded at these widths. */
  { shape: "card", aspect: 4 / 3, widths: [400, 800] },
  /* Mobile media-card thumbnail. The compact row puts a ~130px-wide image
     beside the text, where a shrunk 4:3 makes the subject unreadable. A 1:1
     crop about the focal point holds the subject at the same apparent size in
     a narrower box — the same art-direction reason the mosaic carries squares. */
  { shape: "thumb", aspect: 1, widths: [160, 320] },
];

const ASSETS = [
  /* ── the 2026-09 category batch ───────────────────────────────────────────
     Eight frames supplied by the owner on 2026-09-08, all 1448x1086 (4:3),
     the same native aspect as the 2026-08 set. They fill the two categories
     the accepted set could not serve at all — auto parts and event rentals —
     and give bakeries a frame that shows catering, which the 2026-08 bakery
     (allowed_surfaces PUB-009) does not. */
  {
    batch: "2026-09",
    slug: "print-signage",
    src: "01-print-signage.png",
    /* Operator right of centre, print roll filling the lower left. Held on her
       face so the 1:1 thumb does not become an abstract of the paper. */
    focal: { x: 0.46, y: 0.34 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "event-rentals",
    src: "02-event-rentals.png",
    focal: { x: 0.41, y: 0.38 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "boutique-apparel",
    src: "03-boutique-apparel.png",
    focal: { x: 0.53, y: 0.36 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "auto-parts",
    src: "04-auto-parts.png",
    /* Between his face and the box in his hands; centring on either alone
       loses the other from the square. */
    focal: { x: 0.50, y: 0.33 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "repair-electronics",
    src: "05-repair-electronics.png",
    focal: { x: 0.55, y: 0.42 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "bakery-catering",
    src: "06-bakery-catering.png",
    focal: { x: 0.47, y: 0.40 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "florist-gifts",
    src: "07-florist-gifts.png",
    focal: { x: 0.45, y: 0.38 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  /* ── the last two categories, supplied 2026-09-08 ───────────────────────
     The eight above left `books_cards_collectibles_hobby` and
     `furniture_and_home_goods` without a frame, which is what held the grid
     back — a ten-card grid with two cards missing their photograph is worse
     than no grid. Same 1448x1086 native as the rest of the batch. */
  {
    batch: "2026-09",
    slug: "books-cards-hobby",
    src: "14-books-cards-hobby.png",
    /* The square drops a quarter of the width, and this frame spends that
       width on four different goods — card rack, book table, collectibles
       cabinet, plush shelf. Held just right of the bookseller so the square
       keeps the cards on the left AND reaches the cabinet, rather than
       centring her and cutting the category down to one noun. */
    focal: { x: 0.44, y: 0.36 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  {
    batch: "2026-09",
    slug: "furniture-home-goods",
    src: "15-furniture-home-goods.png",
    /* She stands well left of centre and the sofa runs to the middle. Anything
       below x=0.375 clamps against the left edge and stops tracking the
       subject at all, so this is pulled right of her to keep the lamp and the
       styled shelving in frame — the part that reads as "home goods" rather
       than "a sofa". */
    focal: { x: 0.42, y: 0.34 },
    derivatives: CATEGORY_DERIVATIVES,
  },
  /* The four proof artifacts. Small chips in a four-across row inside the
     timeline panel, so these are the only derivatives on the page whose job is
     to be READ at ~150px — each frame is cropped about the phone screen or the
     parcel, not about the person, because at that size a face is a smudge and
     the artifact is the point. */
  {
    batch: "2026-09",
    slug: "proof-pin",
    src: "09-proof-pin.png",
    /* The keypad, not the courier: the PIN screen is the artifact. */
    focal: { x: 0.50, y: 0.52 },
    derivatives: [{ shape: "proof", aspect: 4 / 3, widths: [200, 400] }],
  },
  {
    batch: "2026-09",
    slug: "proof-photo",
    src: "10-proof-photo.png",
    focal: { x: 0.50, y: 0.60 },
    derivatives: [{ shape: "proof", aspect: 4 / 3, widths: [200, 400] }],
  },
  {
    batch: "2026-09",
    slug: "proof-location",
    src: "11-proof-location.png",
    /* The map on the screen, which sits left of centre and high. */
    focal: { x: 0.45, y: 0.45 },
    derivatives: [{ shape: "proof", aspect: 4 / 3, widths: [200, 400] }],
  },
  {
    batch: "2026-09",
    slug: "proof-signature",
    src: "12-proof-signature.png",
    focal: { x: 0.48, y: 0.52 },
    derivatives: [{ shape: "proof", aspect: 4 / 3, widths: [200, 400] }],
  },
  /* The service corridor. NATIVE aspect (1198x1313, 0.912) so nothing is
     cropped — the corridor runs top to bottom and any crop would cut a market
     off one end. A resize, not a crop. */
  {
    batch: "2026-09",
    slug: "service-corridor",
    src: "13-service-corridor-map.png",
    focal: { x: 0.5, y: 0.5 },
    derivatives: [{ shape: "map", aspect: 1198 / 1313, widths: [360, 720] }],
  },
  {
    batch: "2026-09",
    slug: "dry-cleaning-counter",
    src: "08-dry-cleaning.png",
    /* Held right of his face so the garment he is holding stays in the square;
       he is well left of centre and a face-centred crop drops it entirely. */
    focal: { x: 0.47, y: 0.36 },
    derivatives: CATEGORY_DERIVATIVES,
  },

  {
    slug: "florist",
    src: "01-florist.png",
    focal: { x: 0.31, y: 0.46 },
    /* The florist is high in the frame with her arm raised; a crop centred on
       0.46 cut the reaching hand. Pulled up. */
    focalOverride: { y: 0.4 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [400, 800] },
      { shape: "square", aspect: 1, widths: [200, 400] },
    ],
  },
  {
    slug: "boutique",
    src: "03-boutique.png",
    focal: { x: 0.69, y: 0.47 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [400, 800] },
      { shape: "square", aspect: 1, widths: [200, 400] },
    ],
  },
  {
    slug: "hardware",
    src: "04-hardware.png",
    focal: { x: 0.56, y: 0.42 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [400, 800] },
      { shape: "square", aspect: 1, widths: [200, 400] },
    ],
  },
  {
    slug: "dry-cleaning",
    src: "07-dry-cleaning.png",
    focal: { x: 0.49, y: 0.44 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [400, 800] },
      { shape: "square", aspect: 1, widths: [200, 400] },
    ],
  },
  {
    slug: "busy-parent",
    src: "10-busy-parent-home.png",
    focal: { x: 0.57, y: 0.46 },
    /* The outcomes primary. 4:3 is its native aspect, so this one is a resize
       and not a crop — nothing is discarded. */
    derivatives: [{ shape: "wide", aspect: 4 / 3, widths: [480, 960, 1440] }],
  },
  {
    slug: "older-customer",
    src: "09-older-customer-home-goods.png",
    focal: { x: 0.6, y: 0.5 },
    derivatives: [{ shape: "wide", aspect: 3 / 2, widths: [320, 640, 880] }],
  },
  {
    slug: "bakery",
    src: "02-bakery.png",
    focal: { x: 0.53, y: 0.46 },
    derivatives: [{ shape: "wide", aspect: 3 / 2, widths: [400, 800] }],
  },
  {
    slug: "print-sign",
    src: "05-print-sign.png",
    focal: { x: 0.6, y: 0.48 },
    derivatives: [{ shape: "wide", aspect: 3 / 2, widths: [400, 800] }],
  },
  {
    /* PUB-011 `confirmation`. Native 16:9 already, and the only frame in the set
       that is — so this is a resize, not a crop. The empty left half is the
       copy well the band's text sits in, which is why the focal point is right
       of centre: the subject must survive when the copy overlays the left. */
    slug: "customer-at-home",
    src: "12-customer-at-home-wide.png",
    focal: { x: 0.66, y: 0.5 },
    derivatives: [{ shape: "wide", aspect: 16 / 9, widths: [900, 1400, 1900] }],
  },
  {
    slug: "gift-stationery",
    src: "08-gift-stationery.png",
    focal: { x: 0.63, y: 0.45 },
    /* PUB-012's business door needs a bigger frame than PUB-009's 800px card:
       the master hero is a half-width editorial panel at 1440. Same source,
       same focal point, one wider derivative. */
    derivatives: [{ shape: "wide", aspect: 3 / 2, widths: [400, 800, 1200] }],
  },

  /* ── MKT-004 consumer photography ───────────────────────────────────────
     Three approved photographs for PUB-012's consumer door and PUB-013's
     editorial sections. They are PHOTOGRAPHY, not UI artboards: neither screen
     becomes `visual_authority: canonical` because of them.

     All three are natively 1672x941 (~16:9), wider than the 4:3 sources above,
     so a 3:2 crop trims width rather than height and keeps the full subject
     band. Each focal point below was set by generating the derivative and
     LOOKING at it — the doorstep and office crops were both re-cut after the
     first pass, and the deviation is recorded with the asset. */
  {
    slug: "consumer-doorstep-handoff",
    src: "16-consumer-doorstep-handoff.png",
    /* The handover — a box and a paper bag passing between two people — sits
       right of centre. A centred 3:2 crop cut the recipient out of frame. */
    focal: { x: 0.72, y: 0.52 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [800, 1200] },
      /* Mobile art direction, not a resize: at 390 a shrunk 3:2 puts both
         faces under 40px. A 4:5 window about the same point keeps them
         legible, which is the §5.3 rule the mosaic crops already follow. */
      { shape: "portrait", aspect: 4 / 5, widths: [390, 780] },
    ],
  },
  {
    slug: "consumer-dry-cleaning-pickup",
    src: "17-consumer-dry-cleaning-pickup.png",
    focal: { x: 0.55, y: 0.5 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [640, 1280] },
      { shape: "portrait", aspect: 4 / 5, widths: [390, 780] },
    ],
  },
  {
    slug: "consumer-send-from-office",
    src: "18-consumer-send-from-office.png",
    /* The subject and the envelope are right of centre; the left third is
       window and desk. Pulled right so the crop is not half empty desk. */
    focal: { x: 0.66, y: 0.52 },
    derivatives: [
      { shape: "wide", aspect: 3 / 2, widths: [640, 1280] },
      { shape: "portrait", aspect: 4 / 5, widths: [390, 780] },
    ],
  },
];

/**
 * The crop window for a target aspect, positioned about a focal point.
 *
 * The window is the largest rectangle of that aspect that fits inside the
 * source, then slid so the focal point sits at its centre, then clamped so it
 * stays inside the frame. Clamping is what stops a focal point near an edge
 * from producing a window that hangs off it.
 */
export function cropWindow(srcW, srcH, aspect, fx, fy) {
  let w = srcW;
  let h = Math.round(srcW / aspect);
  if (h > srcH) {
    h = srcH;
    w = Math.round(srcH * aspect);
  }
  const left = Math.max(0, Math.min(srcW - w, Math.round(fx * srcW - w / 2)));
  const top = Math.max(0, Math.min(srcH - h, Math.round(fy * srcH - h / 2)));
  return { left, top, width: w, height: h };
}

export function outName(slug, shape, width, batch = DEFAULT_BATCH) {
  return `mkt-${batch}-${slug}-${shape}-${width}.webp`;
}

/** Every derivative this table implies, as `slug/shape/width` triples. */
export function expected() {
  const out = [];
  for (const a of ASSETS) {
    for (const d of a.derivatives) {
      for (const w of d.widths) out.push({ asset: a, shape: d.shape, aspect: d.aspect, width: w });
    }
  }
  return out;
}

async function main() {
  const check = process.argv.includes("--check");
  for (const b of new Set(ASSETS.map((a) => a.batch ?? DEFAULT_BATCH))) {
    mkdirSync(join(repo, outDir(b)), { recursive: true });
  }

  const want = expected();
  const wantNames = new Set(
    want.map((e) => outName(e.asset.slug, e.shape, e.width, e.asset.batch))
  );
  const fail = [];
  let written = 0;

  for (const e of want) {
    const srcPath = join(repo, srcDir(e.asset.batch), e.asset.src);
    if (!existsSync(srcPath)) {
      fail.push(`${e.asset.src}: source is missing`);
      continue;
    }
    const name = outName(e.asset.slug, e.shape, e.width, e.asset.batch);
    const outPath = join(repo, outDir(e.asset.batch), name);

    const meta = await sharp(srcPath).metadata();
    const fx = e.asset.focalOverride?.x ?? e.asset.focal.x;
    const fy = e.asset.focalOverride?.y ?? e.asset.focal.y;
    const win = cropWindow(meta.width, meta.height, e.aspect, fx, fy);

    const buf = await sharp(srcPath)
      .extract(win)
      .resize({ width: e.width, height: Math.round(e.width / e.aspect), fit: "fill" })
      .webp({ quality: 82, effort: 6 })
      .toBuffer();

    if (check) {
      if (!existsSync(outPath)) {
        fail.push(`${name}: missing — run \`node scripts/buildMarketingImages.mjs\``);
      } else if (
        createHash("sha256").update(buf).digest("hex") !==
        createHash("sha256").update(readFileSync(outPath)).digest("hex")
      ) {
        fail.push(`${name}: stale — the source or the crop table changed`);
      }
      continue;
    }

    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, buf);
    written += 1;
  }

  // A derivative nobody serves is dead weight that still ships to the browser.
  // Swept per batch, so a 2026-09 file is never judged against the 2026-08 table.
  for (const b of new Set(ASSETS.map((a) => a.batch ?? DEFAULT_BATCH))) {
    for (const f of readdirSync(join(repo, outDir(b)))) {
      if (f.endsWith(".webp") && !wantNames.has(f)) {
        if (check) fail.push(`${f}: orphaned — no entry in the crop table`);
        else unlinkSync(join(repo, outDir(b), f));
      }
    }
  }

  if (fail.length) {
    console.error(`marketing images: ${fail.length} problem(s)`);
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    check
      ? `marketing images: ok — ${want.length} derivative(s) current`
      : `marketing images: wrote ${written} derivative(s)`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("buildMarketingImages.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
