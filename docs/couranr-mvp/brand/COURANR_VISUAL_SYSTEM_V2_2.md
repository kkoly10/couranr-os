# Couranr Visual System v2.2

**Status:** Owner-approved design direction; **implementation authority becomes active only after §2 Authority Materialization is committed in the same implementation branch**  
**Product:** Couranr — local delivery infrastructure for independent local businesses  
**Target repository:** `kkoly10/couranr-os`  
**Baseline audited:** merged `main` at `05b29fb`  
**Primary proving surface:** `PUB-001`  
**Primary implementation files:** `UI_SCREEN_REGISTRY.md`, root `02_DECISION_REGISTRY.json`, `app/(couranr)/couranr.css`, optional `app/(couranr)/couranr.tokens.css`, canonical brand assets, mock/source registries, visual QA evidence

---

## v2.2 audit closure

v2.2 closes the four implementation defects found in the v2.1 external tree audit:

1. the display/body/mono font tokens are now explicitly declared and the legacy `--couranr-font-sans` alias is defined;
2. the visual-authority example no longer contains a guessed PUB-001 dimension and instead requires generated, measured integers for every source asset;
3. the Operations golden screen is `OPS-002` (which has canonical mock coverage), with `OPS-003` as the secondary detail validator;
4. public composition metadata is mandatory on PUB-001 and other public pages governed by the composition contract, so the strongest anti-template gates cannot silently opt out.

It also resolves the minor card-title hierarchy inconsistency and adds a deliberately bounded **Fast Visible Path** so the homepage can become visibly better before the full 66-screen visual registry and family propagation are complete.

---

## In-repo revision log

This file is the in-repo copy of the owner-supplied v2.2 document. It landed
byte-identical (`sha256 4029cbaa…`) and is amended here as implementation
proceeds. Every amendment is recorded below with what changed and why, so the
supplied document and the repository copy never diverge silently.

### r1 — section-id contract and version hygiene

Two defects found auditing v2.2 against the tree at `05b29fb`.

1. **The twelve governed section ids were never enumerated.**
   `data-couranr-section` appeared twice in the whole document: once as an
   example, once as a description. §32.3's mandatory test — *"exactly the
   approved twelve governed sections are present in the approved order"* — had
   no list to check against, so an implementer would invent the ids and then
   assert against their own invention. §25 compounded it by using a second
   vocabulary for the same sections (`category-breadth` in
   `composition_regions`, `delivery-beyond-restaurants` in the §32.3 example).
   **Fix:** §27.0 is now the single normative table — twelve ids, their §27
   section, their required composition, and the heading each carried at the
   audited baseline. §25 and §32.3 both defer to it, and §32.3 now fails on an
   unknown id rather than accepting it as a new section.

