# 2026-08-28 visual batch — rendered evidence

Screenshots of every region this batch changed, at the two widths the visual
system art-directs for. Each backs a specific claim; a screenshot with no
assertion behind it is decoration.

| File | What it shows | What it backs |
|---|---|---|
| `home-category-breadth-1440.png` | The four accepted frames as a staggered mosaic beside the copy | The `Photography pending` placeholder is gone; four frames, no card wrapper, no caption |
| `home-category-breadth-390.png` | The same four as a 2×2 of **square** crops | Art direction, not a resize — at 175px a 3:2 crop loses its subject |
| `home-outcomes-1440.png` | Copy, the ruled list of six, then a two-frame photographic band across both columns | `data-image-led` is now true and the page earns it. The band spans both columns because the in-column version measured a 447px void |
| `home-outcomes-390.png` | The same stacked, support as a 16:9 letterbox | The 2:1 letterbox cut the top of the subject's head; 16:9 at `object-position: 60% 28%` does not |
| `home-workflow-rail-1440.png` | The four step titles on ONE baseline | The refinement: `grid-template-rows: auto 1fr`. Before it the marker row absorbed the stretch slack at 65.7/44/54.8/44px and the titles sat on three baselines |
| `businesses-strip-1440.png` | The three-frame strip above the eleven-item category grid | Restrained and secondary — 216px of a 660px section against a 259px grid, so `grid-dominant` stays true and `image-led` stays false |
| `businesses-strip-390.png` | The same stacked | No second gallery |
| `pricing-loaded-miles-1440.png` | Pickup → included → tiered → drop-off, horizontal | Panel D, native. Every figure resolves from `governed.ts`: $22.99, 3 miles, mile 4, $2.25–$4.75, over 100 |
| `pricing-loaded-miles-390.png` | The same, vertical | A different layout, not a shrunk one — a five-part horizontal track at 390 gives each leg ~70px |
| `pricing-auth-capture-1440.png` | Five steps, each with its money state in its own column | Panel E, native. The five CAP-001 statements are unchanged; what is new is when the money moves |
| `pricing-auth-capture-390.png` | The same stacked, state beneath each step | |
| `pricing-diagrams-grayscale-1440.png` | Both diagrams desaturated | **Works without colour.** "Nothing charged" carries no glyph, "Held" a padlock, "Charged" a tick; the track is solid against dashed. Nothing needs hue to be read |

## Not shown, because nothing changed

`hero`, `order-channels`, `payer-choice`, `product-proof`, `categories`,
`delivery-options`, the homepage pricing/service-area pair, `faq` and `closing`
are all KEEP regions this batch was not allowed to reopen, and did not. They were
inspected in the full-page captures at 1440 and confirmed intact.

## Method

Rendered against `next start` on a production build, at deviceScaleFactor 1.
Every capture run asserts the stylesheet actually applied before it writes a
file — two earlier runs in this session produced plausible-looking screenshots of
a completely unstyled page, because the server was serving HTML that referenced
a CSS chunk a rebuild had replaced.
