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

import type { BusinessCategory } from "@/lib/couranr/categories/registry";
import { GENERAL_CATEGORY } from "@/lib/couranr/categories/registry";

export const MARKETING_PHOTO_DIR = "/images/marketing/2026-08/w";

/** The 2026-09 batch, installed on owner instruction 2026-09-08. */
export const MARKETING_PHOTO_DIR_2026_09 = "/images/marketing/2026-09/w";

const DEFAULT_BATCH = "2026-08";
const dirFor = (batch = DEFAULT_BATCH) => `/images/marketing/${batch}/w`;

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
  /** Defaults to 2026-08, so every asset accepted on 2026-08-28 is unchanged. */
  batch?: string;
  /** The derivative shape name, where it is not the default `wide`. */
  shape?: string;
  /**
   * The SQUARE slot's derivative shape name, where it is not `square`.
   *
   * Both slots need their own override and only the wide one had it, which was
   * a live 404 rather than an omission: the 2026-09 batch builds its narrow
   * crop as `thumb`, so `srcSetFor(photo, "square")` asked the browser for
   * `mkt-2026-09-auto-parts-square-160.webp` — a file that does not exist. A
   * missing `srcSet` candidate fails silently, because the browser just picks
   * another width, so it would have shown up only as a blurry card at exactly
   * the widths that select the small crop.
   */
  squareShape?: string;
};

function src(slug: string, shape: string, width: number, batch = DEFAULT_BATCH): string {
  return `${dirFor(batch)}/mkt-${batch}-${slug}-${shape}-${width}.webp`;
}

/** The shape name each slot's widths actually build under. */
const wideShape = (p: MarketingPhoto) => p.shape ?? "wide";
const squareShape = (p: MarketingPhoto) => p.squareShape ?? "square";

/** `srcSet` for one shape of one asset, widest last. */
export function srcSetFor(photo: MarketingPhoto, shape: "wide" | "square"): string {
  const widths = shape === "wide" ? photo.wide.widths : (photo.square?.widths ?? []);
  const name = shape === "wide" ? wideShape(photo) : squareShape(photo);
  return widths.map((w) => `${src(photo.slug, name, w, photo.batch)} ${w}w`).join(", ");
}

