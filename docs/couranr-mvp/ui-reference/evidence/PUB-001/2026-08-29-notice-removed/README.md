# 2026-08-29 — the service-area notice bar is removed

The owner removed the full-bleed bar above the public header, on mobile and
desktop. It is a route-group element, so it came off all five public pages, not
just the homepage.

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

## Checked, not assumed: MKT-001's sentence is not orphaned

This is the part worth a command rather than a claim. Removing `hero-small-label`
DID orphan MKT-002's consumer descriptor, and the ledger records that as a
consequence to surface. This removal does not, because the sentence has two other
homes that predate it:

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

`e2e/shellChrome.mjs` keeps its generic sticky assertion — pinned at the CSS
`top` offset and still on screen — rather than reverting to the older
`after === before`. The notice bar is *why* that equality was wrong; the generic
form is the one that states what sticky actually promises, so it stays.

## Method

Rendered against `next start` on a production build at deviceScaleFactor 1. All
five public routes were driven at 390 and 1440 — ten combinations — asserting the
bar's absence, the topbar at viewport top 0, no horizontal overflow, no console
errors, and a 200 on the stylesheet with the styles actually applied.
