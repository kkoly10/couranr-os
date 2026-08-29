# 2026-08-29 — the service-area notice bar is removed

The owner removed the full-bleed bar above the public header, on mobile and
desktop. It is a route-group element, so it came off **every route in the
`(public)` group — eleven, not the five marketing pages** this document first
claimed.

| File | What it shows | What it backs |
|---|---|---|
| `home-top-1440.png` | The homepage opening on the white header, hero immediately beneath | The bar is gone at desktop. The topbar's `getBoundingClientRect().top` is 0 rather than 47 |

| `home-top-390.png` | The same at 390 — wordmark, hamburger, then the hero | The bar is gone at mobile. It was NAVY here, so its removal is the more visible of the two |

## Both artboards show the bar; it is deliberately not built

`0E4F029F-…png` and `22D9363D-…png` both show a full-bleed notice above the
header, cream on desktop and navy on mobile. The fidelity amendment gives the
mock precedence on **geometry**, not on whether an element exists at all — the
same distinction that settled `hero-small-label` on 2026-08-20, when the owner
removed the artboards' eyebrow pill. Written owner instruction wins on presence.

## CORRECTION — there IS a consequence, and the first draft missed it

This document originally said "no consequence to surface". That was reached by
checking one thing and generalising. The correction matters more than the
original claim.

`UI_SCREEN_REGISTRY.md:151` lists **"service-area notice"** among PUB-001's
required states, and `SCREEN_IMPLEMENTATION_LEDGER.csv` recorded it as present.
The registry names the NOTICE, not the sentence. That state now has no
implementation, so the registry and the screen disagree until the owner amends
the line — the same open disagreement `hero-small-label` left behind for
MKT-002's consumer descriptor, which this document claimed to differ from. Both
ledgers now record it.

## What IS safe: MKT-001's sentence is not orphaned

The sentence has two homes that predate the bar:

- `app/(couranr)/(public)/page.tsx:1113` renders `MARKETS_PUBLIC_COPY` in the
  homepage's service-areas card;
- `app/(couranr)/(public)/service-areas/page.tsx:36,77` renders it as the page
  description and in the body.

Verified in the browser rather than by grep: the verbatim sentence is still
present in `document.body.innerText` on `/` and `/service-areas` at both widths,
and absent from the three pages that never carried it in the body.

## The slot went with the element

`PublicShell` no longer takes a `notice` prop,
`components/couranr/marketing/PublicNotice.tsx` is deleted, and the
`.cr-topnotice` rules are removed. An unused slot is one caller away from
returning — this repository's own precedent is the shared marketing eyebrow that
reached four screens with no mock because the class outlived its element, which
is why `.cr-hero__label` was deleted rather than left unused.

`IconPin` survives: `PricingDiagrams.tsx` still uses it.

**And a guard was added, which the first draft did not have.**
`tests/couranr-visual-tokens.test.ts` now asserts all four halves — no
`.cr-topnotice` in any canonical file, no `PublicNotice` identifier, no `notice=`
on `PublicShell`, and no `PublicNotice.tsx` on disk. Removing an element without
a guard is exactly how the shared eyebrow came back on four screens. Proven able
to fail by planting a `notice=` prop on the layout and watching the suite go red.

## A malformed ledger row, and the gate that let two of them through

The `top-notice` row shipped as **17 fields against an 11-column header** — its
prose was written into unquoted cells and split on its own commas, so `evidence`
and `notes` were read out of the middle of a sentence. `check:drift-ledger`
printed "ok", because its only structural check compared the HEADER to the
amendment and never counted a data row's fields.

Counting them found a second row already merged to `main`: `order-channels`, at
19 fields, from r10's own note. Both are rebuilt with a CSV writer. The checker
counts fields per row now, with a positive control that unquotes a comma-bearing
cell and requires the failure.

`e2e/shellChrome.mjs` keeps its generic sticky assertion — pinned at the CSS
`top` offset and still on screen — rather than reverting to the older
`after === before`. The notice bar is *why* that equality was wrong; the generic
form is the one that states what sticky actually promises, so it stays.

## Method

Rendered against `next start` on a production build at deviceScaleFactor 1.

The first pass drove five routes at two widths. The corrected sweep drives the
**eight reachable routes in the `(public)` group** — `/`, `/pricing`,
`/businesses`, `/service-areas`, `/how-it-works`, `/estimate`, `/sign-in`,
`/sign-up` — at **six widths** (320/390/768/1024/1280/1440), 48 combinations,
asserting per combination: the bar's absence, the topbar at viewport top 0, the
topbar still `position: sticky` and pinned at its own `top` offset and on screen
after a 1200px scroll, no horizontal overflow, no page errors, a sub-400 response,
and a 200 on the stylesheet with the styles actually applied.

47 of 48 clean. The exception is `/sign-in` at all six widths, and it is
ENVIRONMENTAL, not this change: it throws `@supabase/ssr: Your project's URL and
API key are required to create a Supabase client!` because this container has no
`.env.local` — the clean-container condition CLAUDE.md documents. Its chrome,
sticky behaviour, overflow and response status are all correct, and this diff
touches no Supabase code. The three token-gated routes (`help/[token]`,
`pay/[token]`, `track/[token]`) are not driven: they need a live token, and they
share the same layout that no longer passes a notice.
