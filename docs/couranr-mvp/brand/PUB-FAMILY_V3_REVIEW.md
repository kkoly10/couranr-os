# V3 — the rest of the public marketing family

PUB-008 `/pricing` · PUB-009 `/businesses` · PUB-010 `/service-areas` ·
PUB-011 `/how-it-works`

| | |
|---|---|
| Composition authority | §27.1 of `COURANR_VISUAL_SYSTEM_V2_2.md` — one table and one budget line per page |
| Content authority | `UI_SCREEN_REGISTRY.md` required states; MKT-002 for claims and the supporting-page rule |
| Visual authority | **derived** from PUB-001 — recorded in `VISUAL_AUTHORITY_REGISTRY.json` |
| Canonical mock | **none exists for any of the four** |
| Gates run | B and C, six widths each, production build |
| Evidence | `e2e/artifacts/pub-family/` |

---

## Gate A cannot run, and this is what replaces it

`UI_SCREEN_REGISTRY.md` records all four as *"Derived from PUB-001 design
system; no separate approved mock."* §26's Gate A is a named-region comparison
against a canonical mock at its native artboard dimensions. There is nothing to
compare against, and comparing them against PUB-001's artboard would be
comparing each page against a picture of a different page.

§29 step 5 says to compare each sibling *"with its canonical mock, not merely
with the golden screen"* — which presumes one exists. Where it does not, the
substitute used here is:

1. **the family grammar PUB-001 proved** — §19's vocabulary, the adjacency
   rule, the grid cap, the token set, the type scale;
2. **the screen's own content contract** — its required states in
   `UI_SCREEN_REGISTRY.md`, which is a specification and outranks any mock;
3. **MKT-002's supporting-page rule** — *"The supporting pages deepen the
   homepage rather than repeat it."*

That third one is the substantive check, and it is the one a mock could not have
made. It is recorded per page below.

§25 requires that *"derived screens explicitly name the family/source they
derive from"* and that the validator check it. All four now carry
`visual_authority: "derived"`, `derived_from: {screen_id: "PUB-001"}` and a
`derivation_basis`, and `npm run check:visual-registry` fails if any of those is
missing — with a positive control that plants the omission.

---

## What each page was, and what changed

All four were the same shape: a centred hero, then bordered `Card` grids, then a
navy closing. That is the pattern §0 names — *"mechanically coherent and
commercially weak"* — and §19.7 permits panels only *"where the content is
genuinely discrete"*. A charge and its amount are one row of a schedule, not a
product tier.

### PUB-008 `/pricing`

Was: hero → three `Card`s → notice → a disclosure of three more `Card`s →
section → closing. Six card surfaces, one composition repeated.

Now: eight sections, four compositions, zero card grids. The base price gets the
navy band it deserves as the page's anchor fact; the mile tiers are a data
table; service levels and operating charges are ruled schedules; the
manual-quote notice is a statement rather than a footnote.

**Deepening:** the homepage's pricing band states the base price and that tiers
exist. This page carries the tiers themselves, the full service-level ladder,
every approved operating charge, and CAP-001's ordered authorize-review-capture
sequence — none of which appears on PUB-001.

**Fixed on the way:** `PricingDetails` had `800`, `1500`, `1499` and `70%` typed
in as literals. They agreed with CAN-001 and REF-001 only until either changed,
and nothing would have failed. They now render from `governed.ts` and are
registry-checked by `tests/couranr-public-claims.test.ts`.

### PUB-009 `/businesses`

Was: hero → an eleven-cell `Card` grid → a chip list → closing.

Now: six sections. The category grid stays — it is the one grid-dominant section
§27.1 allows this page, and eleven categories are genuinely discrete — but the
seven channels move onto a navy band framed as what Couranr does *not* take.

**Deepening:** PUB-001 now renders the same eleven categories, so repeating them
alone would breach MKT-002's rule. This page adds the selection mechanics — one
primary, up to three secondary, stamped with the registry version — and the
recommendation-not-eligibility rule in full. The homepage states the rule in one
sentence; this page states what it means in four.

