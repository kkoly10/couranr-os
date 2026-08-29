/**
 * The owner-accepted 2026-08-28 marketing photography, as render-time data.
 *
 * ONE MODULE, TWO PAGES. PUB-001 and PUB-009 both render frames from this set.
 * Alt text in particular must not be retyped per page: it is the accessible
 * description of a specific photograph, it was written once in the owner's
 * handoff record (`ASSET_PROVENANCE.json`), and a second copy is a second
 * chance to drift from it.
 *
 * WHAT THE ALT TEXT MAY AND MAY NOT SAY. Every one of these describes what the
 * photograph shows and nothing else. None of them says or implies that the
 * person is a Couranr customer, that the parcel is a Couranr delivery, or that
 * the scene happened. OWNER_VISUAL_DECISION_2026-08-28.md's evidence boundary
 * is explicit: Couranr has no owner-approved delivery evidence yet, so these
 * are category and benefit illustrations. `tests/couranr-marketing-photos.test.ts`
 * asserts the boundary rather than trusting it.
 *
 * PROVENANCE. Generated with OpenAI image generation in ChatGPT and accepted by
 * the owner on 2026-08-28. Sources live at `public/images/marketing/2026-08/`
 * unmodified; every path below is a derivative built by
 * `scripts/buildMarketingImages.mjs`, which owns the crop windows and the focal
 * points. Registration is in `scripts/visualAuthorityRegistry.mjs`.
 */

export const MARKETING_PHOTO_DIR = "/images/marketing/2026-08/w";

export type MarketingPhoto = {
  /** Matches the `asset_id` the visual-authority registry records. */
  id: string;
  /** File stem shared by every derivative of this asset. */
  slug: string;
  alt: string;
  /** Intrinsic aspect of the `wide` derivative, as [w, h] for the `<img>`. */
  wide: { widths: number[]; ratio: [number, number] };
  /** Present only where a narrow viewport needs a different crop, not a resize. */
  square?: { widths: number[] };
};

function src(slug: string, shape: string, width: number): string {
  return `${MARKETING_PHOTO_DIR}/mkt-2026-08-${slug}-${shape}-${width}.webp`;
}

/** `srcSet` for one shape of one asset, widest last. */
export function srcSetFor(photo: MarketingPhoto, shape: "wide" | "square"): string {
  const widths = shape === "wide" ? photo.wide.widths : (photo.square?.widths ?? []);
  return widths.map((w) => `${src(photo.slug, shape, w)} ${w}w`).join(", ");
}

/** The largest derivative, which is what a `src` fallback should point at. */
export function largestSrc(photo: MarketingPhoto, shape: "wide" | "square" = "wide"): string {
  const widths = shape === "wide" ? photo.wide.widths : (photo.square?.widths ?? []);
  return src(photo.slug, shape, widths[widths.length - 1]);
}

/** Rendered `width`/`height` for a shape, so the box is reserved before load. */
export function intrinsic(photo: MarketingPhoto, shape: "wide" | "square" = "wide") {
  const widths = shape === "wide" ? photo.wide.widths : (photo.square?.widths ?? []);
  const w = widths[widths.length - 1];
  if (shape === "square") return { width: w, height: w };
  const [rw, rh] = photo.wide.ratio;
  return { width: w, height: Math.round((w * rh) / rw) };
}

/**
 * PUB-001 `category-breadth` — exactly four, locked by
 * IMPLEMENTATION_SCOPE_MATRIX.md. The point of the section is BREADTH, so the
 * four are deliberately different trades, different people, different rooms and
 * different camera positions. That diversity supersedes the original brief's
 * same-light/same-distance requirement; see the 2026-08-28 amendment at the top
 * of `docs/couranr-mvp/brand/PUB-001_PHOTOGRAPHY_BRIEF.md`.
 */
export const CATEGORY_BREADTH_PHOTOS: MarketingPhoto[] = [
  {
    id: "couranr-mkt-2026-08-florist",
    slug: "florist",
    alt: "Florist selecting stems from a wall of flowers in a local shop.",
    wide: { widths: [400, 800], ratio: [3, 2] },
    square: { widths: [200, 400] },
  },
  {
    id: "couranr-mkt-2026-08-boutique",
    slug: "boutique",
    alt: "Boutique owner helping a customer compare clothing in a local shop.",
    wide: { widths: [400, 800], ratio: [3, 2] },
    square: { widths: [200, 400] },
  },
  {
    id: "couranr-mkt-2026-08-hardware",
    slug: "hardware",
    alt: "Worker reaching for merchandise on a high shelf in a neighborhood hardware store.",
    wide: { widths: [400, 800], ratio: [3, 2] },
    square: { widths: [200, 400] },
  },
  {
    id: "couranr-mkt-2026-08-dry-cleaning",
    slug: "dry-cleaning",
    alt: "Dry-cleaning worker tagging finished garments beside a rack of clothing.",
    wide: { widths: [400, 800], ratio: [3, 2] },
    square: { widths: [200, 400] },
  },
];