2. **Five normative references still pointed at v2.1.** The worst was the
   decision object in §2.1, which §2 instructs the executor to commit to the
   root `02_DECISION_REGISTRY.json` — it would have written
   `"Couranr Visual System v2.1 uses Martian Grotesk…"` permanently into
   production authority. Also §3's precedence table, §31 step 4, and §35's
   executor directive (*"use the v2.1 composition vocabulary"*), which is the
   contract the implementer actually follows.
   **Fix:** those five now read v2.2. The two remaining v2.1 mentions (§ audit
   closure, §25's retired-dimension note) are historical statements about what
   the v2.1 draft said and are left alone deliberately — rewriting them would
   erase the audit trail.

### r2 — the composition vocabulary was not closed

Writing r1's table surfaced a third defect, larger than either of the two it
was written to fix.

§19 defines a **closed** vocabulary of composition types and §32.3 requires
every `data-composition` value to be one of them. But §27 describes each
homepage section in prose, and **eight of its twelve sections name a
composition that is not an approved §19 type** — "channel flow / structured
strip", "selective category grid or image-based category system", "map / route
visual", "restrained utility", "full-bleed brand moment", and three more that
differ only by an adjective ("connected workflow rail", "product proof +
supporting narrative", "structured high-contrast information block").

An implementer would have had to invent the bridge, and every invention
produces a different set of `data-composition` values — which is the same
tautology r1 removed, one level down.

**Fix, three parts:**

1. §19.8 adds `image-integrated hero` as an approved type. §27 Section 1
   already mandated it by name, so it was mandatory and unapproved at the same
   time. It is genuinely not §19.2 image narrative — photography is full-bleed
   behind the copy rather than beside it.
2. §27.0's table gains a **§27 wording** column and a `data-composition`
   column, so every mapping from prose to vocabulary is recorded and auditable
   rather than re-derived per implementer.
3. The three DOM flags (`image-led`, `grid-dominant`, `product-proof`) are
   fixed per section, each traced to the §27 sentence that decides it.

The vocabulary was deliberately **not** grown to twelve types. One type per
section would satisfy "no two adjacent share a composition" trivially and make
§19's central anti-template rule vacuous.

Resolving the mapping forced one judgment call, recorded in §27.0 and flagged
for the owner: sections 8 and 9 cannot both be `structured-information-block`
without breaking §19's adjacency rule, so section 9 maps to
`full-bleed-interruption`. The alternative — moving section 8 to its
image-based option — is written out there too.

Verified after: no adjacent duplicates; grid-dominant 1 (cap 2); image-led 3
(floor 2); product-proof 1 (floor 1); exactly one workflow rail; all twelve
`data-composition` values members of §19; §25's thirteen regions reconcile to
twelve sections plus `navigation`.

### r3 — a thirteenth governed section, on the owner's decision

Not a defect in this document. §27.0's table was correct for MKT-002's twelve;
the owner changed MKT-002.

Gate A's native-mock review found four sections on the canonical artboard that
MKT-002's twelve does not carry, and resolved them as *"unrouted — adding a
section is a content decision"* (D-6). The owner then directed that the
implementation stay true to the mock, and approved building the artboard's
**"Delivery options that fit your needs"** section. That decision is recorded in
the root registry as **MKT-003**, which amends MKT-002 — §2's materialization
rule, applied to a content change rather than a typography one: this table did
not get to grow a row on its own authority.

What changed here:

- §27.0 gains row 9, `delivery-options`, between `categories` and `pricing` —
  where the artboard puts it. Rows 9–12 renumber to 10–13.
- Its `data-composition` is `split-story`, **not** the artboard's four-across
  card row. The artboard stacks a card row (categories) directly on top of
  another card row (options); §19's adjacent-duplicate rule is a hard rule, and
  §0's whole complaint is about sections that read as one undifferentiated
  slab. Gate A row 9 had already recorded the same judgment against the mock's
  other card-heavy sections. The four options keep their icons, titles, bodies
  and descriptor tags — what they lose is the fifth grid.
- The §25 example array, the §32.3 attribute list and the `navigation`-is-a-
  region note all move from twelve/thirteen to thirteen/fourteen.

The other three artboard sections (Smart Intake, the support demonstration,
"Why businesses choose Couranr") remain unbuilt and D-6 still covers them.
`delivery-options` was separable because every value in it is already governed —
SUR-001's service levels and weight bands, SUR-002's Route Saver, MIL-002's
mileage tiers and manual-quote threshold, OVN-001's overnight window and
surcharge — so it required no new product decision, only the content decision
the owner made.

Verified after: no adjacent duplicates; grid-dominant 1 (cap 2); image-led 3
(floor 2); product-proof 1 (floor 1); exactly one workflow rail; all thirteen
`data-composition` values members of §19; §25's fourteen regions reconcile to
thirteen sections plus `navigation`. Re-derived by
`npm run check:visual-system`, not by reading.

---

# 0. Why this document exists

Couranr already had correct colors, routes, product constraints, and many correct sections. It still produced a homepage that looked like a generic SaaS template.

The failure was not mainly a missing color token. It was a missing **visual grammar**.

The implementation repeatedly used the same pattern:

```text
small decorative label / eyebrow
heading
supporting paragraph
rounded white cards
```

That pattern was mechanically coherent and commercially weak.

This document establishes a different system:

> **Human local commerce + serious delivery infrastructure.**

The public brand must feel editorial, photographic, physical, intentional, and commercially clear.

The authenticated product must feel precise, calm, operational, trustworthy, and fast to scan.

The system is intentionally designed to make the following failure modes hard:

- 3,000 decorative eyebrows;
- flat typography;
- every idea inside the same white rounded card;
- repeated three-card SaaS sections;
- generic icon grids used as visual filler;
- colors being treated as the entire brand;
- dashboard grammar copied into marketing;
- marketing grammar copied into Operations;
- screenshots called “visual fidelity” without comparing to the actual mock;
- a new token namespace that duplicates the existing `--couranr-*` system;
- accessibility being lost during a visual redesign.

---

# 1. Success definition

Couranr Visual System v2.2 succeeds only when all of these are true:

1. The authority chain contains no contradictory typography or visual-system instruction.
2. The canonical logo and locked Couranr colors remain unchanged.
3. Martian Grotesk Variable is the governed display family.
4. Inter Variable is the governed body/interface family.
5. Martian Mono is restricted to operational identifiers/data where monospace is useful.
6. The fonts actually load in production; system fallback is not the intended result.
7. The existing `--couranr-*` namespace is preserved.
8. The existing accessibility foundation is preserved and strengthened.
9. Public marketing, Merchant, Operations, Driver, and Customer surfaces have related but distinct composition grammars.
10. `PUB-001` is rebuilt as the proving surface before the system is propagated broadly.
11. The homepage uses at most two dominant card-grid sections.
12. The homepage has at least two image-led sections.
13. The four-step workflow is spatially connected rather than four isolated identical cards.
14. The homepage includes at least one real product-proof composition.
15. Decorative eyebrow repetition is removed.
16. `DELIVERY MADE SIMPLE` remains protected as approved brand/tagline content and is not misclassified as prohibited copy.
17. Visual QA compares design artboards honestly instead of pretending they are browser screenshots.
18. Responsive QA is performed at real browser widths independently of native mock dimensions.
19. Accessibility QA is a separate mandatory gate.
20. A visually generic result is considered a failure even when functional tests pass.

This document does **not** define success as “the CSS file contains the new variables.”

---

# 2. Authority Materialization — mandatory before visual implementation

The previous v2 draft was unsafe because it ranked itself below `UI_SCREEN_REGISTRY.md` while also trying to replace that file's typography decision.

v2.2 does not do that.

Before changing production typography or propagating v2.2 styling, the executor must materialize the owner-approved design decision into the existing higher authorities.

## 2.1 Root decision registry

Add one new `decided` entry to the **root** `02_DECISION_REGISTRY.json`.

Do not modify the provenance copy under `couranr_claude_code_package/`.

Use the next available design/visual decision id after checking the registry for collisions. `VIS-001` is the preferred id **only if it is free at implementation time**.

The decision must record, at minimum:

```json
{
  "category": "brand visual system and typography",
  "decision": "Couranr Visual System v2.2 uses Martian Grotesk Variable for display and significant headings, Inter Variable for body/interface text, and Martian Mono only for operational identifiers where monospace improves scanning. The existing Couranr logo and locked brand colors are unchanged. Public and product surfaces share brand primitives but use surface-specific composition grammars.",
  "value": {
    "display_font": "Martian Grotesk Variable",
    "body_font": "Inter Variable",
    "mono_font": "Martian Mono",
    "tagline": "Delivery made simple",
    "tagline_logo_lockup_rendering": "Use the canonical supplied lockup; do not recreate with typed text.",
    "consumer_descriptor": "Local delivery for independent businesses.",
    "formal_positioning": "Local delivery infrastructure for independent local businesses.",
    "hero_promise": "Your customers want delivery. Now you can say yes.",
    "differentiation_statement": "Local delivery, built for more than restaurants.",
    "composition_model": "one brand system with surface-specific visual grammars",
    "token_namespace": "--couranr-*",
    "accessibility_floor": "WCAG 2.2 AA and no regression from the existing Couranr accessibility layer"
  },
  "status": "decided"
}
```

The executor must fit this into the repository's existing decision schema rather than replacing the schema with this abbreviated example.

The entry must list affected public, merchant, driver, customer, auth, and Operations screen families and the relevant design-system/code paths.

## 2.2 `UI_SCREEN_REGISTRY.md`

Replace the old broad typography line:

```text
Typography: Geist Sans or Inter.
```

with the owner-approved governed direction:

```text
Typography: Martian Grotesk Variable is the Couranr display and significant-heading family. Inter Variable is the body/interface family. Martian Mono is restricted to operational identifiers/data where monospace improves scanning. Use sentence case, readable line height, and the role/budget rules in COURANR_VISUAL_SYSTEM_V2_2.md. The canonical logo remains the supplied outlined logo asset and is not recreated from these fonts.
```

Add a visual-system cross-reference that makes the domains explicit:

```text
COURANR_VISUAL_SYSTEM_V2_2.md controls reusable visual primitives, typography roles, composition grammars, photography, responsive visual behavior and visual QA. Canonical images remain the authority for screen-specific composition, hierarchy, density and responsive intent. Written product authorities continue to control behavior, copy correctness, permissions, pricing, safety and claims.
```

## 2.3 Marketing authority

Keep the currently approved MKT-002 hero copy exactly unless the owner separately changes it.

Add the newly approved differentiation statement as approved marketing language:

> **Local delivery, built for more than restaurants.**

Do not delete the existing conceptual framing:

> Local delivery should not stop at restaurant orders.

The first is the concise commercial statement. The second remains valid positioning context.

## 2.4 Brand guide

The current canonical brand guide already protects the optional tagline lockup `DELIVERY MADE SIMPLE` and says not to use it in small headers.

Do **not** remove or rewrite that rule.

v2.2 adds only this usage clarification:

> The semantic tagline is “Delivery made simple.” The logo-lockup rendition remains the supplied canonical asset. The tagline may appear in approved brand/signature contexts, but it is not a general-purpose section eyebrow and must not be repeated to manufacture hierarchy.

## 2.5 Materialization gate

The visual implementation must not claim that Martian is authoritative until §2.1 and §2.2 have landed.

The authority updates and the v2.2 file should land in the same coherent branch/PR before broad UI propagation.

---

# 3. Authority by question — no single ambiguous rank list

v2.2 uses **domain precedence**, not one flat ranking that makes unrelated documents fight each other.

| Question | Authority |
|---|---|
| What does the feature do? | Root decision registry + applicable product/workflow specs |
| What pricing, payment, permission, state, safety or claim is correct? | Root decision registry + applicable written product authority |
| What screens/routes/states are canonical? | `UI_SCREEN_REGISTRY.md` |
| Which visual reference belongs to a screen? | `UI_SCREEN_REGISTRY.md` + current empirical mock/source map |
| What should this specific screen look and feel like? | Its canonical mock/artboard |
| What reusable typography, colors, spacing, component treatments and visual grammar may be used? | This v2.2 system after §2 materialization |
| What happens responsively where the mock is silent? | Screen viewport intent + v2.2 surface-family rules + closest canonical same-family references |
| What accessibility floor applies? | v2.2 + existing Couranr accessibility behavior; stricter product authority wins where present |
| What does current code prove? | Shipped-state evidence only |

### Required conflict rule

> **Written specifications control behavior, claims, copy correctness, pricing, permissions, state, safety and data. Canonical mocks control screen-specific visual composition, hierarchy, density, visual rhythm and responsive intent. v2.2 controls the reusable visual language used to reproduce those mocks coherently.**

A token does not override a mock's composition.

A mock does not override product behavior.

Current code does not become authority by existing first.

---

# 4. Commercial brand hierarchy

The brand needs more than one sentence because the logo tagline, category descriptor, hero promise, and differentiation statement do different jobs.

## 4.1 Brand tagline

**Delivery made simple.**

Purpose:
- memory;
- logo lockup;
- brand signature;
- selected closing/campaign moments.

It is **not** the primary sales argument.

It is **not** a universal section label.

The supplied logo lockup remains canonical; do not recreate the logo or tagline lockup with live text.

## 4.2 Consumer category descriptor

**Local delivery for independent businesses.**

Use where a short category explanation is useful.

The currently approved hero eyebrow uses this wording and remains valid.

## 4.3 Formal positioning

**Local delivery infrastructure for independent local businesses.**

Use in internal/product/technical descriptions where infrastructure is the right level of specificity.

## 4.4 Primary commercial promise

**Your customers want delivery. Now you can say yes.**

This remains the approved homepage hero promise.

It should carry the hero visually. It does not need multiple badges or decorative labels to explain its importance.

## 4.5 Differentiation statement

**Local delivery, built for more than restaurants.**

Use as a major editorial statement where the page explains category breadth.

Do not turn it into a tiny eyebrow.

## 4.6 Operational promise

Keep the approved idea:

**Receive the order however you already receive it. Couranr handles what happens after the order is ready.**

## 4.7 Commercial territory

Couranr's commercial territory is not “Uber literally cannot move these items.”

The stronger and safer framing is:

> Independent businesses should be able to offer local delivery even when their operation does not fit the restaurant-marketplace model.

Examples include merchant-controlled orders from:

- website;
- phone;
- text;
- social media;
- POS;
- storefront/in person;
- other merchant-controlled channels.

## 4.8 Competitor rule

Do not build the brand around attacking a named competitor.

Do not claim a competitor categorically rejects every non-restaurant business.

Differentiate through Couranr's target customer, workflow, merchant-controlled order channels, managed operations, proof, flexibility and local-business orientation.

---

# 5. Design thesis

Couranr should communicate four traits simultaneously.

## 5.1 Human local commerce

Show physical commerce and physical work:

- merchants;
- packages;
- counters;
- storefronts;
- garments;
- flowers;
- local retail;
- auto/specialty goods;
- loading;
- handoff;
- delivery proof;
- recipients.

## 5.2 Serious delivery infrastructure

Couranr is operational software and a delivery service, not a lifestyle brand.

The product must communicate:

- state;
- readiness;
- payment status;
- dispatch;
- assignment;
- proof;
- exceptions;
- returns;
- support;
- auditability.

## 5.3 Confident restraint

Prefer one strong statement over:

- three badges;
- four pills;
- six icon tiles;
- repeated decorative eyebrows;
- background blobs;
- unnecessary gradients.

## 5.4 Surface-specific coherence

The uploaded Couranr Market package provides a useful governance lesson: one visual identity can support very different product surfaces.

Couranr OS therefore uses one brand system with distinct surface families.

---

# 6. Surface families

## 6.1 Public Marketing — **Editorial Commerce**

Goal: make a local business owner understand the commercial problem and want to act.

Visual character:
- strongest Martian usage;
- photography-forward;
- asymmetric compositions;
- large editorial statements;
- generous spacing;
- real product proof;
- limited card grids;
- deliberate dark/full-bleed interruptions.

Avoid dashboard density.

## 6.2 Merchant — **Calm Operations**

Goal: help a business create, monitor and manage delivery work without intimidation.

Visual character:
- Martian for page/section/entity headings;
- Inter for most operational text;
- white/canvas surfaces;
- restrained cards;
- clear workflow and state grouping;
- beginner-friendly action hierarchy;
- desktop primary, tablet usable, selected mobile-critical flows responsive.

Avoid marketing-size display type inside dense workflow screens.

## 6.3 Operations — **Command Center**

Goal: maximize trustworthy scanning and safe action under operational pressure.

Visual character:
- highest information density;
- stronger navy presence where consistent with mocks;
- clear queue/action hierarchy;
- Inter-dominant tables, filters and detail;
- Martian only for page titles and significant real counters;
- minimal decorative imagery;
- strong conflict/error/audit treatments.

Avoid decorative cards that separate data which should scan as one operational surface.

## 6.4 Driver — **Action First**

Goal: make the next safe action obvious on a phone.

Visual character:
- mobile-primary;
- one clear primary action per state;
- 48–56px action controls where practical;
- current delivery information first;
- strong state title;
- minimum distraction;
- offline/retry/conflict states explicit;
- no dense desktop grammar shrunk onto a phone.

## 6.5 Customer / secure token surfaces — **Reassuring Utility**

Goal: explain status, payment, tracking, help and proof simply to a person who may never create an account.

Visual character:
- mobile-first;
- clear status title;
- simple timeline/proof;
- concise supporting copy;
- restrained branding;
- almost no decorative UI;
- strong privacy and refusal behavior.

## 6.6 Auth / activation entry — **Clear Entry**

Auth inherits Couranr brand primitives but remains visually quiet.

Use:
- clear logo;
- strong page title;
- short helper copy;
- accessible form controls;
- minimal visual distraction.

Do not turn sign-in/signup into another marketing microsite.

---

# 7. Locked brand primitives

These existing values remain unchanged.

```css
.cr-root {
  --couranr-navy: #0D1525;
  --couranr-gold: #F4B740;
  --couranr-route-blue: #2563EB;

  --couranr-canvas: #F7F8F5;
  --couranr-surface: #FFFFFF;
  --couranr-border: #E3E7ED;
  --couranr-text-muted: #667085;
  --couranr-success: #15803D;
}
```

The canonical logo package remains unchanged.

Route Blue remains product/UI color, not logo color.

Do not add a new primary brand color.

---

# 8. Token architecture — preserve `--couranr-*`

The repository already has a namespaced Couranr token system with hundreds of consumers.

v2.2 **does not introduce `--cr-*` custom properties**.

The existing `cr-` class prefix may remain. The custom-property namespace remains:

```text
--couranr-*
```

## 8.1 Migration principle

Do not perform a mass rename merely to make v2.2 look new.

Use:

```text
existing primitive
→ semantic alias where useful
→ component / role consumer
```

Example:

```css
.cr-root {
  --couranr-bg-page: var(--couranr-canvas);
  --couranr-bg-surface: var(--couranr-surface);
  --couranr-bg-inverse: var(--couranr-navy);

  --couranr-text-primary: var(--couranr-text);
  --couranr-text-secondary: #344054;
  --couranr-text-subtle: #98A2B3;

  --couranr-action-primary-bg: var(--couranr-gold);
  --couranr-action-primary-fg: var(--couranr-navy);
  --couranr-action-link: var(--couranr-route-blue);
}
```

New supporting neutrals are not new brand colors. They must be:
- justified by an actual component or mock;
- contrast-tested;
- classified as semantic/supporting tokens;
- not introduced merely for decorative variety.

## 8.2 Existing tokens that survive

The current design foundation already includes useful concepts that remain valid:

- focus ring;
- status surfaces;
- spacing scale;
- radius scale;
- shadow scale;
- control heights;
- 44px touch minimum;
- duration tokens;
- drawer/dialog/menu z-index tokens;
- reduced-motion rules;
- skip link;
- visually-hidden utility.

Do not delete them because v2.2 reorganizes typography and composition.

## 8.3 Optional `couranr.tokens.css`

Extraction into:

```text
app/(couranr)/couranr.tokens.css
```

is allowed if it improves maintainability.

If extracted:
- preserve existing token names;
- import it before `couranr.css`;
- keep accessibility behavior in a guaranteed loaded stylesheet;
- do not create two competing token definitions;
- do not change computed values accidentally during extraction.

---

# 9. Typography authority

## 9.0 Required font tokens and compatibility aliases

These tokens are mandatory. Typography role classes in §12 may not reference an undeclared variable.

```css
.cr-root {
  --couranr-font-display: "Martian Grotesk Variable", "Martian Grotesk", sans-serif;
  --couranr-font-body: "Inter Variable", "Inter", ui-sans-serif, system-ui,
    -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --couranr-font-mono: "Martian Mono", ui-monospace, SFMono-Regular,
    "SF Mono", Menlo, Consolas, monospace;

  /* Backward-compatible alias while existing consumers migrate. */
  --couranr-font-sans: var(--couranr-font-body);
}
```

Rules:
- `--couranr-font-display`, `--couranr-font-body`, and `--couranr-font-mono` must be declared before any role uses them;
- existing `var(--couranr-font-sans)` consumers continue to resolve to Inter during migration;
- do not create a second active `--couranr-font-mono` definition with a different value; replace/reconcile the existing definition as one atomic foundation change;
- deterministic `@font-face`/loader configuration remains mandatory under §10; the token declaration alone does not prove the font loaded.

## 9.1 Display family — Martian Grotesk Variable

Use for:
- public hero;
- major editorial statements;
- public section headings;
- authenticated page titles;
- authenticated section headings;
- selected entity/card headings;
- selected real metrics.

Martian is the **voice**, not the body-copy workhorse.

## 9.2 Body/interface family — Inter Variable

Use for:
- body copy;
- supporting marketing copy;
- forms;
- labels;
- buttons;
- tables;
- filters;
- timelines;
- dense lists;
- help text;
- navigation;
- most operational content.

## 9.3 Operational mono — Martian Mono

Use only when monospace improves operational scanning:
- order/reference ids;
- audit ids;
- provider ids in privileged technical views;
- code-like configuration values;
- selected timestamps.

Do not use mono for normal customer-facing copy.

## 9.4 Logo exception

The canonical wordmark remains an outlined asset based on its approved logo construction.

Do not type `couranr` in Martian or Inter as a logo substitute.

---

# 10. Deterministic font loading and width-axis contract

The browser must actually render the governed fonts.

A CSS stack that silently falls through to `system-ui` is a failure.

## 10.1 Required verification

At runtime verify:
- hero computed family resolves to Martian Grotesk;
- body/interface computed family resolves to Inter;
- mono usage resolves to Martian Mono where used;
- font files load without 404/CORS errors;
- layout is stable after font load;
- the Martian width treatment is actually applied.

## 10.2 Martian width axis

Martian's width axis is a deliberate hierarchy tool.

Do not write `font-stretch: 112.5%` and assume it worked.

The production font-face configuration must expose the intended width range to the browser.

Preferred semantic treatment:

```css
font-stretch: 112.5%;
```

If the loader does not expose the width axis correctly, use an explicit variable-font implementation that does, then verify the computed/rendered result.

A browser test must compare a width-varied display specimen against the default width and fail if there is no measurable difference.

Do not set `font-variation-settings` casually in a way that disables other useful automatic axes.

---

# 11. Typography scale

The purpose of the scale is **contrast**, not merely larger numbers.

## 11.1 Tokens

```css
.cr-root {
  --couranr-type-hero-min: 3rem;          /* 48 */
  --couranr-type-hero-max: 6rem;          /* 96 */

  --couranr-type-statement-min: 2.5rem;   /* 40 */
  --couranr-type-statement-max: 4.5rem;   /* 72 */

  --couranr-type-marketing-section-min: 2rem;     /* 32 */
  --couranr-type-marketing-section-max: 3.25rem;  /* 52 */

  --couranr-type-page-title-min: 1.875rem; /* 30 */
  --couranr-type-page-title-max: 2.375rem; /* 38 */

  --couranr-type-section-min: 1.4375rem;  /* 23 */
  --couranr-type-section-max: 1.75rem;    /* 28 */

  --couranr-type-card-title: 1.125rem;    /* 18 */
  --couranr-type-card-title-lg: 1.25rem;  /* 20 */

  --couranr-type-lead-min: 1.125rem;      /* 18 */
  --couranr-type-lead-max: 1.375rem;      /* 22 */

  --couranr-type-body: 1rem;              /* 16 */
  --couranr-type-small: 0.875rem;         /* 14 */
  --couranr-type-label: 0.8125rem;        /* 13 */

  --couranr-type-metric-min: 2rem;        /* 32 */
  --couranr-type-metric-max: 3rem;        /* 48 */
}
```

The intended hierarchy is roughly:

```text
96 → 72 → 52 → 38 → 28 → 20/18 → 16 → 14/13
```

not the previous flat pattern where 36px effectively served as the top of the universal hierarchy.

---

# 12. Typography roles

## 12.1 Hero

```css
.cr-type-hero {
  font-family: var(--couranr-font-display);
  font-size: clamp(3rem, 7vw, 6rem);
  font-weight: 700;
  font-stretch: 112.5%;
  line-height: 0.96;
  letter-spacing: -0.04em;
  text-wrap: balance;
}
```

Budget:
- one per marketing page;
- usually 2–3 intentional lines;
- target measure approximately 10–14ch;
- do not default to centered alignment.

## 12.2 Editorial statement

```css
.cr-type-statement {
  font-family: var(--couranr-font-display);
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  font-weight: 675;
  font-stretch: 106%;
  line-height: 0.99;
  letter-spacing: -0.035em;
  text-wrap: balance;
}
```

Budget:
- normally 1–2 per long public page.

## 12.3 Marketing section heading

```css
.cr-type-marketing-section {
  font-family: var(--couranr-font-display);
  font-size: clamp(2rem, 4vw, 3.25rem);
  font-weight: 650;
  line-height: 1.03;
  letter-spacing: -0.025em;
  text-wrap: balance;
}
```

## 12.4 Product page title

```css
.cr-type-page-title {
  font-family: var(--couranr-font-display);
  font-size: clamp(1.875rem, 3vw, 2.375rem);
  font-weight: 650;
  line-height: 1.08;
  letter-spacing: -0.02em;
}
```

## 12.5 Product section title

```css
.cr-type-section-title {
  font-family: var(--couranr-font-display);
  font-size: clamp(1.4375rem, 2vw, 1.75rem);
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.015em;
}
```

## 12.6 Entity/card title

```css
.cr-type-card-title {
  font-family: var(--couranr-font-display);
  font-size: var(--couranr-type-card-title); /* 18px default */
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.cr-type-card-title--prominent {
  font-size: var(--couranr-type-card-title-lg); /* 20px */
}
```

Use 18px for normal repeated entity/card headings and the 20px prominent variant only where one card/entity is intentionally elevated in hierarchy. Dense tables and repeated row labels remain Inter.

## 12.7 Marketing lead

```css
.cr-type-lead {
  font-family: var(--couranr-font-body);
  font-size: clamp(1.125rem, 2vw, 1.375rem);
  font-weight: 400;
  line-height: 1.5;
}
```

## 12.8 Body

```css
.cr-type-body {
  font-family: var(--couranr-font-body);
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.55;
}
```

## 12.9 UI label

```css
.cr-type-label {
  font-family: var(--couranr-font-body);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0;
}
```

Sentence case by default.

## 12.10 Metric

```css
.cr-type-metric {
  font-family: var(--couranr-font-display);
  font-size: clamp(2rem, 3vw, 3rem);
  font-weight: 650;
  font-stretch: 87.5%;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
```

Only for real data.

No fabricated marketing metrics.

---

# 13. Typography budgets by surface

## Public Marketing

Martian:
- hero;
- editorial statements;
- major section headings;
- selected real metrics.

Inter:
- nav;
- body;
- supporting copy;
- buttons;
- legal/trust copy;
- FAQ content.

## Merchant

Martian:
- page title;
- section title;
- selected entity title.

Inter:
- almost everything else.

## Operations

Martian:
- page title;
- selected real counters.

Inter:
- queues;
- filters;
- tables;
- actions;
- operational details;
- audit data.

## Driver

Martian:
- delivery state/page title where useful.

Inter:
- instructions;
- addresses;
- controls;
- contact/proof information.

## Customer/token

Martian:
- important state/title only.

Inter:
- supporting content.

This prevents Martian from becoming the next repetitive gimmick.

---

# 14. Eyebrow and small-label policy

This is a hard rule.

> **Couranr has no general-purpose marketing `SectionEyebrow` pattern.**

## 14.1 Approved hero eyebrow

The approved homepage hero eyebrow remains:

> Local delivery for independent businesses

It exists because product authority explicitly defines it.

It does not establish a universal component pattern.

## 14.2 Semantic small labels

Small labels are valid when they communicate actual metadata, for example:

- Step 2;
- Pickup;
- In transit;
- Fredericksburg;
- Customer-paid;
- Operations review;
- Today;
- 2 packages.

## 14.3 Decorative labels

Do not invent small labels merely because a section feels visually empty.

Avoid generic patterns such as:

- WHY COURANR;
- OUR DIFFERENCE;
- BUILT FOR BUSINESS;
- MADE FOR LOCAL;
- THE COURANR WAY;
- SMART DELIVERY;
- GROW YOUR BUSINESS.

## 14.4 Tagline exception

`DELIVERY MADE SIMPLE` is **not prohibited content**.

It is the approved optional brand tagline lockup.

Rules:
- use the supplied lockup asset in logo contexts;
- do not recreate the lockup as live text;
- do not use it in small headers;
- do not repeat it as section boilerplate;
- it may appear as semantic prose only in a deliberate brand/signature context.

## 14.5 Budget

A long public page should normally contain no more than 2–3 eyebrow-style small labels total, and most should carry real information.

Hierarchy must come primarily from typography, composition, imagery, spacing and contrast.

---

# 15. Layout and spacing

Preserve the existing 4px product spacing scale for component internals.

Add semantic layout roles rather than replacing every spacing token.

```css
.cr-root {
  --couranr-content-app: 1200px;
  --couranr-content-marketing: 1320px;
  --couranr-content-reading: 680px;
  --couranr-content-narrow: 560px;

  --couranr-page-gutter-mobile: 20px;
  --couranr-page-gutter-tablet: 32px;
  --couranr-page-gutter-desktop: 48px;

  --couranr-section-space-sm: 72px;
  --couranr-section-space-md: 104px;
  --couranr-section-space-lg: 144px;
  --couranr-section-space-xl: 176px;
}
```

## Marketing rhythm

Desktop:
- normal section separation: 104–144px;
- hero breathing room: 120–176px;
- compact transitions: ~72px.

Mobile:
- normal: 64–88px;
- hero: 80–112px.

## Product rhythm

Authenticated product remains denser:
- page top: 32–48px;
- section separation: 24–40px;
- card/panel internals: 20–32px.

Do not use marketing spacing inside dense Operations queues.

---

# 16. Shape system

The existing Couranr radius system remains the foundation, but one radius must not control every object.

Recommended semantic aliases:

```css
.cr-root {
  --couranr-radius-control: 10px;
  --couranr-radius-control-lg: 12px;
  --couranr-radius-card-compact: 14px;
  --couranr-radius-card: 20px;
  --couranr-radius-panel: 24px;
  --couranr-radius-media: 28px;
  --couranr-radius-pill: 999px;
}
```

Use:
- controls: 10–12px;
- dense operational cards: ~14px;
- standard product cards: ~20px;
- large media/editorial frames: 24–28px;
- pills: only true status/filter/chip use.

Do not make every button a pill.

Do not make every image a card.

---

# 17. Elevation

The existing restrained shadow strategy remains valid.

Use depth only when it communicates layering or supports a deliberate product/media frame.

Default product card:
- 1px neutral border;
- no shadow or smallest shadow.

Marketing/product-proof frame:
- moderate depth allowed when visually justified.

Avoid the “everything floats” SaaS aesthetic.

---

# 18. Controls

Preserve:

```text
small: 40px
standard: 48px
large: 52px
minimum touch target: 44px
```

Driver/mobile primary actions may prefer 48–56px when the canonical composition supports it.

Primary action:
- Couranr Gold background;
- Navy text;
- no gradient;
- no glow.

Secondary:
- surface background;
- neutral border;
- Navy text.

Destructive:
- explicit danger treatment;
- never Gold.

Links:
- Route Blue where appropriate.

---

# 19. Public marketing composition grammar

Marketing pages must not be generated from one universal section component.

Approved composition types:

## 19.1 Editorial statement

- oversized Martian statement;
- generous whitespace;
- optional short Inter support;
- no card grid required;
- no decorative icon required.

## 19.2 Image narrative

- real photography occupies roughly 40–65% of the visual composition;
- copy occupies the remainder;
- image may bleed toward the viewport edge;
- art direction controls crop and focal point.

## 19.3 Split story

- copy and visual/product evidence share an asymmetric composition;
- not automatically 50/50;
- hierarchy follows narrative importance.

## 19.4 Workflow rail

- sequential steps are visually connected;
- progression is spatially obvious;
- step markers are functional;
- avoid four detached identical cards when the content represents one process.

## 19.5 Product proof

- real Couranr UI or a faithful live product composition;
- large enough to read;
- minimal annotation;
- no fake dashboards;
- no fake metrics;
- do not use a screenshot as the product page itself.

## 19.6 Full-bleed interruption

- Navy and/or approved photography;
- strong contrast;
- large editorial statement;
- deliberate rhythm reset.

## 19.7 Structured information block

For pricing, service boundaries, FAQ or other utility-heavy marketing content.

It may use cards/panels where the content is genuinely discrete.

It must not become the default composition for narrative sections.

## 19.8 Image-integrated hero

§27 Section 1 mandates this composition by name, and §32.3 requires every
`data-composition` value to be one of the approved types — so it is approved
here rather than left as a term only §27 uses.

It is **not** §19.2 image narrative. Image narrative gives photography 40–65%
of the composition and text the remainder, side by side. An image-integrated
hero gives photography the whole band and overlays the copy column on it:

- photography is full-bleed behind the content, not beside it;
- a scrim or equivalent treatment carries text contrast, measured per §23.2
  against the painted region rather than assumed;
- the copy column is normally left-aligned within the content width;
- narrow viewports get an independently art-directed source, not a
  centre-crop of the desktop one.

One per marketing page, and only where the page has a hero.

### Hard rules

- Do not use the same composition type twice consecutively on the homepage.
- No more than two homepage sections may be dominated by card grids.
- Do not center every section.
- Do not use one content width for every section.
- Do not make every section title the same size.

---

# 20. Product composition grammar

## Merchant — Calm Operations

Prefer:
- stable shell;
- clear page header;
- workflow groupings;
- lists/tables where data is naturally tabular;
- restrained cards where boundaries are meaningful;
- action placement that remains consistent.

Do not turn every dashboard fact into a separate decorative tile.

## Operations — Command Center

Prefer:
- queue/table/detail structures;
- visible state and urgency;
- filters/search close to the data they affect;
- persistent context for money/state-changing actions;
- explicit conflict/retry/audit affordances.

Avoid marketing storytelling inside operational flows.

## Driver — Action First

Prefer:
- current state;
- destination/context;
- one dominant next action;
- secondary recovery/contact actions;
- offline/conflict state.

## Customer — Reassuring Utility

Prefer:
- status first;
- concise explanation;
- timeline/proof/help;
- minimal navigation;
- privacy-preserving detail.

---

# 21. Photography system

Photography is a governed public-brand primitive, not filler.

## 21.1 First rule: inventory before download

PR #29 established that the repository already contains many mapped design assets and a set of images classified as photography/out-of-registry material.

Before downloading stock photography:

1. inventory existing Couranr photography/assets;
2. determine which are usable for public marketing;
3. record their source/provenance where known;
4. reuse appropriate approved assets before sourcing replacements.

## 21.2 Photography registry

Create or extend a machine-readable registry with fields equivalent to:

```json
{
  "asset_id": "photo-local-florist-01",
  "local_path": "public/couranr/marketing/...",
  "source": "existing-repo | unsplash | other-approved-source",
  "source_reference": "...",
  "license_record": "...",
  "subject": "florist preparing local order",
  "allowed_surfaces": ["PUB-001", "PUB-009"],
  "desktop_focal_point": "62% 45%",
  "mobile_focal_point": "68% 42%",
  "preferred_aspect": "3:2",
  "status": "approved"
}
```

## 21.3 Style

> **Candid commercial documentary photography of local commerce and real delivery activity.**

The image should feel:
- physical;
- local;
- useful;
- human;
- authentic;
- operational.

## 21.4 Preferred subjects

- florist preparing or handing over an arrangement;
- dry-cleaning staff handling finished garments;
- boutique worker packaging an order;
- furniture/home-goods staff preparing pickup;
- auto/specialty parts business preparing an item;
- local retail staff at POS;
- package handoff at a counter;
- cargo loading;
- safe driver handoff;
- recipient receiving a local delivery;
- work surfaces and packaging with real context.

## 21.5 Avoid

- person smiling at camera while holding generic cardboard box;
- handshake stock photo;
- isolated van on white;
- fake 3D logistics art;
- neon AI network graphics;
- giant glowing map pins;
- call-center headset stock photography;
- drone-delivery cliché;
- boardroom meeting stock imagery;
- competitor-branded uniforms/vehicles;
- visible unrelated trademarks where avoidable.

## 21.6 Art direction

Prefer:
- natural light;
- mid-task moments;
- real environments;
- useful negative space;
- scene context rather than headshot crops;
- consistent restrained color temperature.

## 21.7 Ratios

Defaults:
- hero landscape: 16:10 or 3:2;
- split landscape: 4:3 or 3:2;
- portrait merchant scene: 4:5;
- editorial wide: 16:9.

Mobile crops are independently art-directed.

Do not blindly center-crop a desktop source.

## 21.8 Rights

Only use assets with commercial-use rights suitable for the intended use.

Retain internal source/license metadata even when public attribution is not required.

Avoid unnecessary model/property/trademark/artwork ambiguity.

Do not imply that a depicted business or person endorses Couranr unless that is actually true.

---

# 22. Logo and tagline system

The canonical logo package is the only logo authority.

Preserve:
- lowercase outlined Couranr wordmark;
- Gold motion accent;
- Navy/white approved variants;
- app mark;
- clear-space and size rules;
- optional tagline lockups.

Public header:
- use primary wordmark on light background;
- use reverse wordmark over approved dark/photo treatment;
- do not recreate the logo using a live font.

`DELIVERY MADE SIMPLE`:
- optional brand lockup;
- not used in small headers;
- not repeated as decorative section hierarchy.

---

# 23. Accessibility — non-regression floor

The v2 redesign must not regress the existing Couranr accessibility layer.

Existing working behavior such as focus rings, reduced motion, visually hidden content, skip navigation, minimum touch targets and non-color-only status remains in force.

## 23.1 Standard

Target **WCAG 2.2 AA** for canonical MVP surfaces.

## 23.2 Contrast

At minimum:
- normal text: 4.5:1;
- large text: 3:1;
- meaningful UI/component boundaries and non-text controls: 3:1 where WCAG requires it.

Text over photography must be measured against the actual painted region after crop/overlay.

Do not assume a Navy scrim automatically passes.

## 23.3 Focus and keyboard

- visible `:focus-visible` treatment;
- logical focus order;
- keyboard access to interactive controls;
- dialogs/drawers/menus preserve expected focus behavior;
- no keyboard trap.

## 23.4 Motion

Preserve `prefers-reduced-motion` behavior.

New decorative motion must have a reduced-motion path.

Do not add gratuitous auto-playing motion.

## 23.5 Semantics

- one primary page heading hierarchy;
- semantic landmarks;
- form labels;
- accessible names;
- error association;
- live-region usage only where appropriate;
- status never communicated by color alone.

## 23.6 Touch

Minimum 44×44 CSS px interactive target where applicable.

Driver/mobile primary controls should normally exceed the minimum.

## 23.7 Zoom / reflow

Verify key responsive screens at narrow CSS widths representing high zoom/reflow conditions.

Content must not require two-dimensional scrolling except where a true data table or specialized control legitimately needs it.

## 23.8 Text expansion resilience

The design must tolerate longer labels and translated text better than a fixed English mock.

Do not hard-code widths that only fit the current English string.

This is layout resilience, not a requirement to launch all locales now.

## 23.9 Dark mode

Dark mode is **not** required by this design-system revision unless another product authority adds it.

---

# 24. Responsive system

Canonical design images are design artboards unless explicitly documented otherwise.

Their pixel dimensions are not automatically browser viewport dimensions.

Do not rescale a lossy design export to 1440×1024 and treat the resulting pixel noise as fidelity evidence.

## 24.1 Public marketing runtime widths

Verify representative widths:
- 360;
- 390;
- 768;
- 1024;
- 1280;
- 1440.

## 24.2 Merchant

Verify:
- 390 on mobile-critical merchant flows;
- 768;
- 1024;
- 1280;
- 1440.

## 24.3 Operations

Verify:
- 768;
- 1024;
- 1280;
- 1440.

## 24.4 Driver

Verify representative mobile widths:
- 360;
- 390;
- 430.

## 24.5 Customer/token

Verify:
- 360;
- 390;
- 430;
- 768 where applicable.

## 24.6 Mobile is art-directed

Responsive behavior is not “stack every desktop column vertically.”

For marketing:
- choose image order intentionally;
- set mobile focal points;
- adjust headline measure;
- alter whitespace intentionally;
- preserve narrative priority.

For product:
- preserve action priority;
- reduce secondary information before hiding critical information;
- avoid horizontal overflow.

---

# 25. Visual authority registry

Create:

```text
docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json
```

This consolidates the empirical mock mapping established by PR #29 with the canonical screen registry.

### Critical dimension rule

The registry generator must inspect the actual image file and write numeric width/height values. **No width or height from this specification may be copied into the generated registry.**

The v2.1 example incorrectly used `1448×1086` for PUB-001. That is explicitly retired. The baseline audit found PUB-001's three UI mocks in different native portrait artboard sizes (one 1055×1491 and two 941×1672), which is exactly why dimensions must be read from each file rather than inferred from a common export size.

Use a record shape equivalent to:

```json
{
  "screen_id": "PUB-001",
  "surface_family": "public_marketing",
  "canonical_sources": [
    {
      "path": "<resolved canonical source path>",
      "role": "primary",
      "width_px": 0,
      "height_px": 0,
      "source_kind": "design_artboard"
    }
  ],
  "registry_declared_viewport_intent": "responsive",
  "visual_authority": "canonical",
  "_composition_regions_note": "Ids come from the normative table in §27.0 and nowhere else. `navigation` is an artboard region, not a governed section, so a PUB-001 record carries fourteen regions and thirteen governed sections. Do not invent a region id.",
  "composition_regions": [
    "navigation",
    "hero",
    "pickup-problem",
    "category-breadth",
    "order-channels",
    "outcomes",
    "workflow",
    "product-proof",
    "categories",
    "delivery-options",
    "pricing",
    "service-area",
    "faq",
    "closing"
  ],
  "mobile_reference": null,
  "notes": []
}
```

**The `0` values above are schema placeholders only and are invalid in a committed registry.** The generator/test must reject `width_px <= 0` or `height_px <= 0` and replace them with dimensions measured from the referenced file.

Where a screen has multiple approved mocks, preserve all approved sources and mark one primary only when the current empirical map/authority supports that choice.

Rules:
- never guess a source dimension; read it from the file;
- never copy dimensions from another screen merely because many exports share one size;
- never pretend an artboard is a browser screenshot without evidence;
- do not delete UUID-named assets merely because a friendlier mapped path exists;
- one visual-authority record per registered screen;
- multiple approved sources for one screen live inside that record;
- derived screens explicitly name the family/source they derive from.

Add a validator that checks:
- all canonical screens have a visual authority record by the time the full registry phase is complete;
- all referenced source files exist;
- every committed width/height is a positive integer and matches the actual file;
- screen ids are unique;
- no canonical asset is silently double-claimed unless intentionally recorded;
- derived screens declare their derivation.

For the Fast Visible Path in §34.1, a complete validated PUB-001 record is mandatory; the remaining screen records may be deferred until after owner visual approval of PUB-001.

---

# 26. Visual QA — three independent gates

A screen is not visually complete because it passes functional tests.

A screen is not visually complete because a screenshot exists.

A screen is not visually complete because it uses the right colors.

## Gate A — Native mock fidelity

Open the canonical mock at its **native artboard dimensions/aspect ratio**.

Compare it directly with the implementation using a named-region checklist.

Required region review:
- overall silhouette;
- major region order;
- header/navigation proportion;
- typography hierarchy;
- headline measure/line breaks;
- imagery placement and crop;
- content density;
- primary vs secondary action hierarchy;
- card/panel count;
- panel proportions;
- whitespace rhythm;
- section-to-section rhythm;
- footer/closing treatment;
- major visual anchors.

Record intentional deviations and cite the higher written authority that caused each deviation.

## Gate B — Runtime responsive verification

Independently render the implementation at the real browser widths in §24.

Verify:
- no horizontal overflow;
- no clipped actions;
- readable type;
- image focal points;
- responsive navigation;
- form/table behavior;
- sticky/fixed chrome behavior;
- touch target sizes;
- loading/empty/error/conflict/offline states as applicable.

## Gate C — Accessibility

Run:
- automated accessibility scan where practical;
- keyboard smoke test;
- focus-visible verification;
- contrast checks;
- reduced-motion check;
- heading/landmark review;
- form label/error review;
- color-independent status review.

### Pixel diff policy

Pixel diff is optional and useful **only** when reference and implementation are known to represent the same viewport/rendering contract.

Do not use an arbitrary “≤1% difference” threshold against resized design-tool exports.

A low pixel difference never waives a major semantic/compositional mismatch.

---

# 27. Homepage `PUB-001` — v2.2 proving surface

The current homepage is functionally strong but is **not visually complete under v2.2**.

The baseline audit identified:
- five dominant card-grid sections;
- one image-led section;
- four isolated workflow cards;
- no real product-proof composition.

v2.2 uses `PUB-001` to prove the new system before broad propagation.

The approved 12-section information architecture and governed copy remain intact.

## 27.0 Governed section identifiers — the normative list

§32.3 requires a test asserting that *exactly the approved governed sections
are present in the approved order*. **This table is that list.** It is
the single normative vocabulary: `data-couranr-section` in the DOM, and
`composition_regions` in §25's visual-authority registry, both use these ids and
no others.

Without this table the §32.3 gate has nothing to check against — an implementer
would invent ids and then assert against ids they invented, which tests
ordering and nothing else.

The `data-composition` column resolves §27's prose composition names onto §19's
closed vocabulary. That bridge is required and did not previously exist: eight
of §27's twelve sections name a composition in prose ("channel flow /
structured strip", "map / route visual", "restrained utility") that is not one
of §19's approved types, while §32.3 requires every `data-composition` value to
be one of them. The "§27 wording" column preserves the prose so each mapping is
auditable.

| # | `data-couranr-section` | §27 section | §27 wording | `data-composition` (§19) | image-led | grid-dominant | product-proof |
|---|---|---|---|---|---|---|---|
| 1 | `hero` | Hero | image-integrated hero | `image-integrated-hero` | true | false | false |
| 2 | `pickup-problem` | Pickup-only problem | editorial statement | `editorial-statement` | false | false | false |
| 3 | `category-breadth` | Delivery beyond restaurants | image narrative | `image-narrative` | true | false | false |
| 4 | `order-channels` | Existing order channels | channel flow / structured strip | `structured-information-block` | false | false | false |
| 5 | `outcomes` | Business outcomes | split story *or* editorial/product split | `split-story` | false | false | false |
| 6 | `workflow` | Four-step workflow | connected workflow rail | `workflow-rail` | false | false | false |
| 7 | `product-proof` | Managed delivery and proof | product proof + supporting narrative | `product-proof` | false | false | **true** |
| 8 | `categories` | Supported business categories | selective category grid *or* image-based category system | `structured-information-block` | false | **true** | false |
| 9 | `delivery-options` | *(none — MKT-003)* | artboard: "Delivery options that fit your needs", four discrete options | `split-story` | false | false | false |
| 10 | `pricing` | Pricing and pilot economics | structured high-contrast information block | `full-bleed-interruption` | false | false | false |
| 11 | `service-area` | Service areas | map / route visual | `image-narrative` | true | false | false |
| 12 | `faq` | FAQ and claim boundaries | restrained utility | `structured-information-block` | false | false | false |
| 13 | `closing` | Closing CTA | full-bleed brand moment | `full-bleed-interruption` | false | false | false |

Resulting budgets, which are what §32.3 asserts:

- adjacent duplicate compositions: **0** (§19 hard rule);
- `data-grid-dominant="true"`: **1** — section 8 (§19 cap is 2);
- `data-image-led="true"`: **3** — sections 1, 3, 11 (§27 floor is 2);
- `data-product-proof="true"`: **1** — section 7 (§27 floor is 1);
- `workflow-rail`: exactly **1** — section 6.

Where the flags come from, so they are not taste:

- §4 is `false` for grid because §27 Section 4 says *"Do not render seven
  identical cards"* — the device is a connected strip.
- §8 is the one `grid-dominant` section because §27 Section 8 says *"This may be
  one of the homepage's allowed card/grid-heavy sections."*
- §11 is `false` for grid because §27 Section 11 says *"Do not style every FAQ
  item as a floating marketing card."*

**One interpretive call, flagged for the owner.** (Section numbering below is
pre-MKT-003: what it calls section 9 is now section 10, `pricing`.) Section 9's §27 wording is
*"structured high-contrast information block"*, whose name points at §19.7. But
§27 also sanctions section 8 as a grid-heavy structured block, and §19's hard
rules forbid two adjacent sections sharing a composition — so 8 and 9 cannot
both be `structured-information-block`. Section 9 is therefore mapped to
`full-bleed-interruption` (§19.6: navy, strong contrast, large editorial
statement), which matches both the "high-contrast" wording and the pricing band
in the approved mock. If the owner prefers section 9 to stay a structured
block, section 8 must move to its *"image-based category system"* alternative
(`image-narrative`, `image-led=true`, `grid-dominant=false`) and the grid count
drops to 0.

Notes:

- **`navigation` is a region, not a governed section.** §25's
  `composition_regions` array carries fourteen entries because the artboard has
  a navigation band; the shell renders it and it carries no
  `data-couranr-section`. Thirteen governed sections, fourteen artboard
  regions — the counts are supposed to differ.
- The "Required composition" column is the composition type each section must
  resolve to, drawn from §19. Where §27 offers alternatives ("split story **or**
  editorial/product split"), this column records the one that must be asserted;
  changing it is a change to this table, not a per-implementation choice.
- The shipped-heading column is provenance for the audited baseline, not a copy
  authority. Copy comes from MKT-002 and the root decision registry. If a
  heading changes there, this column is stale and the id is not.
- Section 3 was `delivery-beyond-restaurants` in an earlier draft's example.
  That spelling is retired; `category-breadth` is the id.

Reconciling §25 and §32.3 against this table is a hard requirement of the
composition gate, and §32.3's positive control must be able to detect an id
that is not on it.

## Section 1 — Hero

Composition: **image-integrated hero**.

Required:
- approved hero eyebrow only;
- approved hero promise in Martian;
- Inter support copy;
- primary and secondary CTA hierarchy;
- trust line;
- art-directed photography;
- mobile-specific crop/focal point;
- verified contrast.

Do not add extra hero badges merely for visual interest.

## Section 2 — Pickup-only problem

Composition: **editorial statement**.

Goal:
- create a major typographic rhythm change;
- no dominant card grid;
- minimal supporting copy.

## Section 3 — Delivery beyond restaurants

Composition: **image narrative**.

Use the approved differentiation territory.

Preferred major statement:

> **Local delivery, built for more than restaurants.**

Show real independent-business categories through photography rather than a generic icon grid.

This is the second required image-led section.

## Section 4 — Existing order channels

Composition: **channel flow / structured strip**.

Show merchant-controlled channels converging into one Couranr delivery workflow.

Do not render seven identical cards unless the canonical mock genuinely requires it and the result survives the v2.2 visual review.

Possible visual devices:
- labeled channel stream;
- connected nodes;
- compact icon/text row;
- directional flow into Couranr.

The device must read as one system, not seven unrelated features.

## Section 5 — Business outcomes

Composition: **split story** or **editorial/product split**.

Do not default to a three-card benefits grid.

Use approved business outcomes only.

## Section 6 — Four-step workflow

Composition: **connected workflow rail**.

Required:
- visible progression;
- steps spatially related;
- one flow, not four unrelated tiles;
- mobile path remains understandable.

## Section 7 — Managed delivery and proof

Composition: **product proof + supporting narrative**.

Required:
- at least one real, legible Couranr product UI moment;
- no fake metrics;
- no unreadable miniature dashboard;
- optional supporting delivery photography if it strengthens the story.

## Section 8 — Supported business categories

Composition: **selective category grid or image-based category system**.

This may be one of the homepage's allowed card/grid-heavy sections.

Do not imply category controls eligibility where product authority says it does not.

## Section 9 — Pricing and pilot economics

Composition: **structured high-contrast information block**.

This may be the second card/panel-heavy section if needed.

All values must come from governed pricing sources.

No invented plan/subscription framing.

## Section 10 — Service areas

Composition: **map / route visual**.

Do not invent boundaries that authority has not defined.

No Maryland launch claim.

## Section 11 — FAQ and claim boundaries

Composition: **restrained utility**.

Prefer clean accordion/list structure.

Do not style every FAQ item as a floating marketing card if a simpler structure is clearer.

## Section 12 — Closing CTA

Composition: **full-bleed brand moment**.

Use the approved closing headline.

A canonical logo/tagline signature may appear if the composition supports it, but `DELIVERY MADE SIMPLE` is not required.

### Homepage hard acceptance

`PUB-001` does not pass v2.2 until:
- approved section order remains intact;
- governed copy remains correct;
- canonical logo is correct;
- Martian and Inter actually render;
- hero hierarchy is strong;
- decorative eyebrow repetition is removed;
- dominant card-grid sections <= 2;
- image-led sections >= 2;
- workflow is spatially connected;
- real product-proof composition >= 1;
- at least one full-bleed visual interruption exists;
- desktop and mobile responsive QA passes;
- native-mock fidelity review is documented;
- accessibility gate passes;
- no fake proof, metrics or prohibited claims appear.

---

## 27.1 Public family composition contracts — PUB-008/009/010/011

§32.3 says: *"For PUB-008/009/010/011, use the same metadata contract on their
top-level marketing sections where the v2.2 composition grammar governs them.
Their counts are page-specific; do not blindly copy PUB-001's numeric budgets
unless this document explicitly applies them."*

That left the hole §27.0 exists to close, four more times — a mandatory metadata
contract with no normative list to check against, plus per-page budgets called
"page-specific" without saying what they are. An implementer would invent both
and then assert against what they invented. **These four tables are that list,
and each page's `**Budgets:**` line is those counts, written to be parsed rather
than read.**

| screen | route | implementation |
|---|---|---|
| `PUB-008` | `/pricing` | `app/(couranr)/(public)/pricing/page.tsx` |
| `PUB-009` | `/businesses` | `app/(couranr)/(public)/businesses/page.tsx` |
| `PUB-010` | `/service-areas` | `app/(couranr)/(public)/service-areas/page.tsx` |
| `PUB-011` | `/how-it-works` | `app/(couranr)/(public)/how-it-works/page.tsx` |

Three rules govern all four, and they are the reason the budgets differ:

1. **§19's adjacency rule and its cap of two grid-dominant sections are
   universal.** They are properties of the grammar, not of a page. A page may
   declare a tighter cap; none may declare a looser one.
2. **PUB-001's floors are not.** Its `image-led >= 2` and `product-proof >= 1`
   exist because the homepage carries the canonical photography and the product
   composition. Applying them to `/pricing` would require inventing a
   photograph and a product proof to satisfy a number, which is the
   template-filling §28 bans. Where a floor is stated as `>= 0` below it is
   stated deliberately, not forgotten.
3. **MKT-002: the supporting pages deepen the homepage rather than repeat it.**
   Each table's "required state / intent" column names what the page adds. A
   section that would restate a homepage section verbatim is a defect in this
   table, not a styling choice.

**`grid-dominant` means the section's primary device is a repeating card or
tile grid.** A `<table>` of pricing tiers is utility content under §19.7, not a
card grid, and is recorded `false` — otherwise every data table on a pricing
page would burn the page's entire §19 budget.

Gate A cannot run on these four. `UI_SCREEN_REGISTRY.md` records each of them as
*"Derived from PUB-001 design system; no separate approved mock"*, and §26's
Gate A is a comparison against a canonical mock. §29 step 5 asks each sibling to
be compared with its own mock "not merely with the golden screen" — where no
such mock exists, the substitute is a family-coherence review against PUB-001's
proven grammar plus the screen's own content contract in `UI_SCREEN_REGISTRY.md`.
That review is recorded in `docs/couranr-mvp/brand/PUB-FAMILY_V3_REVIEW.md`, and
§25's registry records these screens as `visual_authority: "derived"` naming
PUB-001 as their source, which §25's rules require of any derived screen.

### PUB-008 — pricing

**Budgets:** grid-dominant <= 2 · image-led >= 0 · product-proof >= 0 · workflow-rail == 0

Required states from `UI_SCREEN_REGISTRY.md`: Standard; expanded pricing
details; manual-quote notice. The page deepens the homepage's pricing band,
which states only the base price and that tiers exist.

| # | `data-couranr-section` | required state / intent | device | `data-composition` (§19) | image-led | grid-dominant | product-proof |
|---|---|---|---|---|---|---|---|
| 1 | `pricing-hero` | Standard — the promise, not a card | oversized statement, no panel | `editorial-statement` | false | false | false |
| 2 | `base-price` | Standard — PRC-001/MIL-001, the page's anchor fact | navy band, one number | `full-bleed-interruption` | false | false | false |
| 3 | `mileage` | Standard — MIL-002's five tiers | data table | `structured-information-block` | false | false | false |
| 4 | `service-levels` | Standard — SUR-001 service levels, OVN-001 | asymmetric lead + charge list | `split-story` | false | false | false |
| 5 | `operating-charges` | Expanded pricing details — SUR-001 stops/signature/weight/waiting, SUR-002 | ruled schedule + disclosure | `structured-information-block` | false | false | false |
| 6 | `manual-quote` | Manual-quote notice — MIL-002 over 100 mi, SUR-001 over 200 lb, SVC-001 | statement, always visible | `editorial-statement` | false | false | false |
| 7 | `who-pays` | Standard — PAY-001, CAP-001 | asymmetric split | `split-story` | false | false | false |
| 8 | `closing` | conversion | navy brand moment | `full-bleed-interruption` | false | false | false |

### PUB-009 — businesses

**Budgets:** grid-dominant <= 1 · image-led >= 0 · product-proof >= 0 · workflow-rail == 0

Required states: category tabs; general-business fallback. PUB-001 now renders
the eleven categories, so this page deepens rather than repeats: the selection
mechanics (one primary, up to three secondary, version-stamped) and the
recommendation-not-eligibility rule in full.

| # | `data-couranr-section` | required state / intent | device | `data-composition` (§19) | image-led | grid-dominant | product-proof |
|---|---|---|---|---|---|---|---|
| 1 | `businesses-hero` | intent — the differentiation statement | oversized statement | `editorial-statement` | false | false | false |
| 2 | `category-system` | Category tabs — all eleven, ACP-024 | the page's one card grid | `structured-information-block` | false | **true** | false |
| 3 | `category-rule` | Category tabs — selection mechanics and the eligibility rule | asymmetric lead + rules | `split-story` | false | false | false |
| 4 | `channels` | intent — MKT-002's seven merchant-controlled channels, deepened to what Couranr does not take | navy band | `full-bleed-interruption` | false | false | false |
| 5 | `fallback` | General-business fallback — a first-class choice | statement | `editorial-statement` | false | false | false |
| 6 | `closing` | conversion | navy brand moment | `full-bleed-interruption` | false | false | false |

### PUB-010 — service areas

**Budgets:** grid-dominant <= 1 · image-led >= 1 · product-proof >= 0 · workflow-rail == 0

Required states: primary market; surrounding area; extended-distance review.
The homepage shows the corridor small beside a paragraph; this page is where it
is the subject. SVC-002 is unresolved, so no radius, polygon or ZIP list appears
on either.

| # | `data-couranr-section` | required state / intent | device | `data-composition` (§19) | image-led | grid-dominant | product-proof |
|---|---|---|---|---|---|---|---|
| 1 | `areas-hero` | intent — honest about being local | oversized statement | `editorial-statement` | false | false | false |
| 2 | `corridor` | Primary market — MKT-001's four, at real relative positions | the corridor at full size | `image-narrative` | **true** | false | false |
| 3 | `markets` | Primary market — the four named | the page's one card grid | `structured-information-block` | false | **true** | false |
| 4 | `surrounding` | Surrounding area — distance is measured, not typed | asymmetric split | `split-story` | false | false | false |
| 5 | `extended-review` | Extended-distance review — SVC-001, MIL-002 | ruled utility block | `structured-information-block` | false | false | false |
| 6 | `closing` | conversion | navy brand moment | `full-bleed-interruption` | false | false | false |

### PUB-011 — how it works

**Budgets:** grid-dominant <= 0 · image-led >= 0 · product-proof >= 1 · workflow-rail == 1

Required states: merchant-paid and customer-paid examples. The homepage shows a
four-step rail and two payer cards; this page carries the full CAP-001 order and
PRF-001's per-handoff-type proof requirements, neither of which appears there.

`grid-dominant <= 0` is deliberate: this page is entirely process and evidence,
and every card grid on it would be a process rendered as detached tiles — the
anti-pattern §19.4 names by name.

| # | `data-couranr-section` | required state / intent | device | `data-composition` (§19) | image-led | grid-dominant | product-proof |
|---|---|---|---|---|---|---|---|
| 1 | `works-hero` | intent — no instant-confirmation promise | oversized statement | `editorial-statement` | false | false | false |
| 2 | `sequence` | intent — CAP-001's nine ordered steps | one connected rail | `workflow-rail` | false | false | false |
| 3 | `payers` | Merchant-paid and customer-paid examples | asymmetric split, both sequences | `split-story` | false | false | false |
| 4 | `confirmation` | intent — capture only after Couranr confirmation | navy band | `full-bleed-interruption` | false | false | false |
| 5 | `proof` | intent — PRF-001 pickup and the three drop-off methods | product composition | `product-proof` | false | false | **true** |
| 6 | `support` | intent — TRM-001's one approved support sentence | ruled utility block | `structured-information-block` | false | false | false |
| 7 | `closing` | conversion | navy brand moment | `full-bleed-interruption` | false | false | false |

---

# 28. Anti-template rules

Do not repeat this pattern across a marketing page:

```text
EYEBROW
centered heading
gray paragraph
three white cards
```

Also prohibited as dominant grammar:
- icon tile + heading + sentence repeated indefinitely;
- every section centered;
- every idea inside a white rounded card;
- alternating pastel SaaS sections;
- giant gradient blobs behind screenshots;
- fake browser chrome when the real product can be shown;
- fake social proof;
- fake dashboard metrics;
- decorative pills used as hierarchy;
- generic sparkles for AI;
- perspective-distorted product screenshots;
- unreadably small product screenshots;
- automatic use of the same max-width everywhere;
- same heading size for every marketing section;
- same section composition twice in a row;
- `DELIVERY MADE SIMPLE` repeated as boilerplate;
- stock-photo clichés listed in §21.5.

---

# 29. Golden-screen propagation model

Do not apply the new visual grammar blindly to all 66 screens in one pass.

Each surface family has a **golden proving screen**.

| Family | Golden screen |
|---|---|
| Public Marketing | `PUB-001` |
| Merchant | `MER-001` |
| Operations | `OPS-002` |
| Driver | `DRV-001` |
| Customer/token | `PUB-006` / `CUS-006` visual family |
| Auth | `PUB-002` |

Operations note: `OPS-001` is not a valid native-mock proving screen at the audited baseline because the empirical mock map records no canonical mock for it. `OPS-002` is the Operations golden screen because it has canonical mock coverage; `OPS-003` is the secondary detail-screen validation. `OPS-001` may later inherit the proven Operations family grammar while still following any newer screen-specific authority that is added.

Process:

1. establish foundation;
2. make the family golden screen pass v2.2;
3. document the family-specific decisions learned from that screen;
4. propagate to sibling screens;
5. compare each sibling with its canonical mock, not merely with the golden screen.

A golden screen constrains family grammar. It does not override a sibling's mock.

---

# 30. Implementation architecture

## 30.1 Keep the current foundation

Do not replace the current Couranr styling stack just to introduce v2.2.

Preserve:
- `.cr-root` namespace boundary;
- `cr-` component class prefix;
- existing semantic primitives that remain valid;
- existing accessibility behavior.

## 30.2 Recommended file structure

```text
app/(couranr)/couranr.tokens.css      # optional extraction, same --couranr-* namespace
app/(couranr)/couranr.css             # components, roles, layouts, accessibility, surface grammars
components/couranr/**                 # reusable product primitives
components/brand/CouranrLogo.tsx      # canonical logo component
lib/couranr/design/**                 # visual registry/helpers only if needed
docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json
```

Do not add another CSS framework merely for this redesign.

Do not introduce a second component library without a measured need.

---

# 31. Migration from current `couranr.css`

At baseline, the existing token namespace already has substantial usage. Treat that as migration cost, not disposable code.

The executor must re-measure current declarations/usages at branch start rather than copying an old count into the implementation report.

## Step 1 — baseline

Record:
- current `--couranr-*` declarations;
- usage count;
- current typography classes;
- current accessibility rules;
- current public/merchant/driver/customer/Operations consumers;
- current font-loading mechanism;
- current screenshot/visual test coverage.

## Step 2 — authority materialization

Complete §2.

## Step 3 — font foundation

Load Martian Grotesk Variable, Inter Variable and Martian Mono deterministically.

Do not restyle every screen yet.

## Step 4 — token extension

Add semantic aliases and new v2.2 roles using `--couranr-*`.

Preserve old tokens while consumers still use them.

## Step 5 — accessibility regression gate

Prove the existing focus/reduced-motion/hidden-content/status behavior still works before homepage redesign.

## Step 6 — PUB-001

Rebuild/recompose the homepage using §27.

## Step 7 — review the system, not just the page

If PUB-001 still feels generic, adjust the system before broad propagation.

Do not declare “theme complete” because the homepage compiles.

## Step 8 — public family

Propagate to PUB-008/009/010/011 using their own content authority and derived visual rules.

## Step 9 — Merchant golden screen and family

Start with MER-001, then propagate carefully.

## Step 10 — Driver/customer

Prove the mobile grammars before propagation.

## Step 11 — Operations

Prove density, table/filter/action hierarchy on OPS-002 before applying broadly.

## Step 12 — retire obsolete aliases

Only remove legacy token aliases when:
- no canonical consumer remains;
- tests prove removal is safe;
- the removal is not cosmetic churn.

---

# 32. Test contract

## 32.1 Static token tests

Assert:
- `--couranr-font-display`, `--couranr-font-body`, and `--couranr-font-mono` are declared exactly once in the active canonical token layer;
- `--couranr-font-sans` resolves as the compatibility body-font alias during migration;
- locked brand hexes remain exact;
- all Couranr custom properties use `--couranr-*`;
- no new `--cr-*` token namespace is introduced;
- canonical logo paths/components remain in use;
- Route Blue is not used to recolor the logo;
- no duplicate active token definitions silently disagree.

## 32.2 Font tests

Assert in a real browser:
- hero computed font is Martian;
- body computed font is Inter;
- width-axis specimen differs measurably from default-width specimen;
- fallback does not become the intended font;
- no font network errors.

## 32.3 Composition tests — mandatory on governed public marketing sections

The anti-template composition guarantees must be executable and must not opt out.

For `PUB-001`, every top-level governed homepage section **must** expose verification metadata in the DOM. This metadata is for testing/evidence, not styling.

Required shape:

```html
<section
  data-couranr-section="category-breadth"
  data-composition="image-narrative"
  data-image-led="true"
  data-grid-dominant="false"
  data-product-proof="false"
>
```

Required attributes on all thirteen PUB-001 sections:
- `data-couranr-section` — a governed section id, and **only** an id from the
  normative table in §27.0. An id absent from that table is a test failure, not
  a new section;
- `data-composition` — one of the approved composition types;
- `data-image-led` — explicit `true`/`false`;
- `data-grid-dominant` — explicit `true`/`false`;
- `data-product-proof` — explicit `true`/`false`.

The four-step section must additionally resolve to the workflow-rail composition (or an explicitly equivalent governed value tested as one connected workflow).

Mandatory homepage tests:
- exactly the governed sections of §27.0 are present, in that table's
  order, with no extra or unknown `data-couranr-section` value;
- each section's `data-composition` matches the required composition recorded
  for it in §27.0;
- no two adjacent sections share the same `data-composition` value;
- `data-grid-dominant="true"` count <= 2;
- `data-image-led="true"` count >= 2;
- exactly one governed four-step workflow section is marked as the connected workflow composition;
- `data-product-proof="true"` count >= 1;
- required attributes are present on every governed section; missing metadata is a test failure, not a skip.

For PUB-008/009/010/011, use the same metadata contract on their top-level marketing sections where the v2.2 composition grammar governs them. Their counts are page-specific; do not blindly copy PUB-001's numeric budgets unless this document explicitly applies them.

A positive control must remove or falsify one required PUB-001 marker and prove the composition gate goes red.

## 32.4 Eyebrow test

Do not create a universal `SectionEyebrow` marketing primitive.

A static test may prohibit that component name/pattern while allowing explicit governed copy such as the PUB-001 hero eyebrow.

Do not create a brittle test that bans every small label in the product; operational labels are legitimate.

## 32.5 Accessibility tests

Keep existing tests and add coverage for:
- focus;
- reduced motion;
- 44px target floor;
- color-independent status;
- semantic headings;
- form labels/errors;
- automated accessibility scan on golden screens where practical.

## 32.6 Visual-registry test

Validate §25.

## 32.7 Responsive browser tests

Drive the golden screens at §24 widths.

Assert:
- no horizontal overflow;
- key content remains visible;
- primary action remains usable;
- image source/crop behavior is intentional where art-directed sources exist;
- sticky chrome actually sticks.

## 32.8 Positive controls

Where the repo uses positive controls for gates, prove new design guards can fail.

Examples:
- introduce a second token namespace;
- remove Martian loading;
- change a locked brand hex;
- add a third dominant homepage grid;
- disable reduced-motion handling.

Then restore the tree.

---

# 33. Evidence package

For every golden-screen visual promotion, store:

```text
reference/native-mock
implementation/desktop
implementation/mobile
region-review.md or json
responsive-results
accessibility-results
intentional-deviations
```

The review must name:
- reference file;
- native dimensions;
- implementation commit;
- browser widths;
- font verification result;
- major deviations and authority justification.

Do not store fake “diff percentage” metrics when the inputs are not comparable.

---

# 34. Required Claude / Fable execution sequence

The design-system implementation should be one coherent visual-system program with reviewable commits, not 60 unrelated micro-PRs.

Recommended sequence:

## 34.1 Fast Visible Path — permitted deferrals without weakening the homepage proof

The owner may want visible improvement on PUB-001 before the complete 66-screen visual-governance program is finished. That is allowed.

### Must happen before the first v2.2 PUB-001 visual-completion claim

These items are **not deferrable**:

1. materialize the typography/design decision in the root decision registry and `UI_SCREEN_REGISTRY.md`;
2. land this v2.2 authority file;
3. declare and deterministically load the Martian/Inter/Martian Mono tokens in §9–§10;
4. preserve/prove the existing accessibility floor;
5. create a validated PUB-001 visual-authority record with actual measured source dimensions;
6. inventory and govern every photography asset actually used by PUB-001;
7. add the mandatory PUB-001 composition metadata/tests in §32.3;
8. rebuild PUB-001;
9. run native-mock region review, responsive runtime QA, and accessibility QA on PUB-001.

### May be deferred until after owner visual approval of PUB-001

These items may land in later commits/PR slices:

- completing `VISUAL_AUTHORITY_REGISTRY.json` for all remaining 65 screens;
- creating photography-registry entries for assets not used by the homepage yet;
- extracting tokens into a separate `couranr.tokens.css` file;
- Merchant/Driver/Customer/Operations golden-screen redesigns;
- broad visual propagation across sibling screens;
- removal of obsolete v1 aliases;
- non-homepage design cleanup that does not affect the PUB-001 proof.

### Fast-path stop condition

If PUB-001 still looks generic after the required homepage gates, **stop propagation**. Fix typography/composition/imagery/system rules first.

The fast path exists to get a trustworthy visible result sooner, not to bypass authority, fonts, accessibility, composition tests, or homepage visual review.

### V0 — authority normalization
- add v2.2 file;
- materialize the owner design decision in root registry;
- amend UI registry typography/cross-reference;
- add approved differentiation statement to marketing authority;
- preserve brand tagline rules.

### V1 — foundation
- deterministic fonts;
- `--couranr-*` semantic extensions;
- optional token-file extraction;
- accessibility non-regression tests;
- visual authority registry.

### V2 — PUB-001 proving surface
- visual recon against native mock;
- photography inventory;
- rebuild composition under §27;
- responsive and accessibility verification;
- evidence.

### V3 — remaining public family
- PUB-008/009/010/011;
- each uses its own content contract;
- family coherence without page duplication.

### V4 — Merchant
- MER-001 golden pass;
- propagate to canonical Merchant screens as current implementation scope allows.

### V5 — Customer + Driver
- mobile-first golden screens;
- propagate with action/status priority.

### V6 — Operations
- OPS-002 golden pass;
- use OPS-003 as the secondary Operations detail-screen validator;
- propagate command-center grammar.

### V7 — reconciliation
- remove obsolete visual aliases only where safe;
- update screen/implementation ledgers honestly;
- run full functional + visual + accessibility gates.

Security, money, custody and production-critical fixes always outrank cosmetic sequencing if a live P0 is discovered.

---

# 35. Claude / Fable implementation directive

Use the following as the execution contract:

> Read the root decision registry, `UI_SCREEN_REGISTRY.md`, the applicable written product authority, the empirical mock-to-screen mapping, the actual canonical mock, and `COURANR_VISUAL_SYSTEM_V2_2.md` before editing a canonical UI surface.
>
> First materialize the owner-approved v2.2 typography/brand decision into the root decision registry and UI registry. Do not let a lower-ranked design file silently override those authorities.
>
> Preserve the canonical logo, locked Couranr colors, existing `--couranr-*` namespace, focus behavior, reduced-motion behavior, visually-hidden utility, minimum touch targets, status semantics, duration tokens and z-index tokens unless a measured defect requires a reviewed change.
>
> Load Martian Grotesk Variable, Inter Variable and Martian Mono deterministically. Verify in a browser that the intended font and Martian width treatment actually render.
>
> Do not create a second `--cr-*` token namespace.
>
> Do not create a general-purpose marketing `SectionEyebrow` component. Keep the governed PUB-001 hero eyebrow. Preserve `DELIVERY MADE SIMPLE` as the approved optional logo/tagline lockup and never treat it as prohibited copy.
>
> Do not redesign from memory. The token system provides reusable primitives; each canonical mock controls the screen-specific visual composition. Written authorities still control behavior, copy correctness, pricing, permissions, safety and claims.
>
> For public pages, use the v2.2 composition vocabulary. Do not repeat the same composition consecutively. Do not use card grids as the default answer. Use photography as a governed brand primitive and inventory existing repo imagery before downloading stock assets.
>
> For authenticated product screens, use the appropriate surface family: Calm Operations for Merchant, Command Center for Operations, Action First for Driver, Reassuring Utility for Customer/token surfaces, Clear Entry for auth.
>
> Do not propagate the system broadly until PUB-001 passes the native-mock fidelity review, responsive runtime gate and accessibility gate. If PUB-001 still looks generic, fix the system before copying it to other screens.
>
> Do not use arbitrary pixel-diff thresholds against design-tool exports at unknown viewports. Record native reference dimensions and compare named regions. Verify responsive behavior separately at real browser widths.
>
> Functional correctness does not imply visual completion. Token usage does not imply visual completion. A screenshot existing does not imply visual completion.

---

# 36. What “10/10 design system” means here

Do not put a numeric `10/10` status in the implementation ledger.

Use objective gates.

The system is **implementation-ready** when:
- authority contradictions are resolved;
- fonts load correctly;
- namespace migration is safe;
- accessibility floor is protected;
- surface families are documented;
- visual registry is complete;
- PUB-001 proves the system.

The system is **production-proven** only after the golden screens for all surface families pass the same discipline.

A beautiful Markdown file is not proof.

A beautiful homepage alone is not proof.

A coherent system across marketing and product is proof.

---

# 37. Non-goals

This revision does not:
- change Couranr pricing;
- change payment states;
- change roles/permissions;
- change service hours;
- change service-area boundaries;
- invent Maryland coverage;
- create subscription plans;
- change the canonical logo;
- turn Couranr into a marketplace;
- add a driver marketplace;
- add dark mode;
- add a new UI framework merely for aesthetics;
- force every screen to use photography;
- force every screen to use giant type;
- require a pixel-perfect rescale of design artboards;
- replace canonical mocks with tokens;
- replace product authority with design preference.

---

# 38. Final design rule

When hierarchy is weak, improve in this order:

1. **typography**;
2. **composition**;
3. **spacing**;
4. **image choice / product proof**;
5. **contrast**.

Do not reach first for:

- another eyebrow;
- another pill;
- another icon tile;
- another white card;
- another gradient.

When choosing between two treatments, prefer the one that makes Couranr feel:

> **more physical, more intentional, more legible, more operational, more commercially clear, and less templated.**

And preserve the commercial distinction:

> **Delivery made simple** is the brand memory.  
> **Your customers want delivery. Now you can say yes.** is the sales promise.  
> **Local delivery, built for more than restaurants.** is the differentiation.

Those three lines do different jobs. Do not collapse them into one repeated eyebrow.
