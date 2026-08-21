# PUB-001 — desktop typography hotfix

Branch `claude/couranr-phase-0-readiness-se3gdz`. Base is `main` at `a895462`
(PR #30, "Visual System v2.2, and PUB-001 reconciled to the artboard pixels"),
which is what the owner reviewed on the deployed site and rejected.

**This document does not score the work.** The gates below are green and that is
a statement about functionality, responsiveness and accessibility only. Whether
the page now looks right is the owner's call, and it has not been made.

## Before / after

| | before (deployed `a895462`) | after |
|---|---|---|
| `before-hotfix-1440.png` | `after-hotfix-1440.png` | full page, deviceScaleFactor 1 |
| `before-hotfix-1280.png` | `after-hotfix-1280.png` | |
| `before-hotfix-390.png` | `after-hotfix-390.png` | |

Page height at 1440: **6605px → 5738px**. Nothing was deleted to achieve that;
it is entirely the type scale and two measure corrections.

The "before" set was captured from the DEPLOYED site through a request relay
(`scripts/captureDeployed.mjs`), because Chromium in this container cannot open
an outbound connection to any external host. The relay satisfies the page's
requests from Node, which can reach the host over ordinary verified TLS. That
makes the pixels real but bypasses the production network path, so the before
screenshots prove what the deployed HTML and CSS render — not what a real
visitor's network would deliver.

---

## Region by region

Each row: what the problem was, the CSS that actually caused it, what changed,
the resulting computed values, why it is closer to the mock or the owner's
direction, and whether a direct mock reference exists.

### 1. Hero headline — first clause

**Problem.** At 1440 the headline rendered 96px and its longest line spanned
1140px, **79% of the viewport**. At 1280 that was 89% and at 1024 it was 94% —
the type got proportionally *larger* as the frame got smaller.

**Cause.** Two separate things, neither of them the typeface.
`--couranr-type-hero-max: 6rem` set the ceiling, and
`font-size: clamp(3rem, 7vw, 6rem)` reached that ceiling at an **857px**
viewport. Above 857px the size was pinned while the viewport kept growing, so
the clamp was doing nothing at any desktop width. The measure is written in `ch`,
which only holds its proportion if the size tracks the viewport.

**Change.** Max 96 → **60px**; the vw coefficient 7 → **4.2** (60/1440 = 4.17vw,
so the clamp now interpolates across the whole desktop range instead of being
saturated). `font-stretch: 112.5%` removed from the role — compared at identical
size, the extended width is most of what made the headline read as shouting.
`line-height` 0.96 → 1.02 and tracking −0.04em → −0.025em, because the tight
values were holding a too-large headline together and closed the lines up past
legibility at 60px.

**Computed now.** 1440: **60px**, 690px measure, 2 lines, **48% of viewport**.
1280: 53.76px, 600px, 47%. 1024: 48px, 525px, 51%. 390: 48px, unchanged.

**Why closer.** Martian Grotesk's cap/font ratio measured from our own render is
**0.802** (77px cap at 96px). That makes the artboard's cap heights convertible:
hero cap 36 → 45px equivalent. The mock's longest hero line spans roughly 47% of
its own frame; ours now spans 48% at 1440 and 47% at 1280. Two independent
routes — the container proportion and the mock's cap ratio — both land near 60.

**Mock reference.** Yes: `0E4F029F-22C3-4497-A00F-E355DCB3164D.png` (desktop),
`22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png` (mobile).

### 2. Hero headline — second clause

**Problem.** "Now you can say yes." ran **inline, at the identical 96px**, and at
desktop widths it is white — so at 1440 nothing whatsoever distinguished it from
the clause before it. It was the tail of one very long sentence.

**Cause.** The markup had no element for it to be. There was one text run in the
`h1` with a colour-only span.

**Change.** The `h1` now holds two explicit blocks with independent measures.
The words are unchanged and remain MKT-002's verbatim.

```
<h1 className="cr-hero__h1 cr-type-hero">
  <span className="cr-hero__h1-lead">Your customers want delivery.</span>{" "}
  <span className="cr-hero__h1-accent">Now you can say yes.</span>
</h1>
```

**Computed now.** 1440: **49.8px** (0.83em), own line, 888px measure, 1 line.

**Why closer.** 0.83 is not a chosen value — it is the artboard's own ratio of
the second clause's cap height (30) to the hero's (36). The mock gives the clause
its own line at a smaller size; the implementation now does the same.

**Mock reference.** Yes, both artboards. **The drift ledger's `hero-headline` row
was wrong** and has been corrected: it was classified `KEEP` on a comparison that
checked colour only, while the `mock_treatment` column on that same row already
recorded "second part on its own line at a slightly smaller size." A row is only
`KEEP` when every attribute in `mock_treatment` has been compared, not the one
that prompted the `VERIFY`.

### 3. Hero headline — word spacing on the second clause

**Problem.** Found by reading the render after the change above, not before it.
The new clause read **"Nowyou can sayyes."**

**Cause.** Two compounding things.
(a) `letter-spacing: -0.025em` on `.cr-type-hero` computes to an absolute
`-1.5px` against the 60px lead and **inherits as that px value**, so the 49.8px
accent was tracking at −0.030em — 20% tighter than the clause above it.
(b) Martian Grotesk's `w` and `y` carry almost no side bearing. Measured on the
render, the `w y` and `y y` joins closed to an **8px** ink gap against **18px**
at `u c` and `n s` on the same line.

**Change.** `letter-spacing: -0.025em` restated on `.cr-hero__h1-accent` so it
resolves against its own size, plus `word-spacing: 0.08em`. Word-spacing is the
right instrument because it moves only the space character and leaves the
letterform rhythm identical to the lead clause. Rendered at 0, 0.05, 0.08 and
0.12em before choosing: 0.05 still closes `y y`; 0.12 opens `can say` until the
line stops cohering.

**Computed now.** tracking −1.245px, word-spacing 3.984px at 1440.

**Mock reference.** No — this is a rendering defect the artboard could not
depict, since a static composition shows one set of glyph pairs at one size.

### 4. Hero supporting copy

**Problem / change.** 22px → **20px**. `--couranr-type-lead-max` 1.375rem →
1.25rem.

**Why.** The mock's hero support is 0.36× its headline cap. Nothing else changed.

**Mock reference.** Yes, both artboards.

### 5. `pickup-problem` — the worst defect on the page

**Problem.** A **72px heading inside a 240px column**: five lines, with a
mid-word break, in a section that is otherwise empty to its right.

**Cause.** `max-width: 24ch` was written on `.cr-mkt-editorial` — the SECTION —
and `ch` resolves against the element it is written on. The section's font is the
body face at body size, so 24 of its characters are 240px. The heading is the
display face, where 16 of ITS characters need about 544px at 44px.

**Change.** The measure moved to `.cr-mkt-editorial > h1, > h2` at 16ch, so it
resolves on the element it describes. The `--hero` modifier already used this
shape (`max-width: none` on the section, 18ch on its headings), so this makes
the base rule consistent with its own modifier rather than inventing a pattern. `--couranr-type-statement-max` 72 → **44px**, and the
statement clamp coefficient 5vw → 3.1vw.

**Computed now.** 1440: **44px** in **544px**, 2 lines. 1280/1024: 40px in 496px.

**Why closer.** This is the case the brief flagged: **no artboard covers this
region**, so 72px was never approved by anything. Where the mock is silent, v2.2
governs (fidelity amendment 14), and the statement role is what applies. The
ledger row has been rewritten to say so — it previously read "oversized editorial
statement, no container", which described the defect as if it were a decision.

**Mock reference.** No. Ledger row carries the `(none — no artboard covers this
region)` marker.

### 6. Marketing section headings

**Problem / change.** 52px → **40px**. `--couranr-type-marketing-section-max`
3.25rem → 2.5rem, clamp coefficient 4vw → 2.8vw.

**Why closer.** 0.69 is the artboard's ratio of section-heading cap (25) to hero
cap (36). The deployed page ran 1 : 1.0 : 0.54 against the mock's 1 : 0.83 : 0.69
— the section headings were proportionally *too small* against a hero that was
too large, so this number falls out of fixing the hero.

**Mock reference.** Yes, for the four centred single-line section headings the
artboard covers.

### 7. A fifth heading role — column headings

**Problem.** After the section size dropped to 40px, H2s sitting inside a narrow
copy column beside a visual or a list still wrapped to three lines and read as
statements they are not.

**Change.** `.cr-mkt-narrative__copy > h2` and `.cr-mkt-split__lead > h2` get
`clamp(1.75rem, 2.4vw, 2.125rem)` — 28 → **34px**.

**Not** `.cr-mkt-proof__copy > h2`. That selector was in this list for one render
and it was wrong: the proof copy sits full width above its panel, so
"Couranr-managed, with proof" is a primary section heading, and demoting it made
the page's largest product composition look like a footnote. Caught by reading
the render.

**Mock reference.** No. The artboard's section headings are centred, single-line
and introduce a row beneath them; these are a different shape the mock does not
cover, so v2.2 governs. Recorded in §12.1 so it is not mistaken for drift.

### 8. Proof paragraph measure — a rule that never applied

**Problem.** One paragraph running **1014px, ~80 characters a line**, against
40–77 everywhere else.

**Cause.** This one is worth stating plainly because it is the defect that got
furthest. `.cr-mkt-proof__copy p { max-width: 62ch }` was written as part of this
hotfix, reviewed, built and rendered — and **never applied**. A second
`.cr-mkt-proof__copy p` rule later in the same file had identical specificity and
set `78ch`. Nothing was red. Reading the CSS showed a correct rule. Only
measuring the element in a browser showed 1014px.

**Change.** One rule, at 62ch, which is the measure the rest of `couranr.css`
already uses. The dead duplicate is gone.

**Computed now.** **806px**, 5 lines, ~64 characters.

**Mock reference.** No — the `product-proof` ledger row describes composition
(copy above a full-width panel), not measure.

### 9. Two orphaned words

`.cr-mkt-card__h2` and `.cr-mkt-section--centred > p` get `text-wrap: balance`.
"Pricing you can put on a sticky note" was breaking after "sticky"; the centred
lead under "Keep selling your way" was breaking 78 characters against 15.
Balance is already this stylesheet's tool for exactly this
(`.cr-mkt-channel__label`, `.cr-mkt-proof__note`).

### 10. A dead declaration removed

`.cr-hero__h1-accent { color: var(--couranr-gold) }` in the base block could
never win at any width — the art-direction pair later in the file (unconditional
`text-inverse`, `gold` below 768px) has the same specificity and comes after it.
Removed. Dead declarations read as intent.

---

## Mobile

Mobile was not what was rejected and the **minima are unchanged** at
48/40/32/18. Verified at 390: hero lead 48px over 4 lines, accent 39.84px gold
over 2 balanced lines with no orphan, section headings 40px, no horizontal
overflow. `text-wrap: balance` was removed from the hero role for desktop and
**re-added below 768px only**, where the artboard expresses no specific break.

Checked at 1440, 1280, 1024, 768 and 390. `document.scrollWidth` equals the
viewport at every one.

---

## Gates

All run locally. GitHub Actions is not a gate here — see `CLAUDE.md`.

| gate | result |
|---|---|
| `npm run lint` | pass, 0 errors |
| `npm run typecheck` | pass |
| `npm run test:run` | **53 files, 2014 tests** pass |
| `npm run build` | pass (clean `.next`) |
| `check:routes` `check:legacy-imports` `check:mocks` `check:migrations` | pass |
| `check:visual-system` `check:visual-registry` `check:drift-ledger` | pass |
| `check:gates:controls` | pass |
| `test:pub001` (Gate B + Gate C) | pass — axe 0 violations at 1440 **and** 390; all contrast samples pass |
| `test:pub-family` | pass, 4 pages |
| `test:shell-chrome` | pass, 41 assertions |
| `test:fonts` | pass, 2 UNVERIFIED (Operations and Driver have no authenticated harness) |

### Test audit — does anything freeze a rejected value?

`grep` for `96px`, `6rem`, `4.5rem`, `3.25rem`, `7vw`, `5vw`, `78ch`, `72px` and
`font-stretch` across `tests/`, `e2e/` and `scripts/`: **no test asserted any
rejected value.** The only hits are in `e2e/fonts.mjs`, which measures whether
the variable font's **width axis is exposed** by rendering the same string at two
`font-stretch` values. That is independent of whether any type role uses the
axis, so removing `font-stretch: 112.5%` from `.cr-type-hero` does not affect it,
and the suite still passes.

### A new gate, with positive controls

`test:pub001` gained a measure check, because every existing gate passed while
the 78ch shadow was live.

1. Four named elements must render at the width and size this hotfix set, ±1px.
2. A generic floor: **a heading's measure must be at least 8× its own
   font-size.** This is the `ch`-scope bug written as something a browser can
   check. The narrowest legitimate heading on this page is 11.7×; the defect was
   3.3×.

Both halves were verified by replanting the defects, rebuilding and re-running:

```
FAIL  @1440 measure .cr-mkt-proof__copy p: 1014.0px at 20px (hotfix set 806px at 20px)
FAIL  @1440 measure .cr-mkt-editorial > h2: 160.0px at 44px (hotfix set 544px at 44px)
FAIL  @1440 heading "Pickup-only means lost orders…" has a 160px measure at 44px
      — 3.6x its own size, below the 8x floor
```

The controls were then reverted and the gate returns green.

An earlier draft of this gate policed page-wide characters-per-line. It was
withdrawn: its selector missed the very paragraph that motivated it, and making
its bounds fit the page meant tuning numbers until they passed. A check that is
tuned to pass is worse than no check.

---

## Open, and deliberately not settled here

- **`62ch` does not mean 62 characters.** It is the house measure throughout
  `couranr.css`, but `ch` tracks the font, so the same token yields ~64
  characters at 20px, 77 at 16px and 87 at 14px. Whether small copy should carry
  a tighter value is a page-wide typography decision.
- **The four `delivery-options` card bodies render ~27 characters a line** in a
  178px column. The artboard mandates four cards in one row and the ledger row
  carries a canonical reference, so the mock outranks a readability heuristic
  here. Flagged, not changed.
- **`/help` returns 404** and it is linked twice from this page:
  `app/(couranr)/(public)/page.tsx:996` (the Ask Couranr card's "More questions?
  Contact Couranr Support") and `components/couranr/shell/shells.tsx:164` (the
  footer). Verified with `curl` against the local production server.
  Pre-existing, unrelated to typography, recorded so it is not lost.
- **Two capture runs wrote screenshots of a completely unstyled page** before the
  problem was noticed, because `next start` was serving HTML referencing a CSS
  chunk a rebuild had replaced. The capture script now asserts the stylesheet
  applied before it writes anything. Both bad files were overwritten.

---

## What this hotfix did not do

- **PUB-001 is not promoted to visual completion.** `check:drift-ledger` was run
  WITHOUT `--promote`, which is the flag that asserts a screen is visually done;
  its own output still ends "run with `--promote` before claiming visual
  completion." The ledger is unchanged in classification — all 24 rows remain
  `KEEP` — and two rows had their descriptions and notes corrected.
- The revised type scale is **not** propagated to Merchant, Driver, Operations or
  Customer.
- No Supabase schema, RLS, payment or production-data change. No migration. No
  production canary. Nothing was run against the live database.
- No governed words changed. MKT-001, MKT-002 and the pricing figures are
  untouched; only the elements they sit in changed.
