# PUB-001 — Gate A, native-mock region review

§26 Gate A: open the canonical mock at its **native artboard dimensions**,
compare it against the implementation with a named-region checklist, and record
each intentional deviation with the higher authority that caused it.

No pixel diff. §26's pixel-diff policy permits one only when reference and
implementation are known to represent the same viewport contract, and they do
not here — the artboards are design exports at 1055×1491 and 941×1672, which
are not browser viewports. Rescaling them to 1440×1024 and reporting the
resulting noise as a fidelity number is the practice §24 names and forbids.

| | |
|---|---|
| Reference | `0E4F029F-22C3-4497-A00F-E355DCB3164D.png` — 1055×1491, upper page |
| Reference | `5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png` — 941×1672, full scroll |
| Reference | `22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png` — 941×1672, mobile |
| Source kind | design artboard — **not** a browser screenshot |
| Implementation | `3025946` + `8ed25ac`, revised for MKT-003, production build |
| Runtime widths | 360 · 390 · 768 · 1024 · 1280 · 1440 |
| Evidence | `e2e/artifacts/pub001/` |

---

## The headline finding: the mock and the blueprint disagree on the section list

This is the thing a pixel comparison would never surface and a region review
does immediately.

The artboard contains sections MKT-002's twelve does not:

- **Delivery options that fit your needs** — four service levels (Same-day &
  Priority, Scheduled & Next-day, Bulky & Extended-distance, Route Saver).
- **Describe the order. Couranr organizes the delivery.** — a navy Smart Intake
  demonstration: a free-text box on the left, a parsed delivery card on the
  right, an estimated price.
- **Support that already knows the delivery.** — a support-chat mock beside
  four capability lines.
- **Why businesses choose Couranr** — a six-item icon row.

And it renders sections the blueprint has, in a different arrangement: pricing
and coverage share one band rather than being two sections; the FAQ sits beside
an Ask Couranr panel rather than above a floating launcher.

**Resolution as first written: the twelve stand.** §27 states the approved
12-section content architecture remains authoritative, and §3's conflict rule
gives written specification control over content while the mock controls
composition. A section is content. So the four extra sections were recorded
here rather than built — not rejected, unrouted. And the note that closed it:
*"If the owner wants them on the homepage, that is an MKT-002 amendment, not a
visual decision, and it would change §27.0's table."*

**The owner amended it.** Directed to stay true to the mock, the owner approved
building **"Delivery options that fit your needs"**. That is now **MKT-003** in
the root decision registry, §27.0 carries a thirteenth row, and the section is
built — see the revised D-6 below.

The choice of that one section is not arbitrary. It was the only one of the
four that required no new product decision: every number in it is already
governed by SUR-001, SUR-002, MIL-002 and OVN-001, so building it is
transcription from the registry rather than invention. The other three each
need something nobody has decided — a Smart Intake parse and its example price,
support-capability claims, a six-item "why choose us" row — and remain
unbuilt.

---

## Region checklist

§26's fourteen named regions.

| # | Region | Verdict | Note |
|---|---|---|---|
| 1 | Overall silhouette | **aligned** | Light canvas, two navy full-bleed interruptions, navy close. Mock has three navy bands (adds the Smart Intake demo). |
| 2 | Major region order | **aligned within scope** | The twelve run in MKT-002 order. The mock interleaves its four extra sections between them. |
| 3 | Header / navigation proportion | **aligned** | 64px bar, wordmark left, links centre, Sign in + primary CTA right. Matches. |
| 4 | Typography hierarchy | **aligned** | Martian display against Inter body, 96 → 72 → 52 → 38 → 28 → 20/18 → 16. The mock's hierarchy is flatter than v2.2's scale; v2.2 governs (§11). |
| 5 | Headline measure / line breaks | **aligned** | 10–14ch target, three lines at 1440, three at 390. |
| 6 | Imagery placement and crop | **partial** | Hero matches, including the art-directed mobile crop. Category photography absent — see deviation D-1. |
| 7 | Content density | **aligned** | Marketing rhythm 104–144px desktop; the mock is comparable. |
| 8 | Primary vs secondary action hierarchy | **aligned** | Gold primary, outline secondary, in that order, in hero and close. |
| 9 | Card / panel count | **improved on the mock** | Mock leans on bordered cards in most sections; v2.2 caps grid-dominant at two and the implementation uses one. §19's hard rules govern. |
| 10 | Panel proportions | **aligned** | Image narratives at 45/55, split story at 38/62 — the mock's asymmetry, not 50/50. |
| 11 | Whitespace rhythm | **aligned** | §15's scale. |
| 12 | Section-to-section rhythm | **aligned** | No two adjacent compositions repeat — verified by test, not by eye. |
| 13 | Footer / closing treatment | **deviates** | See D-4. |
| 14 | Major visual anchors | **partial** | Hero photograph ✓, navy pricing band ✓, coverage map ✓, proof composition partial (D-2), category system absent (D-1). |

