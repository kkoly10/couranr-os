# 2026-08-29 photo placements — rendered evidence

The owner accepted four more photographs and asked where else the public
surface could carry an image. **One was placed and kept, one was placed and
withdrawn the same day, and two are reserves.** Each capture below backs a
specific claim; a screenshot with no assertion behind it is decoration.

> **The `order-channels` inset is NOT on the site.** It was built, reviewed,
> corrected twice and passed every gate; the owner then looked at it and said the
> picture made the section look awkward, and it came out. The captures of it are
> kept as the record of an attempt, clearly marked. `order-channels` renders
> tiles, convergence and the flow strip — no photograph.

This folder sits under `evidence/PUB-001/` and holds a PUB-011 capture, which
follows the convention `2026-08-visual-batch/` already set — that folder carries
`pricing-*` (PUB-008) and `businesses-strip-*` (PUB-009) shots for the same
reason. `evidence/PUB-001/` is the public-family evidence root, not the PUB-001
folder its name suggests.

| File | What it shows | What it backs |
|---|---|---|
| `home-order-channels-1440-RESTORED.png` | **WHAT IS ON THE SITE.** The section after the withdrawal: seven tiles, the convergence resolving on the app mark, the flow strip full width, no photograph | `order-channels` carries no image. `data-image-led="false"` in §27.0 row 4 is true by construction again rather than by a measured cap |
| `home-order-channels-1440.png` | **WITHDRAWN TREATMENT.** The section with the corrected 300×132 inset beside the strip | The record of what was withdrawn, at the width where it was always correct |
| `home-order-channels-900.png` | **WITHDRAWN TREATMENT** at 900: inset above the strip, strip on ONE line | The two geometric corrections at the width that exposed them — the first version put the inset beside the strip here and wrapped its three steps to two lines |
| `home-order-channels-390.png` | **WITHDRAWN TREATMENT** at 390, inset still 300×132 | The unconditional cap. The first version ran the frame full-bleed below 900px, reaching 58.3% of the section's area at 899px |
| `how-it-works-confirmation-1440.png` | PUB-011's `confirmation` band with the photograph full-bleed behind the copy | §19.6 `full-bleed-interruption` reads "Navy **and/or approved photography**". `data-image-led` moved false → true and §27.1 row 4 moved in the same commit |
| `how-it-works-confirmation-390.png` | The same band at 390, copy over a visibly present frame | The narrow-width scrim replacement works: the photograph is still readable as an image rather than erased to flat navy |
| `how-it-works-confirmation-390-BEFORE-scrim-fix.png` | **The defect.** The same band with the desktop horizontal gradient put back | White copy running onto the bright window and plant at the frame's right. Reproduced by re-injecting the one superseded declaration over the shipped build, not by reverting the file |

## The contrast defect

`.cr-mkt-band__scrim` was a 90deg gradient, `0.95 → 0.88 → 0.52`. The copy well
is capped at 62ch, so at 1440 its right edge sits at 53.6% of the band (52.6% to
the text ink) — past the 0.88 stop, not inside it. What keeps the desktop band
comfortable is that the photograph is dark where the copy ends, not that the copy
stops before the ramp. Below 900px the copy spans the full width and runs into
the 0.52 tail.

Measured per text element, with the glyphs made transparent and the painted
pixels sampled — the same probe both times, the "before" column produced by
re-injecting the old declaration over the shipped build:

| Width | Before (worst element) | After | Elements failing before |
|---|---|---|---|
| 1440 | 8.11:1 | 8.11:1 | — |
| 1280 | 8.11:1 | 8.11:1 | — |
| 1024 | 7.88:1 | 7.88:1 | — |
| 768 | 5.82:1 | 7.14:1 | — |
| 390 | **3.19:1** | 6.22:1 | 2 |
| 360 | **3.63:1** | 6.44:1 | 3 |
| 320 | **3.52:1** | 6.44:1 | 2 |

Against §23.2's 4.5:1 floor (3:1 for the heading).