/** The largest derivative, which is what a `src` fallback should point at. */
export function largestSrc(photo: MarketingPhoto, shape: "wide" | "square" = "wide"): string {
  const widths = shape === "wide" ? photo.wide.widths : (photo.square?.widths ?? []);
  const name = shape === "wide" ? wideShape(photo) : squareShape(photo);
  return src(photo.slug, name, widths[widths.length - 1], photo.batch);
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
 * Accepted, and deliberately unused by the website batch. Recorded here so the
 * next person reads "reserve" rather than "forgotten" — and so a test can hold
 * the homepage to a fixed count rather than however many assets exist. The
 * figure is asserted in tests/couranr-marketing-photos.test.ts rather than
 * repeated here, because a number written in two places is a number that goes
 * stale in one.
 */
export const RESERVE_PHOTO_IDS = [
  /* Accepted 2026-08-29, briefly placed as an inset beside the order-flow strip
     in `order-channels`, then REMOVED on owner instruction 2026-08-29: the
     photograph made the section look awkward. The section is back to tiles,
     convergence and the flow strip, which is what the artboard shows. */
  "couranr-mkt-2026-08-merchant-phone-order",
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


/* ── the 2026-09 proof-artifact set ────────────────────────────────────────
   OWNER INSTRUCTION 2026-09-08. Four frames for section 8's proof artifacts,
   which until now rendered a literal "image pending" placeholder in one of
   four slots.

   ALL FOUR ARE DECORATIVE — `alt=""` — and that is a decision, not an
   oversight. They were first written with descriptive alt text under the
   narrowed evidence boundary the owner approved, and reviewing the rendered
   markup is what changed it: the list these sit in is labelled "What Couranr
   records as proof", so "A courier enters a four-digit code on a phone while a
   resident waits at an open front door" tells a screen-reader user the scene IS
   a Couranr delivery. That is a stronger claim than the photograph makes to a
   sighted reader, which inverts what alt text is for.

   It is also the ordinary rule rather than a special case. Each frame sits
   beside its own label and detail — Recipient PIN / Four digits, verified at
   the door — which carry the whole product fact in text. W3C WAI's decorative-
   images tutorial gives exactly this shape: an image "already sufficiently
   described by the adjacent text" takes a null alt, because repeating it makes
   a screen reader announce redundant detail. The photographs add visual
   interest, not information, so nothing is lost by silencing them and the
   claim goes with it.
   https://www.w3.org/WAI/tutorials/images/decorative/

   The narrowed boundary still stands for anything that DOES carry a string;
   what changed is that these four carry none. `subject` in
   VISUAL_AUTHORITY_REGISTRY.json still records what each photograph shows, for
   a human reading the registry — that is provenance, not page copy.

   Still generated assets, still not evidence. */
export const PROOF_ARTIFACT_PHOTOS: MarketingPhoto[] = [
  {
    id: "couranr-mkt-2026-09-proof-pin",
    slug: "proof-pin",
    batch: "2026-09",
    shape: "proof",
    /* Decorative: the label beside it carries the fact. See the header. */
    alt: "",
    wide: { widths: [200, 400], ratio: [4, 3] },
  },
  {
    id: "couranr-mkt-2026-09-proof-photo",
    slug: "proof-photo",
    batch: "2026-09",
    shape: "proof",
    /* Decorative: the label beside it carries the fact. See the header. */
    alt: "",
    wide: { widths: [200, 400], ratio: [4, 3] },
  },
  {
    id: "couranr-mkt-2026-09-proof-location",
    slug: "proof-location",
    batch: "2026-09",
    shape: "proof",
    /* Decorative: the label beside it carries the fact. See the header. */
    alt: "",
    wide: { widths: [200, 400], ratio: [4, 3] },
  },
  {
    id: "couranr-mkt-2026-09-proof-signature",
    slug: "proof-signature",
    batch: "2026-09",
    shape: "proof",
    /* Decorative: the label beside it carries the fact. See the header. */
    alt: "",
    wide: { widths: [200, 400], ratio: [4, 3] },
  },
];

/* ── the 2026-09 service corridor ──────────────────────────────────────────
   OWNER INSTRUCTION 2026-09-08: replaces `ServiceCorridorMap`, the schematic
   SVG, whose header refused a rendered basemap on the ground that "a map that
   invents terrain is worse than a schematic that admits it is one" and that
   §27 Section 10 forbids inventing an undefined boundary.

   The owner has ruled that reasoning stale and the map decorative. Two things
   make that safe rather than merely instructed:

     - the four markets are ALREADY in text directly beneath, through
       MARKETS_PUBLIC_COPY, so nothing readable lives only in pixels;
     - the map is marked decorative, so the corridor band it draws is not
       offered to a reader as a coverage boundary. The sentence beneath is what
       states coverage, and it ends "and surrounding areas". */
export const SERVICE_CORRIDOR_MAP: MarketingPhoto = {
  id: "couranr-mkt-2026-09-service-corridor",
  slug: "service-corridor",
  batch: "2026-09",
  shape: "map",
  /* DECORATIVE. Rendered with alt="" — see the section for why: every fact it
     depicts is stated in text beside it. */
  alt: "",
  wide: { widths: [360, 720], ratio: [1198, 1313] },
};

/* ── the 2026-09 category system ───────────────────────────────────────────
   OWNER INSTRUCTION 2026-09-08. Ten frames, one per real business category,
   for PUB-001 section 9.

   WHY THIS IS A RECORD KEYED BY CATEGORY AND NOT AN ARRAY. The section renders
   one card per member of BUSINESS_CATEGORIES, which is the registry's order and
   the database's `couranr_mw_category_chk` constraint. An array would let the
   photographs drift out of step with that order silently — card 7 showing a
   bakery under the label "Furniture and home goods" is a defect no test of
   lengths would catch. Keying by the category id makes the pairing the data
   rather than a coincidence of index.

   `lib/couranr/**` compiles under tsconfig.canonical.json with `strict: true`,
   so `Record<Exclude<BusinessCategory, typeof GENERAL_CATEGORY>, …>` is
   EXHAUSTIVE: an eleventh real category added to the registry without a
   photograph fails `npm run typecheck:canonical`. That is a stronger guarantee
   than a test, and it is why the type is written the long way instead of as a
   partial map.

   GENERAL_CATEGORY is deliberately absent. It is the fallback — "not on the
   list" — and Master Package §5 makes it a first-class choice rather than a
   category with a look. Photographing it would mean inventing a scene that
   stands for "any business at all", which is the one thing no photograph can
   honestly show. The section renders it as a full-width card with no image.

   THE EVIDENCE BOUNDARY IS THE STRICT ONE. These are category illustrations,
   exactly the class OWNER_VISUAL_DECISION_2026-08-28.md's word ban was written
   for, so none of these alt strings may say delivery, courier, driver, parcel
   or Couranr. The narrowed boundary the owner approved on 2026-09-08 applies to
   the PRODUCT-SURFACE frames (the proof artifacts), not to these.

   Unlike the proof chips, these alts are NOT empty. Each card's own label names
   the category, but the photograph shows a different thing — a specific trade
   at work — and that is information the label does not carry. W3C WAI's test is
   whether the adjacent text already describes the image; here it does not. */
export const CATEGORY_SYSTEM_PHOTOS: Readonly<
  Record<Exclude<BusinessCategory, typeof GENERAL_CATEGORY>, MarketingPhoto>
> = {
  dry_cleaning_laundry_tailoring: {
    id: "couranr-mkt-2026-09-dry-cleaning-counter",
    slug: "dry-cleaning-counter",
    batch: "2026-09",
    shape: "card",
    alt: "A dry-cleaning worker checks a suit in a garment bag on the finished rack.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  printing_signage_promotional: {
    id: "couranr-mkt-2026-09-print-signage",
    slug: "print-signage",
    batch: "2026-09",
    shape: "card",
    alt: "A print-shop worker guides a wide landscape print off a large-format printer.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  boutique_clothing_shoes_accessories: {
    id: "couranr-mkt-2026-09-boutique-apparel",
    slug: "boutique-apparel",
    batch: "2026-09",
    shape: "card",
    alt: "A boutique owner arranges jackets on a rail beside a display of shoes and handbags.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  florists_gifts_specialty_retail: {
    id: "couranr-mkt-2026-09-florist-gifts",
    slug: "florist-gifts",
    batch: "2026-09",
    shape: "card",
    alt: "A florist ties a mixed bouquet at a work table beside wrapped gift boxes.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  repair_and_electronics: {
    id: "couranr-mkt-2026-09-repair-electronics",
    slug: "repair-electronics",
    batch: "2026-09",
    shape: "card",
    alt: "A repair technician works inside an opened laptop with a screwdriver at a bench.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  auto_parts_and_accessories: {
    id: "couranr-mkt-2026-09-auto-parts",
    slug: "auto-parts",
    batch: "2026-09",
    shape: "card",
    alt: "A shopper compares a boxed air filter at the shelf in an auto-parts store.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  furniture_and_home_goods: {
    id: "couranr-mkt-2026-09-furniture-home-goods",
    slug: "furniture-home-goods",
    batch: "2026-09",
    shape: "card",
    alt: "A home-goods shop worker sets a cushion on a sofa in a styled showroom.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  event_rentals_and_supplies: {
    id: "couranr-mkt-2026-09-event-rentals",
    slug: "event-rentals",
    batch: "2026-09",
    shape: "card",
    alt: "An event-rental worker checks stacked chairs against a clipboard in a supply warehouse.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  bakeries_prepared_food_catering: {
    id: "couranr-mkt-2026-09-bakery-catering",
    slug: "bakery-catering",
    batch: "2026-09",
    shape: "card",
    alt: "A baker arranges catering trays and pastries across a bakery counter.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
  books_cards_collectibles_hobby: {
    id: "couranr-mkt-2026-09-books-cards-hobby",
    slug: "books-cards-hobby",
    batch: "2026-09",
    shape: "card",
    alt: "A bookseller sorts new stock on a table between a greetings-card rack and a collectibles cabinet.",
    wide: { widths: [400, 800], ratio: [4, 3] },
    square: { widths: [160, 320] },
    squareShape: "thumb",
  },
};
