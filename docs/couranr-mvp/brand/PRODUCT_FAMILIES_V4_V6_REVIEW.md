# V4–V6 — the product surface families

Merchant · Operations · Driver · Customer-token

| | |
|---|---|
| Authority | §6 surface families · §13 typography budgets · §20 product composition grammar |
| Golden screens | `MER-001`, `OPS-002` (with `OPS-003` secondary), `DRV-001`, `PUB-006`/`CUS-006` |
| Mocks | all four golden screens HAVE canonical mocks — unlike the PUB family |
| Mechanism | `data-couranr-surface` on each shell; §12 role rules extended per §13 |
| Gates | see "What is verified, and what is not" |

---

## What V4–V6 turned out to be, and what they did not

The execution sequence reads "MER-001 golden pass; propagate to canonical
Merchant screens". Read cold that sounds like rebuilding the merchant
dashboard the way PUB-001 was rebuilt. It is not, and the reason is worth
writing down because it changes the shape of the work.

**MER-001 is already built, honest and data-backed.** 571 lines composing
endpoints that already exist, and it deliberately refuses most of what its own
canonical mock shows. The mock renders "Revenue This Week $2,345.60", "Avg.
Delivery Time 38 min", "On-time Performance 98.2%", "You saved $134.30 this
week" and a seven-day chart. `UI_SCREEN_REGISTRY.md:274` bans exactly that —
*"No fabricated revenue, customer, or on-time metrics. Use real posted data
only"* — and TRM-001 forbids an on-time claim outright. The implementation
renders none of them and says so in its own header comment. **That was already
right and it stays.** The mock does not win here; §3's precedence gives written
specification control over content, and a metric is content.

So V4–V6 is a **typography and grammar pass**, not a content rebuild. Which is
also what the measurement said: `cr-type-*` had **zero** consumers outside
`app/(couranr)/(public)`. Every one of the 55 product screens was still on the
pre-v2.2 `.cr-heading--N` sizes. §11's scale and §12's roles existed and the
product surfaces did not use them.

---

## The mechanism, and why it is not 55 edits

Each shell now declares its family:

```tsx
<div className="cr-shell cr-shell--sidebar" data-couranr-surface="merchant">
```

and §12's role rules gain those surfaces in their **existing** selector lists —
one declaration block, several selectors, no second copy of any value to drift.
Every product screen inherits its family's governed typography without being
touched, which is what §29 means by "a golden screen constrains family
grammar": the grammar enforces it rather than everyone remembering.

It also materializes §6's five families in the DOM, which nothing did before.

**§13 is not uniform, and the split below is exactly its list** — this is four
rules rather than one blanket `.cr-heading--1 { Martian }`:

| Surface | Martian | Everything else |
|---|---|---|
| Merchant | page title, section title, entity title | Inter |
| **Operations** | **page title and real counters ONLY** | Inter — queues, filters, tables, actions, audit |
| Driver | page/state title | Inter |
| Customer | important state/title only | Inter |

Operations is the one that would have been got wrong by a blanket rule, and
§6.3 says why: *"avoid decorative cards that separate data which should scan as
one operational surface"*, and §6.2's companion warning against display type
inside dense workflow screens. A test asserts the absence — that no
`[data-couranr-surface="operations"] .cr-heading--[234]` selector exists — because
an absence is what rots silently.

Identifiers move to Martian Mono on product surfaces only. `.cr-text--numeric`
was setting tabular figures in the *body* face, so §9's mono token was declared
and then not used by the thing it was declared for. A price on a marketing page
stays editorial and is deliberately excluded.

---

## What is verified, and what is not

**Verified, in a browser, against a production build:**

- all five shells stamp their surface family — measured at `/`, `/business`,
  `/operations`, `/driver`;
- the three governed faces load, are renderable, and the width axis is live,
  with a positive control that pins the axis and proves the assertion can go
  red;
- shell chrome holds at every width (41 assertions);
- the whole public family still passes Gates B and C.

**NOT verified, and this is a real gap rather than a formality:** the computed
font on a product **page title**. Every product route is behind an access gate;
with no session the shells render chrome only. That was measured, not assumed —
the DOM at `/business`, `/operations` and `/driver` contains `.cr-sidebar*`
classes and no `.cr-heading` or `.cr-text` node at all.

The harness that would close it exists. `e2e/disposable/merchantDashboard.mjs`
brings up a disposable Postgres, applies 50 migrations and signs a real merchant
in. It gets through the migrations and then aborts: its PostgREST binary is not
present in this container. That is an environment gap, and nothing was injected
or stubbed to paper over it — `npm run test:fonts` prints an explicit
`UNVERIFIED` line per surface on every run, with the reason, and repeats them in
its summary.

**How to close it:** make PostgREST available and add the three font assertions
to the authenticated harness, where a real session renders a real page header.

**Also not done, and deliberately:** Gate A region reviews for `MER-001`,
`OPS-002`, `DRV-001` and the customer pair. Their mocks exist, so unlike the
PUB family these are genuinely runnable — but a region review compares an
implementation a person can see, and the implementations are behind the same
gate. Running Gate A on a "Checking your access" skeleton would produce a
document that says nothing. It is the same blocker, and it closes the same way.

---

## Verdict

**The propagation is landed and asserted.** §13's budgets are bound at the
shell, the split is per-family and tested in both directions, and the identifier
face is finally the one §9 declared.

**Three gates remain open on the product families** — the page-title font
measurement, and Gate A for the four golden screens — all blocked on the same
missing PostgREST binary, all recorded here and in the harness output rather
than quietly counted as passing.