/**
 * PUB-001 `outcomes` — exactly two. The busy parent is the primary and the
 * older customer the support, which is the owner's ordering and not a layout
 * convenience. The third accepted benefit frame (office / local supplies) is a
 * reserve and is deliberately NOT on the homepage.
 */
export const OUTCOME_PRIMARY_PHOTO: MarketingPhoto = {
  id: "couranr-mkt-2026-08-benefit-busy-parent",
  slug: "busy-parent",
  alt: "Busy parent at home with children and a bakery purchase on the kitchen island.",
  wide: { widths: [480, 960, 1440], ratio: [4, 3] },
};

export const OUTCOME_SUPPORTING_PHOTO: MarketingPhoto = {
  id: "couranr-mkt-2026-08-benefit-older-customer",
  slug: "older-customer",
  alt: "Older customer arranging a newly purchased vase at home.",
  wide: { widths: [320, 640, 880], ratio: [3, 2] },
};

/**
 * PUB-009 `/businesses` — exactly three, as one restrained strip. Specialty
 * retail is an accepted reserve and is not here.
 */
export const BUSINESSES_STRIP_PHOTOS: MarketingPhoto[] = [
  {
    id: "couranr-mkt-2026-08-bakery",
    slug: "bakery",
    alt: "Baker removing fresh bread from an oven in a neighborhood bakery.",
    wide: { widths: [400, 800], ratio: [3, 2] },
  },
  {
    id: "couranr-mkt-2026-08-print-sign",
    slug: "print-sign",
    alt: "Print-shop worker inspecting a large-format print coming off a printer.",
    wide: { widths: [400, 800], ratio: [3, 2] },
  },
  {
    id: "couranr-mkt-2026-08-gift-stationery",
    slug: "gift-stationery",
    alt: "Stationery-shop worker helping an older customer choose an item.",
    wide: { widths: [400, 800], ratio: [3, 2] },
  },
];

/**
 * PUB-011 `confirmation` — the one full-bleed band on the public site whose §19
 * grammar names photography ("Navy and/or approved photography", §19.6) AND
 * whose page carries no governing artboard: the visual registry records PUB-011
 * as `visual_authority: "derived"`. That combination is why this is the only
 * new photographic slot the 2026-08-29 review found.
 *
 * It is NOT the homepage's closing band, which the brief also asks for. The
 * canonical PUB-001 artboard was opened and read at the pixel level and shows
 * flat navy there — the brief predates that reconciliation, and the fidelity
 * amendment gives the mock precedence on composition.
 */
export const CONFIRMATION_PHOTO: MarketingPhoto = {
  id: "couranr-mkt-2026-08-customer-at-home",
  slug: "customer-at-home",
  alt: "A person setting a shopping bag and a potted plant on a table just inside her front door.",
  wide: { widths: [900, 1400, 1900], ratio: [16, 9] },
};

/**
 * PUB-001 `order-channels`, as a small inset — the brief's IMG-06, which names
 * this exact section: "if the strip needs an anchoring visual, this is the
 * frame."
 *
 * SMALL ON PURPOSE. §27.0 row 4 declares this section `image-led="false"` and
 * the composition test asserts equality, not a floor, so a dominant photograph
 * here would force the table row. Kept as an inset beside the flow strip, the
 * flag stays honest. If it ever grows into the section's subject, row 4 and the
 * DOM must move in the same commit.
 *
 * What it adds that no other frame does: every other photograph in the set
 * shows a shop serving someone IN PERSON. This is the only one showing an order
 * arriving through a channel — which is the section's entire claim.
 */
export const CHANNELS_INSET_PHOTO: MarketingPhoto = {
  id: "couranr-mkt-2026-08-merchant-phone-order",
  slug: "merchant-phone-order",
  alt: "A shop owner writing an order in a ledger while taking a call at her counter.",
  wide: { widths: [360, 720], ratio: [4, 3] },
};

/**
 * Accepted, and deliberately unused by the website batch. Recorded here so the
 * next person reads "reserve" rather than "forgotten" — and so a test can hold
 * the homepage to six photographs rather than however many exist.
 */
export const RESERVE_PHOTO_IDS = [
  "couranr-mkt-2026-08-specialty-retail",
  "couranr-mkt-2026-08-benefit-office",
  /* Accepted 2026-08-29 and held back deliberately: both are the same SCENE as
     a frame already bound into `outcomes` — a parent and child at a kitchen
     island, and an older customer with a newly bought vase at home. `outcomes`
     is locked to exactly two photographs by the owner's decision, so these are
     not an addition, and as a swap they would be a sideways move. Cropping
     changes the framing, not the meaning. */
  "couranr-mkt-2026-08-parent-child-kitchen",
  "couranr-mkt-2026-08-older-customer-vase",
] as const;
