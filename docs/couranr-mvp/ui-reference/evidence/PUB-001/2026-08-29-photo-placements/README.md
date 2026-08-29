# 2026-08-29 photo placements — rendered evidence

The owner accepted four more photographs and asked where else the public
surface could carry an image. Two were placed, two were registered as reserves.
Each capture below backs a specific claim; a screenshot with no assertion behind
it is decoration.

This folder sits under `evidence/PUB-001/` and holds a PUB-011 capture, which
follows the convention `2026-08-visual-batch/` already set — that folder carries
`pricing-*` (PUB-008) and `businesses-strip-*` (PUB-009) shots for the same
reason. `evidence/PUB-001/` is the public-family evidence root, not the PUB-001
folder its name suggests.

| File | What it shows | What it backs |
|---|---|---|
| `home-order-channels-1440.png` | The seven tiles, the convergence resolving on the app mark, and the order-flow strip with a 300×132 inset beside it | The inset is a SUPPORTING frame: 300px of a 1136px content row, 132px against a 580px section. §27.0 row 4 declares `data-image-led="false"` and the composition test asserts that as equality, so the flag stays literally true |
| `home-order-channels-390.png` | The same stacked — tiles, then the frame full width, then the strip | The convergence is correctly absent below 1088px, where the tiles wrap. The frame is full width here because at 358px an inset is not a composition, it is a thumbnail |
| `how-it-works-confirmation-1440.png` | PUB-011's `confirmation` band with the photograph full-bleed behind the copy | §19.6 `full-bleed-interruption` reads "Navy **and/or approved photography**", and PUB-011 is `visual_authority: "derived"` — no artboard governs it. `data-image-led` moved false → true and §27.1 row 4 moved in the same commit |
| `how-it-works-confirmation-390.png` | The same band at 390, copy over a visibly present frame | The narrow-width scrim replacement works: the photograph is still readable as an image rather than erased to flat navy |
| `how-it-works-confirmation-390-BEFORE-scrim-fix.png` | **The defect.** The same band with the desktop horizontal gradient put back | White copy running onto the bright window and plant at the frame's right. Measured 4.08:1 against §23.2's 4.5:1 floor. Reproduced by re-injecting the one superseded declaration over the shipped build, not by reverting the file |

## The defect this pass found, and the gate that now catches it

`.cr-mkt-band__scrim` was a 90deg gradient, `0.95 → 0.88 → 0.52`. That is a
desktop assumption: `.cr-mkt-band__inner--stacked` caps the copy at 62ch, so at
1440 the copy's right edge sits at 45% of the band, well inside the 0.88 stop.
Below 900px the copy spans the full width and runs into the 0.52 tail, straight
over a blown highlight in the frame (~240,240,237).

Measured with the copy hidden and the painted pixels sampled, as §23.2 requires.
Both columns are the SAME probe run against the same build twice — the heading's
white against the single LIGHTEST pixel anywhere under the copy block, which is
the strictest reading available and the one that found the defect:

| Width | Before | After |
|---|---|---|
| 1440 | 14.90:1 | 14.90:1 |
| 1280 | 14.90:1 | 14.90:1 |
| 1024 | 11.81:1 | 11.81:1 |
| 768 | 6.27:1 | 10.61:1 |
| 390 | **4.08:1** | 10.09:1 |
| 320 | 4.75:1 | 10.69:1 |

The shipped gate is stricter in one way and looser in another, so its numbers
differ and are reported separately rather than mixed into the table above. It
measures each text element on its own — including the `0.7`-alpha note and the
gold link, which the block-level probe never isolated — but takes the 99th
luminance percentile rather than the single brightest pixel, so no lone
sub-pixel decides a verdict. Its worst reading across all four elements and all
six widths is **6.22:1** (the gold link at 390) against a 4.5:1 floor.

No gate saw it, for two compounding reasons. axe-core reports text over a
background image as `incomplete`, not as a violation. And `e2e/publicFamilyGates`
carried a comment saying "none of these four renders text over photography, so
the measurement PUB-001 needs has nothing to measure" — true when written, false
the moment this band took a photograph.

That harness now DISCOVERS photographic sections at each of §24.1's six widths
rather than carrying a claim about which pages have them, and measures every
text element in one against its own painted ground, compositing the glyph's own
alpha (this band's body is `rgba(255,255,255,0.86)`, its note `0.7`) and deriving
the 3:1 / 4.5:1 floor from computed font metrics. `e2e/pub001Gates` gained the
matching guard: it asserts the hero is the ONLY photographic section on PUB-001,
so a second one cannot appear unmeasured.

Both are proven able to fail. `test:pub-family --positive-control` removes the
scrim under the band and requires the headline to be reported failing; it drops
to 1.84:1 and is caught.

## A second gate gap, found by tripping it

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
