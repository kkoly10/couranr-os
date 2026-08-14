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
| Implementation | `3025946` + `8ed25ac`, production build |
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

**Resolution: the twelve stand.** §27 states the approved 12-section content
architecture remains authoritative, and §3's conflict rule gives written
specification control over content while the mock controls composition. A
section is content. So the four extra sections are **out of scope for PUB-001**
and are recorded here rather than built.

They are not rejected — they are unrouted. Several are real product surfaces
that already exist (Smart Intake is MER-005; support is MER-012). If the owner
wants them on the homepage, that is an MKT-002 amendment, not a visual
decision, and it would change §27.0's table.

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

**Implementation:** a heading, a paragraph, and a link to `/businesses`.

**Cause:** two, and both are real.

The photography does not exist — §21.1's inventory found the repository owns
two photographs, both already spent on the hero, and the brief for the missing
frames is `PUB-001_PHOTOGRAPHY_BRIEF.md`. The mock's category strip is exactly
where IMG-01…04 belong; the brief's four subjects and the mock's six tabs are
the same idea.

The tab content is also unresolved product data. "Typical delivery details"
shows a distance band and a vehicle class per category — neither is governed.
Rendering them would be inventing eligibility signals, which §27 Section 8
explicitly forbids: *"Do not imply category controls eligibility where product
authority says it does not."*

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

**Cause:** MKT-002's twelve treats them as separate sections, and §27.0 assigns
them different compositions precisely so two adjacent sections do not share
one. Merging them would put two structured blocks side by side and lose the
rhythm reset §19.6 exists to provide.

The substance agrees: the mock's price is $22.99 and its coverage map shows
Washington DC, Woodbridge, Stafford and Fredericksburg running north-east to
south-west. Both render from governed sources here — `BASE_PRICE_CENTS` and
`MARKETED_MARKETS` — and the corridor geometry independently matches the mock's.

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

### D-6 — four mock sections are not built

Delivery options, the Smart Intake demonstration, the support demonstration,
and the "Why businesses choose Couranr" row. See the headline finding above:
MKT-002's twelve is the content authority, and adding a section is a content
decision.

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

**Gate A: pass with six recorded deviations**, four of which close when the
photography lands or a route exists, and two of which are content decisions
that belong to the owner rather than to this implementation.

No deviation is stylistic. Every one cites either MKT-002's section authority,
a governed-data constraint, an unresolved decision, or a missing asset.

Gate B and Gate C: pass — `npm run test:pub001`.