## axe does not miss this — it certifies it

Run `color-contrast` against this band and axe returns **zero violations, zero
incomplete, and a PASS at 18.24:1**, computed against the section's declared
`background-color: #0d1525`. It returns the identical result with the broken
gradient and with the fixed one. A rule that scores inverse copy against a colour
the photograph covers does not merely fail to notice the defect; it asserts the
opposite.

That is why the gate had to sample painted pixels, and why
`e2e/publicFamilyGates.mjs` no longer carries a claim about which pages have
photography. It discovers them at each of §24.1's six widths and measures every
text element against its own painted ground, compositing each glyph's own alpha
(this band's body is `rgba(255,255,255,0.86)`, its note `0.7`) and deriving the
3:1 / 4.5:1 floor from computed font metrics.

## Four defects in the gate itself, found by reviewing it after writing it

Recorded because a measurement harness that is wrong is worse than none.

1. It took the worse of the ratios at the two **luminance** extremes. Contrast
   against a fixed glyph is not monotonic in the ground — it bottoms out where
   the ground approaches the glyph's own luminance — so mid-tone text over a
   mixed frame has its worst pixels in the interior and both extremes report a
   pass. It takes the 1st percentile of the per-pixel **ratios** now.
2. It hid text with `visibility: hidden`, which takes the element's background
   with it. It compensated by compositing each probe's own `background-color`
   back in, which cannot recover a text-bearing **ancestor's** fill — and this
   band's link sits inside its note paragraph. The glyphs are made transparent
   instead, so every background stays exactly as the browser painted it.
3. It mapped CSS-pixel rects onto a device-pixel screenshot, correct only at
   `deviceScaleFactor: 1`. The scale is derived from the returned image now.
4. Its stated "known limit" was narrower than its real one: it missed
   `background-image: url(...)` entirely and could be masked by an intermediate
   `z-index: 0` between the image and the section.

A fifth was caught by the guard rather than by reading: the predicate tested the
`<img>` for positioning, but PUB-001's hero carries `position: absolute;
z-index: -2` on its `<picture>` wrapper, so the hero reported as **not
photographic**. A discovery-based gate that discovers nothing is worse than the
hardcoded comment it replaced.

## Two defects in the inset

1. The cap lived inside `@media (min-width: 900px)` and the frame ran
   `width: 100%; height: auto` below it. Measured across twelve widths it was
   6.0% of the section's area at 1440 and **58.3% at 899px** — so
   "deliberately non-dominant", the whole justification for leaving §27.0 row 4
   at `image-led: false`, was true at the one width it was checked at and false
   across a 340px band. The cap is unconditional now: one 300×132 box at every
   width, 5.3%–13.4% of the section's area.
2. Placing it beside the order-flow strip at `min-width: 900px` left the strip
   512px of an 836px row, and its three steps **wrapped to two lines from 900px
   to about 1150px**. `order-flow` is a KEEP row whose `mock_treatment` reads
   "One row at every width the artboards cover" — a frame with no artboard broke
   a region that has one. The breakpoint is 1200px now; measured against a
   simulated pre-diff layout at twelve widths, the strip's height matches its
   pre-diff height at every one.

## A gate gap, tripped rather than reasoned about

`check:visual-registry` read the checked-in JSON and validated THAT, never
comparing it with what its own generator produces. Changing a focal point in
`scripts/visualAuthorityRegistry.mjs` and forgetting `-- --write` left the JSON
stale and the gate green — it printed "every dimension matches its file" while
the file said `66% 50%` and the generator said `66% 34%`. The check now diffs
the two and names the first differing line, with a positive control.

## Method

Rendered against `next start` on a production build at deviceScaleFactor 1.
Every capture asserts a 200 on the stylesheet AND that it applied before writing
a file — this run caught a 500 on a CSS chunk, from a server still holding a
`.next` that a rebuild had replaced underneath it, which is the same class of
failure that produced two convincing screenshots of an unstyled page earlier in
this branch's history.
