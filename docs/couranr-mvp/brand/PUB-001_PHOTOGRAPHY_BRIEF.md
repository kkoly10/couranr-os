# PUB-001 photography brief

What to generate, why each image exists, and the constraints every one of them
has to satisfy. Written against `COURANR_VISUAL_SYSTEM_V2_2.md` §21 (photography
system), §27.0 (the twelve governed sections) and §24.6 (mobile is
art-directed).

---

## OWNER AMENDMENT — 2026-08-28

**Status: the photography this brief asked for has been produced, reviewed and
accepted, and the owner changed one of its rules in the process.** Everything
below this section is preserved as written. Where the two disagree, this
amendment wins; the paragraphs it supersedes are marked in place.

### What the owner rejected

The requirement that the four `category-breadth` frames read as one tightly
matched series — **same light, same grade, same distance from the subject**.
Applied, it produced repeated people, repeated poses and repeated rooms, and the
sameness worked directly against the thing the section exists to say: that
Couranr serves many different kinds of local business. A series that looks like
one shop photographed four times is not an argument for breadth.

### What replaces it

The accepted set deliberately varies **people, ages, racial and ethnic
appearance, trade, room, action, camera position and visual rhythm.** That
variation is the point and is not drift.

The set still has to read as one brand, but through **restraint, naturalistic
light, real working environments, the absence of unrelated branding, and a
common production treatment after cropping** — not through cloned composition.

### What is unchanged

Every other rule in "Rules that apply to every image" still stands: no Couranr
branding, no fabricated evidence, no generated geography, nobody presenting to
camera, no delivery-app clichés, and no unrelated trademarks.

One deviation is recorded rather than hidden. The original rule reads *"No text
anywhere in the frame."* Three accepted frames contain incidental environmental
text — a bakery's handwritten wall board, printed card fronts on a stationery
shelf, product packaging on hardware shelving. None of it is legible at any
width the site serves, none of it is signage or a third-party mark, and the
owner accepted the frames with it present. **The surviving rule is: no LEGIBLE
text, no signage, and no identifiable third-party trademark.** Incidental,
illegible texture in a real working room is not a defect.

### The accepted set, and where each frame is used

Sources are at `public/images/marketing/2026-08/`, unmodified. Derivatives are
built by `scripts/buildMarketingImages.mjs`, which owns the crop windows and
focal points. Registration is in `scripts/visualAuthorityRegistry.mjs`.

**PUB-001 `category-breadth` — exactly four:**
`01-florist.png`, `03-boutique.png`, `04-hardware.png`, `07-dry-cleaning.png`.

**PUB-001 `outcomes` — exactly two:** `10-busy-parent-home.png` as the primary
and `09-older-customer-home-goods.png` as the support. This made `outcomes`
image-led; §27.0 row 5 and the DOM flag were changed together.

**PUB-009 `/businesses` — exactly three, as one restrained strip:**
`02-bakery.png`, `05-print-sign.png`, `08-gift-stationery.png`.

**Accepted reserves, deliberately unused on the website:**
`06-specialty-retail.png` and `11-office-local-supplies.png`. They are for
collateral, social and a future owner-approved rotation. Their absence from the
site is a decision, not an oversight — putting all eleven on the homepage is the
defect `ADVERSARIAL_REVIEW.md` records as the first package's worst.

### What is still NOT approved

Couranr has no owner-approved real delivery evidence. So there is still no
proof-of-delivery photograph, no completed-delivery record, no tracking
artefact, no product screenshot used as evidence, no testimonial, no customer
logo and no operational metric. The `product-proof` region is frozen and keeps
its own pending tile.

### What these photographs claim

Nothing. They are category and benefit illustrations. No person in them is a
Couranr customer and no parcel in them is a Couranr delivery, and every alt
string in `lib/couranr/public/marketingPhotos.ts` describes only what is in the
frame.

---

## Why this brief exists

> **SUPERSEDED 2026-08-28 (the first paragraph only).** The repository no longer
> owns two photographs. It owns thirteen: the two hero frames and the eleven
> accepted on 2026-08-28. The paragraph is kept because it is the reason the
> brief was written.

The repository owns exactly two photographs. Both are the same scene — a
florist handing a Couranr-branded parcel to a Couranr driver — and both are
already spent on the PUB-001 hero (`0C5CBF3B` wide, `44B6E1FB` portrait).

§27 requires at least two image-led sections. Section 3 `category-breadth` is
the second one and has no asset.