---

## Intentional deviations

Each names the authority that caused it. §26 requires this; a deviation without
a citation is just a difference.

### D-1 — the category system is a paragraph, not a tabbed explorer

**Mock:** six category tabs (Print & Signage, Boutiques & Retail, Florists &
Gifts, Auto Parts, Furniture & Home, Bakeries & Catering). The selected tab
reveals a photograph, "Typical items", "Handling notes" and "Typical delivery
details" including a distance band and vehicle class.

**Implementation, now:** the heading the mock uses — "Built for real local
businesses" — and **all eleven** governed categories, rendered from
`lib/couranr/categories/registry.ts`, with the general fallback marked as a
first-class choice and the purpose sentence beside them.

**Implementation, before:** a heading, a paragraph, and a link.

**What is still deviated:** the tab INTERACTION, and the per-tab content.

**Cause:** two, and both are real.

The photography does not exist — §21.1's inventory found the repository owns
two photographs, both already spent on the hero, and the brief for the missing
frames is `PUB-001_PHOTOGRAPHY_BRIEF.md`. The mock's category strip is exactly
where IMG-01…04 belong; the brief's four subjects and the mock's six tabs are
the same idea.

The tab content is unresolved product data, and this was checked rather than
assumed: grepping `lib/couranr/**` returns no module mapping a category to
items, handling, distance or vehicle; the Decision Registry has no category
record among its 45; and the one rule the Master Package does state is
*"Category controls initial recommendations, not eligibility."* A tab strip
whose panels differ would have to invent that difference. "Typical delivery
details" shows a distance band and a vehicle class per category — rendering
them would be inventing eligibility signals, which §27 Section 8 explicitly
forbids: *"Do not imply category controls eligibility where product authority
says it does not."*

So the breadth claim is made the honest way — eleven visible at once instead of
six behind tabs, which is more of the registry than the artboard showed. As a
side effect `/businesses` now renders the same eleven from the same module
instead of its own hand-typed copy, so the two public surfaces cannot drift
into advertising different categories.

**Closes when:** the photography lands. The tab content stays out until a
decision governs it.

### D-2 — the proof composition shows states, not proof artifacts

**Mock:** a five-stage timeline (Order ready → Picked up → In transit → At
delivery → Delivered) with timestamps, and beside it four artifact cards —
Recipient PIN verified, Delivery photo, Location, Signature.

**Implementation:** a six-state timeline, no artifact cards, no timestamps.

**Cause:** the timestamps in the mock are fixture data presented as a record,
and §19.5 plus TRM-001 both forbid fabricated specifics on the public surface.
The artifact cards are legitimate — they show *what kinds of proof exist*, not
a claim about a particular delivery — and one of the four carries a photograph
the repository does not have.

**Closes partly now:** the artifact row is buildable without the photograph and
is added in this pass. The photographic proof card waits with D-1.

### D-3 — pricing and coverage are two sections, not one band

**Mock:** "Simple per-delivery pricing" and "Local coverage where your business
needs it" share a single row.

**Implementation:** section 9 is a full-bleed navy pricing band; section 10 is
an image narrative carrying the corridor map.

