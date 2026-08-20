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

**1. The hero pill does not read `DELIVERY MADE SIMPLE`.**
Authority: `BRAND_GUIDE.md:10` — *"Do not use the tagline inside small headers"* —
and `VIS-001` — *"Use the canonical supplied lockup; do not recreate with typed
text."* A typed tagline inside a small header breaks both. MKT-002's consumer
descriptor is used instead. The pill's **geometry** is unchanged and follows the
mock, including its mobile gold treatment (amendment §5.1 is explicit that the
pill's presence is not itself a defect).

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
markets and `SVC-002` is unresolved. PUB-001 renders the market sentence in the
notice slot above the header instead, where the *caller* supplies it.

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

**17. The mobile Ask Couranr launcher is a circular icon button, and it lives in
the bottom bar rather than floating.**
Authority: none in the artboard's favour — this is a functional defect the
artboard could not depict, which is a different thing from a preference. Both the
launcher and the sticky CTA are bottom-anchored. Rendered as the artboard draws
them, a 145px-wide floating pill at 390px lands on the hero's full-width primary
CTA and covers the end of its label; a static composition cannot show an
occlusion. The two are now one bar, so mobile has exactly one bottom-anchored
object and nothing floats over the page. The label survives as the button's
accessible name, and 48px clears §23.6's 44px floor. **Desktop is unchanged** and
still renders the labelled pill bottom-right exactly as the artboard shows it.

**18. The mobile hero pill has a translucent navy ground; the artboard's is a
bare outline.**
Authority: §23.2's contrast floor, measured rather than assumed. Over the mobile
crop, gold on the bare photograph is **1.80:1** against the 4.5:1 floor for
normal text. White would not have rescued it — over the same pixels white is
3.30:1 — because the pill sits over a bright part of *that* crop whatever colour
the text is. With the ground it measures **5.88:1**. The outline, the gold, the
radius and the position are unchanged, and desktop has no ground because it does
not need one (17.95:1 on its own crop).

**19. Seven channel tiles, not the artboard's six.**
Authority: `MKT-002 §10.4`, which requires every merchant-controlled channel to be
named. The artboard splits social into Instagram and Facebook brand marks while
dropping "point of sale" and "other channels you control". Written authority
governs the count and the naming; the mock governs the tile geometry, which is
reproduced.

**20. The notice bar's link is hidden below 768px.**
Authority: the mobile artboard itself, which shows the sentence alone. At 390px
the governed MKT-001 sentence already wraps to three lines; there is no room
beside it.

## Implementation notes that are not deviations

The mobile primary CTA's right arrow is markup with `aria-hidden` rather than a
CSS `::after`, because generated content is read into a button's accessible name
in Chrome and Safari and *"Create your business account right arrow"* is noise.
The FAQ uses native `<details>`/`<summary>` rather than a scripted accordion. The
`pricing` and `service-area` cards remain two separate `<section>` elements inside
one grid wrapper rather than one merged section, because §27.0's identifiers are a
normative list and merging would have deleted one of them from the DOM to achieve
a layout. None of these changes what the screen looks like.
