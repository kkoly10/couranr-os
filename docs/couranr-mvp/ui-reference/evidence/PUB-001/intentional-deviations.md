# PUB-001 intentional deviations

COURANR_VISUAL_FIDELITY_AMENDMENT.md §10: *"Each intentional deviation must name
the written authority that requires it"*, and *"'v2.2 prefers another composition'
is not a valid deviation justification when the mock explicitly depicts the
treatment."*

Every row below is a place where the shipped screen does not match the artboard.
Each names the authority that overrides the pixels. None of them is a preference,
and none is a composition budget — the two the budgets produced
(`delivery-options` and `pricing`) were reverted in this pass rather than
justified. `scripts/checkDriftLedger.mjs` fails any ledger row whose
`intentional_deviation` names no authority.

---

## Copy the artboard shows that written authority replaces

**1. There is no hero pill at all — the artboard shows one.**
Authority: **owner instruction, 2026-08-20 — "I don't want any eyebrows."**
Amendment §5.1 says the presence of a pill here is not itself a defect *and* that
the copy question between the artboard's `DELIVERY MADE SIMPLE` and MKT-002's
descriptor belongs to the owner rather than the agent. The owner settled it by
removing the pattern rather than choosing between the two strings. The element
and the `.cr-hero__label` rule are both deleted — an unused class is one import
away from returning, which is how the shared marketing eyebrow reached four
screens that had no mock. Amendment §6 bans the substitutes (pill, chip, tiny
uppercase label, badge, decorative rule) and the test suite asserts their absence
on all five public screens.

**Consequence to surface, not to paper over:** MKT-002's consumer descriptor
*"Local delivery for independent businesses"* lived only in that pill and is now
rendered nowhere. The registry line and the screen disagree until the owner
amends it. `BRAND_GUIDE.md:10` and `VIS-001` independently forbade the
artboard's typed tagline in a small header, so that half of the conflict was
already closed; this removes the other half.

**2. The hero headline words are MKT-002's, not the artboard's.**
Authority: amendment §1 — written product authority controls copy. Mock:
*"Your customers order from you. / Couranr handles delivery."* MKT-002:
*"Your customers want delivery. Now you can say yes."*

**3. Navigation labels are the registry's, not the artboard's.**
Authority: `UI_SCREEN_REGISTRY` navigation set, via `lib/couranr/navigation.ts`.
Mock: "How Couranr Works". Implementation: "How it works".

## Fixture data the artboard presents as fact

**4. No `$24.85` quote, no `VISA •••• 4242`, no `couranr.com/pay/XY7N-4829`.**
Authority: `TRM-001` and §19.5 — no fabricated specifics on the public surface.
The artboard embeds a product mini-composition inside each payer card. The cards
carry what each payer route **is**; they do not carry what one delivery cost.

**5. No per-stage timestamps on the proof timeline.**
Authority: `TRM-001`, §19.5. Same reason: what a proof *type* is remains a fact
about the product; what one particular delivery did is not.

**6. Six proof stages, not the artboard's five.**
Authority: `PRF-001`. The states are the product's own, the ones the delivery
detail screen renders.

## Claims nothing in the authority chain supports

**7. "Loading assistance available" is dropped from the coverage card.**
Authority: absence. Grepping `02_DECISION_REGISTRY.json` and `lib/couranr/**` for
loading assistance returns nothing, so shipping the line would invent a service.
Three assurance lines, not the artboard's four.

**8. No per-category "Typical items / Handling notes / Typical delivery details",
and eleven categories visible rather than six behind tabs.**
Authority: §27 Section 8 — *"Do not imply category controls eligibility where
product authority says it does not"* — against the Master Package's *"Category
controls initial recommendations, not eligibility."* No module maps a category to
items, handling, a distance band or a vehicle class; the tab panels would have to
invent their own difference. Eleven visible is more of the registry than the
artboard showed, not less.

**9. Three FAQ questions, not the artboard's five.**
Authority: MKT-002's FAQ set, which carries three governed answers. Answering
"What areas does Couranr serve?" and "How does delivery proof work?" here would be
writing product policy into a marketing file.

**10. The closing band carries no supporting line under the headline.**
Authority: absence. The artboard's *"Create your free business workspace and test
the workflow with a delivery that fits your day"* is written nowhere in the
authority chain.

**11. A schematic corridor rather than a geographic map.**
Authority: `SVC-002` is UNRESOLVED. A rendered map with a route line implies a
boundary Couranr has not decided. The SVG's own `<desc>` says it is not a service
area.

**12. The Ask Couranr card claims no assistant.**
Authority: `AIS-001`, plus the execution spec's AI-PROVIDER row mandating a
disabled/manual fallback. The artboard's card says *"Get quick answers from
Couranr Assistant"* over four prompt chips, two sparkle-marked as AI answers. The
card is built to the artboard's geometry and position; its content states that the
assistant is not live, every chip is real navigation to a route that exists, and
nothing accepts a typed question. This is the resolution of the ledger's
`ask-couranr` VERIFY row — the geometry was never the problem, the implied
capability was.