### PUB-010 `/service-areas`

Was: hero → a four-`Card` market grid → a paragraph → one `Card` → closing.
No map at all, despite the corridor component existing.

Now: six sections, one image-led. The corridor is the subject here at full size
rather than a small supporting visual.

**Deepening:** the homepage shows the corridor small beside one sentence. This
page states the mileage relationship the homepage only alludes to, and gives
SVC-001's capture-for-review behaviour three ruled lines instead of one card.

**A defect the gates caught, and a wrong fix they prevented.** The first draft
carried a one-line note per market, keyed by the market's name.
`tests/decision-registry.test.ts` rejected it: keying prose by a literal market
name puts a copy of MKT-001 in the page that a rename would silently de-sync.
The obvious repair — keying by position in `MARKETED_MARKETS` — would have been
**wrong**, because the registry's order is not the geographic one; Woodbridge is
third in the registry and second on the road. The notes were dropped. The
corridor map already carries the geography, from real coordinates.

### PUB-011 `/how-it-works`

Was: hero → two `Card`s of numbered lists → a three-`Card` benefits grid →
closing. §19.4's *"four detached identical cards when the content represents one
process"*, twice in one page.

Now: seven sections, **zero** grid-dominant, one connected workflow rail, one
product proof. §27.1 states that zero budget explicitly — every card grid on
this page would be a process rendered as detached tiles.

**Deepening:** the homepage shows a four-step rail and names four proof
artifacts. This page carries CAP-001's full ordered sequence and PRF-001's
requirements *by handoff type* — direct handoff, signature, leave-at-door — plus
the two things never collected on any delivery. A proof section that lists only
what is captured reads as surveillance; the limit is the reassurance, so it is
stated rather than omitted.

---

## What the gates found

Every one of these was found by running the page, not by reading it.

| # | Defect | Found by |
|---|---|---|
| 1 | `.cr-hero__eyebrow` is white — it was written for text over PUB-001's photograph. Reused on a light canvas it computed **1.06:1**, which is invisible text on all four pages. | Gate C, axe `color-contrast` |
| 2 | `.cr-table thead th` paints muted on sunken: **4.45:1**, under the 4.5 floor. Repo-wide in the token pair, invisible until /pricing rendered the first real table. | Gate C, axe |
| 3 | A `<Text>` inside a `<p>` on /service-areas. `Text` renders a `<p>`, `<p>` cannot nest, the browser auto-closed the outer one, and the server HTML and client DOM disagreed — **React #418 at every width**. | Gate B, console-error check |
| 4 | The editorial statement clamps to 24ch. Used as a page hero it clamped the eyebrow (wrapping "SIMPLE PER-DELIVERY PRICING" mid-phrase), the lead and the CTA row — and PUB-011's headline ran to **eight lines**. | Reading the rendered screenshot |
| 5 | The desktop workflow rail is `repeat(4, 1fr)`. PUB-011's six steps wrapped to 4 + 2 with the connector spanning only the first row — a sequence that visibly broke in half. | Reading the rendered screenshot |

Defects 4 and 5 are the ones that matter for the method: both pages passed every
automated gate while looking wrong. Gate B proves nothing overflows; it does not
prove a headline is readable. §26 has three gates for a reason.

---

## Verdict

**Gate B and Gate C: pass**, all four pages, six widths, axe-core 0 violations
each — `npm run test:pub-family`, against a production build.

**Gate A: not applicable**, replaced by the family-coherence review above. It
becomes applicable the day any of these four gets a canonical mock, and the
visual-authority record would change from `derived` to `canonical` in the same
commit.

**Still open across the family:** none of the four carries photography, and none
should invent any — §27.1 states their image-led floors at zero deliberately.
PUB-010's corridor is a schematic, not a boundary, and stays that way while
SVC-002 is unresolved.