**Cause:** MKT-002 treats them as separate sections, and §27.0 assigns them
different compositions precisely so two adjacent sections do not share one.
Merging them would put two structured blocks side by side and lose the rhythm
reset §19.6 exists to provide.

The substance agrees: the mock's price is $22.99 and its coverage map shows
Washington DC, Woodbridge, Stafford and Fredericksburg running north-east to
south-west. Both render from governed sources here — `BASE_PRICE_CENTS` and
`MARKETED_MARKETS` — and the corridor geometry independently matches the mock's.

**Closes partly now.** The two sections stay separate, but the part of the
pairing that carried information — the assurance list beside the map — is
built. THREE lines, not the mock's four: *"Loading assistance available"* is
dropped because searching the Decision Registry and `lib/couranr/**` for
loading assistance returns nothing, and shipping it would be advertising a
service no authority defines. The three that ship each render from something
governed — MIL-002's tiers and 100-mile threshold, `VEHICLE_CLASSES`, and
CAP-001's confirm-before-capture.

### D-4 — the footer is one row, not four columns

**Mock:** Product · Resources · Company · Now serving, plus social icons and
the tagline lockup under the wordmark.

**Implementation:** wordmark, one line of description, and the public
destinations that exist.

**Cause:** three constraints, none of them stylistic.

Most of the mock's links have no route — Help Center, Business Guides, About
Couranr, Careers, Press. A dead link is worse than a short footer.

"Now serving: Washington DC, Woodbridge, Stafford, Fredericksburg" is market
copy, and `shells.tsx` states no shell renders market, pricing, hours or payer
copy. That rule predates this work and holding it is correct.

There are no social accounts to link.

**Closes when:** those routes and accounts exist. The market column needs the
shell rule revisited, which is a decision, not a style change.

### D-5 — Ask Couranr is a launcher, not a panel

**Mock:** an "Ask Couranr" panel beside the FAQ with four suggested prompts.

**Implementation:** the existing floating launcher.

**Cause:** the suggested prompts in the mock imply answer capability that AIS
governs and that is not settled. The launcher is the shipped component and
carries its own constraints. Recorded, not changed.

### D-6 — three mock sections are not built (was four)

**Closed for one of them.** "Delivery options that fit your needs" is built, as
section 9, on the owner's decision recorded as MKT-003. Its composition is
§19.3 split story rather than the artboard's four-across card row: the artboard
stacks a card row (categories) directly above another card row (options), §19's
adjacent-duplicate rule is a hard rule, and row 9 of the checklist above had
already recorded the same judgment against the mock's other card-heavy
sections. The options keep their icons, titles, bodies and descriptor tags.

**Still open:** the Smart Intake demonstration, the support demonstration, and
the "Why businesses choose Couranr" row. Each needs something no decision
governs — the Smart Intake panel's parsed fields and its $24.85 example price,
support-capability claims beyond TRM-001's single approved sentence, and six
"why choose us" statements. Adding one is a content decision that belongs to
the owner, the way MKT-003 was.

---

## What the mock changed in the implementation

A review that only ratifies is not a review.

- **Proof artifacts** (D-2) — the artifact row is added. The mock was right
  that a timeline alone under-sells what proof means.
- **Confirmation of the corridor map** — the mock's coverage visual shows the
  same four markets on the same axis. The map was built from real coordinates
  before this comparison, and it agreeing with the artboard is corroboration
  that the geometry is right.
- **Confirmation of the section-8 photography slot** — the mock puts category
  photography exactly where the slot sits, which validates both the placement
  and the brief's subjects.

---

## Verdict

**Gate A: pass with six recorded deviations**, two of them now partly closed
(D-1's category set, D-3's assurance list) and one of them substantially closed
(D-6, by MKT-003). What remains open closes when the photography lands, a route
exists, or the owner makes a content decision.

No deviation is stylistic. Every one cites either MKT-002's section authority,
a governed-data constraint, an unresolved decision, or a missing asset.

Gate B and Gate C: pass — `npm run test:pub001`.