## Shell rules that outrank the artboard's chrome

**13. Three footer destination columns, not four.**
Authorities: the artboard's "Company" column (About, Careers, Press, Privacy
Policy) has **no routes** — a dead link is worse than a short footer. The "Now
serving" column is market copy, and `components/couranr/shell/shells.tsx` states
that no shell renders market, pricing, hours or payer copy; `MKT-001` owns the
markets and `SVC-002` is unresolved. PUB-001 renders the market sentence in its
own `service-areas` card instead. (It used to render it in a notice slot above
the header; the owner removed that bar on 2026-08-29 — see deviation 20.)

**14. No social icons and no copyright line in the footer.**
Authority: absence. No Couranr social account exists, and the legal entity name in
the artboard's *"© 2024 Couranr, Inc."* is not a settled fact.

**15. No dropdown chevrons on "Delivery Options" and "Businesses".**
Authority: `UI_SCREEN_REGISTRY`, via `lib/couranr/navigation.ts`, which gives the
public surface four flat destinations (PUB-008/009/010/011) and no sub-navigation.
A chevron would open nothing.

**16. The mobile header is a solid bar, not transparent over the hero photograph.**
Authority: §23.2's contrast floor. `.cr-topbar` is `position: sticky`, so a
transparent treatment stops being legible the moment the page scrolls past the
hero and onto light content. The artboard depicts only the unscrolled state.
Making it transparent-then-solid needs a scroll listener or a Chrome-only
scroll-driven animation; it is not built, and this is the one deviation in this
file that a future pass could reasonably close.

**17. There is no sticky bottom CTA bar — both artboards show one.**
Authority: **owner instruction, 2026-08-20 — remove it on mobile and desktop.**
It was built, because it is a mock-supported object the implementation was
missing. It is now deleted, along with the footer clearance it required, rather
than hidden.

**18. The mobile Ask Couranr launcher is a circular icon button, not the
artboard's labelled pill.**
Authority: a functional defect the artboard could not depict, which is a
different thing from a preference. Rendered as drawn, a 145px-wide floating pill
at 390px lands on the hero's full-width primary CTA and covers the end of its
label; a static composition cannot show an occlusion. As a 44px circle it is a
corner affordance instead. The label survives as the button's accessible name,
and 44px is the floor rather than a choice — `.cr-askc__pill` is a `<button>`,
so Gate B measures it against §23.6. **Desktop is unchanged** and still renders
the labelled pill bottom-right exactly as the artboard shows it.

**19. Seven channel tiles, not the artboard's six.**
Authority: `MKT-002 §10.4`, which requires every merchant-controlled channel to be
named. The artboard splits social into Instagram and Facebook brand marks while
dropping "point of sale" and "other channels you control". Written authority
governs the count and the naming; the mock governs the tile geometry, which is
reproduced.

**20. The notice bar is not built at all.**
Authority: owner instruction, 2026-08-29 — "remove the eyebrow at the top of the
homepage on mobile and desktop". Both artboards show a full-bleed service-area
bar above the header and it was built to match them, cream on desktop and navy
below 768px. Amendment 1 gives the mock precedence on **geometry**, not on
whether an element exists; the same reading settled deviation 1 (the hero pill)
on 2026-08-20. The bar lived in the `(public)` route-group layout, so it is gone
from every route in that group, not only PUB-001.

*Superseded:* this entry previously read "the notice bar's link is hidden below
768px", justified by the mobile artboard showing the sentence alone. That
deviation no longer exists because the bar does not.

**CONSEQUENCE TO SURFACE.** `UI_SCREEN_REGISTRY.md:151` lists *"service-area
notice"* among PUB-001's required states, and
`docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` records that state as
present. It now has no implementation, so the registry and the screen disagree
until the owner amends the registry line. This is the same open disagreement
deviation 1 left behind for `MKT-002`'s consumer descriptor. The MKT-001
*sentence* is NOT orphaned — the homepage's `service-areas` card and PUB-010
both render it verbatim — but the registry names the **notice**, not the
sentence, and that distinction is why the first draft of this removal wrongly
recorded "no consequence to surface".

## Implementation notes that are not deviations

The mobile primary CTA's right arrow is markup with `aria-hidden` rather than a
CSS `::after`, because generated content is read into a button's accessible name
in Chrome and Safari and *"Create your business account right arrow"* is noise.
The FAQ uses native `<details>`/`<summary>` rather than a scripted accordion. The
`pricing` and `service-area` cards remain two separate `<section>` elements inside
one grid wrapper rather than one merged section, because §27.0's identifiers are a
normative list and merging would have deleted one of them from the DOM to achieve
a layout. None of these changes what the screen looks like.