Sourcing was attempted first, per §21.1's inventory-before-download rule.
Unsplash is unreachable from the build environment: its search redirects to an
anti-bot interstitial, and Openverse — the keyless aggregator that would
substitute — does not index Unsplash at all. The reachable CC0 pool returned
rustic floral flatlays with no people, hardware storefronts dense with
third-party signage, and watermarked frames. Every one of those is banned by
name in §21.5 or fails §21.3's documentary standard.

So these are generated to brief instead.

## The register they must match

The two existing photographs set it, and a new image that misses it makes the
page look like two brands stapled together:

- late-afternoon natural daylight, slightly warm, no studio lighting;
- shallow depth of field with a genuinely soft background;
- real storefront and workbench environments, not sets;
- muted, restrained colour — greens, kraft browns, navy, warm neutrals;
- people caught mid-task, never presenting to camera;
- generous negative space on one side, because copy sits over or beside it.

## Rules that apply to every image

Non-negotiable, and most of them exist because §21.5 bans the failure by name.

1. **No text anywhere in the frame.** No signage, no packaging copy, no logos,
   no branding on vehicles or clothing. Generated lettering is malformed, and
   §21.5 bans visible unrelated trademarks regardless.
2. **No Couranr branding.** Do not attempt the wordmark. Driver clothing is
   plain navy; parcels are plain kraft. Branding is composited later or left
   off entirely.
3. **No one looking at the camera**, and no one smiling at the camera holding a
   generic cardboard box — that is the single most-banned frame in §21.5.
4. **No** handshakes, isolated vans on white, 3D logistics illustration, glowing
   map pins, network graphics, headsets, drones, boardrooms, or delivery-app
   clichés of any kind.
5. **Faces may be partial, turned, or out of frame.** Hands, posture and the
   work itself carry the story. This also sidesteps the model-rights ambiguity
   §21.8 asks to avoid.
6. **Real, specific, slightly imperfect environments.** Worn counters, real
   stock on shelves, tools where a working person would leave them.

## Required — Section 3, `category-breadth`

Composition is `image-narrative` (§19.2): photography holds 40–65% of the
section, copy the rest, alongside the governed statement *"Local delivery,
built for more than restaurants."*

The point of the section is **breadth** — that Couranr carries what restaurant
marketplaces do not. One photograph cannot show breadth, so this is a set of
four, and they must read as one series: same light, same grade, same distance
from the subject.

> **SUPERSEDED 2026-08-28.** "Same light, same grade, same distance" is exactly
> what the owner rejected — it produced a stock-photo sameness that argued
> against breadth. See the owner amendment at the top of this file. The set of
> four and the `image-narrative` composition are unchanged; the matching
> requirement is not.

Ask for **landscape 3:2** (1792×1024 is the practical size; I crop to 3:2 and
art-direct the mobile crops myself).

### IMG-01 — florist

> Candid documentary photograph, late-afternoon natural light through a shop
> window. A florist in a work apron stands at a worn wooden bench wrapping a
> large arrangement in plain kraft paper, hands mid-motion, head turned down to
> the work. Buckets of cut stems out of focus behind her. Warm muted greens and
> browns, shallow depth of field, soft background. No text, no signage, no
> logos, no branding. She is not looking at the camera. Open negative space on
> the left third. Photographic, not illustrated. 3:2 landscape.

### IMG-02 — dry cleaner

> Candid documentary photograph inside a small dry-cleaning shop, daylight from
> a shopfront window. A worker in a plain shirt lifts finished garments in clear
> plain covers off an automated conveyor rail, arms raised mid-task, face
> partially turned away. Rows of hanging garments recede softly out of focus.
> Cool neutral greys against warm daylight, shallow depth of field. No text, no
> signage, no logos, no branding of any kind. Nobody looking at the camera.
> Photographic, documentary, not staged. 3:2 landscape.

### IMG-03 — boutique / home goods

> Candid documentary photograph inside a small independent boutique, warm
> afternoon daylight. A shop worker at the counter folds a garment into a plain
> unbranded paper bag with tissue, hands in frame, face out of frame or turned
> away. Racks and shelved stock softly out of focus behind. Warm neutral palette,
> natural light only, shallow depth of field. No text, no signage, no logos, no
> price tags with visible writing. Negative space on the right third.
> Photographic, not illustrated. 3:2 landscape.

### IMG-04 — hardware / specialty parts

> Candid documentary photograph inside a small independent hardware or auto-parts
> shop, daylight mixed with warm overhead light. A worker in a plain work apron
> sets a boxed part and a coil of cable onto the counter beside a plain kraft
> parcel, looking down at the items. Deep shelving of bins and stock softly out
> of focus behind. Muted industrial palette, browns and greys, shallow depth of
> field. No text, no signage, no logos, no brand names on any packaging. Nobody
> facing the camera. Photographic, documentary. 3:2 landscape.

## Optional but wanted — Section 12, `closing`

> **SUPERSEDED 2026-08-29 — this ask is REFUSED, and the refusal is the
> interesting part.** This brief is written authority and it loses here, because
> `COURANR_VISUAL_FIDELITY_AMENDMENT.md` gives the canonical mock precedence on
> composition and geometry, and this brief predates that reconciliation. The
> governing artboard (`5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png`) was opened and
> read at the pixel level rather than remembered: flat navy, headline, two
> buttons, no image. Putting a photograph here reopens a mock-approved region.
>
> The slot could not carry one anyway. Content covers 94.4% of the band's width,
> so the tapered scrim this section asks for has nowhere to be light; and a 16:9
> frame in the rendered 5.87:1 slot shows 30.3% of its height, which is not a
> composition, it is a texture. Both figures were measured, and by two
> independent passes.
>
> The one open photographic `full-bleed-interruption` on the public surface is
> PUB-011's `confirmation`, which has no governing artboard at all
> (`visual_authority: "derived"`) and therefore nothing for the amendment to
> defer to. IMG-05's frame was placed there instead. See
> COURANR_VISUAL_SYSTEM_V2_2.md r10.
>
> The paragraphs below are kept because they are the reason the 16:9 frame was
> commissioned, and the frame is in use.

Composition is `full-bleed-interruption` (§19.6): navy and/or approved
photography, edge to edge, with the approved closing headline over it. Today it
is flat navy. A photograph here is the difference between a closing band and a
closing moment.

This one needs **large, calm negative space** — the headline and two CTAs sit
on top of it — and it must survive a heavy navy scrim without turning to mud,
so favour a brighter frame than the hero.

Ask for **wide landscape, 16:9** (1792×1024).

### IMG-05 — handoff at the door

> Candid documentary photograph on a residential doorstep in late-afternoon
> light. A courier in a plain navy jacket, seen from behind and slightly to one
> side, hands a plain kraft parcel to a recipient standing in the doorway. Both
> figures occupy the right third of the frame; the left two-thirds is soft,
> uncluttered daylight — a porch, a wall, greenery, well out of focus. Warm and
> bright overall, shallow depth of field. No text, no signage, no logos, no
> house numbers, no vehicle. Neither person looking at the camera. Photographic,
> documentary, unstaged. 16:9 wide landscape.

## Also useful, lower priority

### IMG-06 — merchant at the point of sale

> Candid documentary photograph inside a small local shop, natural window light.
> A shop owner leans over a counter tablet taking a delivery order by phone,
> handset held to one shoulder, other hand writing on a plain notepad. A wrapped
> parcel waits on the counter beside her. Everything softly out of focus behind.
> Warm neutral palette, shallow depth of field. No text, no logos, no signage,
> no visible screen content. Not looking at the camera. 3:2 landscape.

Section 4 `order-channels` is a structured strip, so this is not required — but
if the strip needs an anchoring visual, this is the frame.

## What I do NOT need generated

- **The service-area visual (Section 10).** That is a real coverage map of
  Washington DC, Woodbridge, Stafford and Fredericksburg, built as SVG from the
  governed markets. A generated map would invent geography, and §21.5 bans
  glowing map pins besides.
- **The product-proof visual (Section 7).** §19.5 requires *real* Couranr UI. I
  screenshot the running application. A generated dashboard would be a fake
  dashboard, banned by §19.5 and §28.
- **Anything with a Couranr logo on it.** The canonical logo is an SVG asset and
  is never recreated — §9.4 and §22.

## Delivery

Largest resolution available, PNG or JPEG, one file per image, named
`IMG-01` … `IMG-06`. I handle crops, WebP conversion, responsive sizes, mobile
art direction and focal points.

## Provenance to record (§21.2, §21.8)

Every accepted image gets a registry row: `asset_id`, `local_path`, `source`
(here: generated, with the tool and date), `license_record`, `subject`,
`allowed_surfaces`, desktop and mobile focal points, `preferred_aspect`,
`status`. Generated images carry no model or property rights, which is part of
why this route was preferred over stock once Unsplash proved unreachable — but
the origin still gets recorded rather than left implicit.
