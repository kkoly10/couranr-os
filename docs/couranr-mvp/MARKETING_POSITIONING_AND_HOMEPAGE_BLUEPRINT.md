# Couranr Marketing Positioning and Homepage Blueprint

**Status:** owner-approved product authority
**Registered as:** `MKT-002 — Couranr Merchant Growth Positioning` in `02_DECISION_REGISTRY.json`
**Applies to:** PUB-001, PUB-008, PUB-009, PUB-010, PUB-011
**Implementation phase:** 10 (Marketing) — queued, not built by this document

---

## 0. Two notes on how this document was registered

**The decision was requested as `MKT-001`. That id was already taken.**
`MKT-001` is an accepted `decided` record — *"Four named initial markets plus
surrounding areas; Maryland is excluded from initial marketing"* — with
authority `Couranr_Claude_Code_Master_Package.md §3`, referenced by PUB-010,
PUB-001 and PUB-004, and asserted by name in `tests/decision-registry.test.ts`.

This positioning decision does not replace that one; it **depends** on it. The
service-areas section below names exactly those four markets, and "do not claim
Maryland launch coverage" is existing `MKT-001` restated. Overwriting would
have deleted a decision this document relies on. It is therefore registered as
**`MKT-002`**, with `depends_on: ["MKT-001"]`.

If the owner prefers the positioning decision to hold the `MKT-001` id, the
markets decision must be renumbered first, in its own reviewed commit, because
seven files cite it.

**The second `02_DECISION_REGISTRY.json` was deliberately not modified.**
There are two files with that name. The rank-1 authority is the repo-root file
and it received this decision. The other,
`couranr_claude_code_package/02_DECISION_REGISTRY.json`, is the original v1.0
topic-keyed source; `couranr_claude_code_package/00_PROVENANCE.md` states it is
"kept for provenance — it shows what was originally delivered — not for
citation", and `tests/decision-registry-provenance.test.ts` pins its shape.
Writing a 2026 marketing decision into a v1.0 provenance snapshot would falsify
what that file is. It is a historical record, and this repo already holds the
principle that append-only history is never rewritten.

---

## 1. Positioning

### Internal category

Couranr is **local delivery infrastructure for independent local businesses**.

### Core customer-facing position

> "Couranr helps independent local businesses offer delivery without joining a
> marketplace, building a fleet or giving up their customer relationship."

### Primary emotional promise

> "Your customers want delivery. Now you can say yes."

### Core operational promise

> "Receive the order however you already receive it. Couranr handles what
> happens after the order is ready."

### Supported merchant order channels

- website
- phone
- text
- social media
- point of sale
- storefront / in person
- other merchant-controlled channels

**Couranr is not the merchant's ecommerce platform and does not own the product
sale.**

---

## 2. Business outcomes

The marketing must explain that Couranr helps merchants:

- prevent pickup-only orders from being lost;
- serve customers who cannot easily visit the business;
- extend the practical area they can sell within;
- convert phone, social, website and storefront orders into deliveries;
- offer professional tracking and proof without operating a fleet;
- keep product revenue and ownership of the customer relationship.

### Approved claim

> "Serve more customers."

### Unapproved claim, until marketplace / customer-acquisition functionality exists

> ~~"Couranr brings you new customers."~~

Couranr enables merchants to **serve more demand**. It must not claim to
generate customers, leads or product sales.

---

## 3. Market differentiation

### Approved framing

> "Local delivery should not stop at restaurant orders."

Couranr serves independent local businesses whose products or operations do not
fit restaurant-focused delivery marketplaces.

### Approved differentiation statement

> **"Local delivery, built for more than restaurants."**

Added by `VIS-001` (root decision registry) per
`docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md` §2.3 and §4.5.

This is the **concise commercial statement** — the short line a merchant
remembers. It does **not** replace the framing above, which remains valid
positioning context; the visual system's §2.3 says so explicitly.

Usage: it belongs as a major editorial statement where the page explains
category breadth — PUB-001's `category-breadth` section (§27.0 of the visual
system). Do not shrink it into an eyebrow or a small label; §14 of the visual
system prohibits that, and it is the specific failure this line was written to
avoid.

The three brand lines do different jobs and must not collapse into one:

| Line | Job |
|---|---|
| Delivery made simple. | brand memory / logo lockup |
| Your customers want delivery. Now you can say yes. | the sales promise (hero) |
| Local delivery, built for more than restaurants. | the differentiation |

### Boundaries

- Do **not** build the identity around attacking or naming Uber Eats, DoorDash
  or another competitor throughout the page.
- Do **not** claim that those services categorically reject every listed
  business.

---

## 4. Homepage structure (PUB-001)

The homepage is twelve sections, in this order.

> **Amended by MKT-003 (2026-08-14).** The owner approved a thirteenth section,
> `delivery-options` — the canonical artboard's "Delivery options that fit your
> needs" — inserted between section 8 and section 9. It introduces no new claim:
> every value it renders is already decided by SUR-001, SUR-002, MIL-002 and
> OVN-001. The normative section list, with ids and compositions, is §27.0 of
> `docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md`; this table is the
> pre-amendment content architecture and is kept as written.

| # | Section |
|---|---|
| 1 | Hero — say yes to more orders |
| 2 | Pickup-only problem |
| 3 | Delivery is not only for restaurants |
| 4 | Keep selling through existing channels |
| 5 | Business-growth outcomes |
| 6 | Four-step Couranr workflow |
| 7 | Couranr-managed delivery and proof |
| 8 | Supported business categories |
| 9 | Pricing and pilot economics |
| 10 | Service areas |
| 11 | FAQ and claim boundaries |
| 12 | Closing conversion CTA |

### Hero — approved copy

**Eyebrow**

> Local delivery for independent businesses

**Headline**

> Your customers want delivery. Now you can say yes.

**Supporting copy**

> Keep taking orders through your website, phone, text, social media, POS or
> storefront. Couranr handles the delivery—from quote and payment to managed
> dispatch, tracking and proof.

**Primary CTA**

> Create your business account

**Secondary CTA**

> Estimate a delivery

**Trust line**

> No monthly fee during the pilot. No product-sales commission. You keep the
> sale and the customer relationship.

### Closing headline — approved copy

> The next customer who asks, "Can you deliver?" deserves a better answer.

---

## 5. Supporting pages

The supporting pages **deepen** the homepage rather than repeat it.

| Screen | Route | Content authority |
|---|---|---|
| PUB-009 | `/businesses` | Supported industries, use cases and merchant-controlled order channels. |
| PUB-011 | `/how-it-works` | Merchant-paid and customer-paid workflows, Couranr confirmation, dispatch, tracking and proof. |
| PUB-008 | `/pricing` | Locked delivery pricing and approved operating charges. |
| PUB-010 | `/service-areas` | DC, Stafford, Woodbridge, Fredericksburg, surrounding areas and extended-distance review. |
| PUB-004 | `/estimate` | Primary public conversion action. |

PUB-004 is named here as the conversion target. Its own copy contract is
unchanged by this decision and it is **not** re-pointed at this blueprint —
`/estimate` is a priced product surface governed by the pricing decisions, not
a marketing page.

---

## 6. Claim and copy boundaries

Do **not** claim:

- Couranr brings merchants customers;
- guaranteed sales growth;
- guaranteed delivery times;
- instant confirmation;
- 24/7 support;
- marketplace demand;
- thousands of users or deliveries;
- public driver bidding;
- product buyer protection;
- product refund responsibility;
- Maryland launch coverage;
- subscription pricing during the pilot.

### Responsibility split

The **merchant** remains responsible for merchandise price, quality,
availability, packaging, product refunds and the customer relationship.

**Couranr** handles the delivery service and approved delivery-related charges.

---

## 7. Visual direction

The future implementation must:

- use the canonical PUB-001 visual direction;
- inherit the typography and hierarchy established in the newer mocks;
- avoid generic startup copy;
- avoid glassmorphism, giant halos, emoji feature cards and fake metrics;
- show the flow from multiple merchant order channels into one Couranr delivery
  workflow;
- use real product screens only when they are legible and implemented;
- remain responsive and conversion-focused.

`UI-TYP-001` remains a separate but related implementation requirement.

---

## 8. The current homepage is a structural replacement, not a copy edit

`app/page.tsx` is **352 lines of legacy mixed-product marketing** and must be
**structurally replaced**, not copy-polished.

Its current sections, in render order, are:

1. `<PublicHeader />` — the legacy public header.
2. Hero — *"Local logistics and document support for busy people and small
   teams."*, primary CTA to `/courier/quote`.
3. "Who Couranr is for" — three consumer audience cards.
4. "What we do" — three service cards linking to **all three legacy product
   lines**: Auto Rentals → `/auto/vehicles`, Courier Delivery →
   `/courier/quote`, Couranr Docs → `/docs`.
5. "Transparent pricing snapshot" — price cards for all three product lines.
6. "Proof and reliability" — three trust cards.
7. "Built for Trust & Clarity" — a three-step how-it-works.

Every one of those sections contradicts this decision:

- the audience is **consumers**, not independent local businesses;
- the product is **three legacy lines**, two of which are quarantine targets;
- the CTAs point at legacy routes that are not in the canonical route map;
- there is no merchant order-channel concept anywhere on the page.

There is no subset of this page that survives a copy rewrite. Rewriting the
words on a page whose *structure* markets the wrong product to the wrong
audience would produce a page that is wrong in a harder-to-see way.

`LEG-001` already records that `/` (PUB-001) is occupied by `app/page.tsx` as
legacy multiservice marketing, with remediation queued to the marketing slice.
This blueprint is the copy and conversion authority for that replacement.

---

## 9. What this document does not do

- It does **not** implement or redesign any public page.
- It does **not** change pricing, service areas, hours or any priced value.
  Those remain governed by their own decisions.
- It does **not** authorise touching `app/page.tsx` yet. That is Phase 10 work,
  queued as `P10-003`..`P10-007` in
  `couranr_claude_code_package/08_WORK_BREAKDOWN.csv`.

---

## 10. Acceptance criteria for the future implementation

An implementation satisfies this blueprint when:

1. The homepage renders the sections in the order given in §4, plus
   `delivery-options` in the position MKT-003 assigns it.
2. The hero uses the approved eyebrow, headline, supporting copy, both CTAs and
   the trust line verbatim.
3. The closing section uses the approved closing headline verbatim.
4. Every merchant order channel in §1 is named somewhere on the homepage.
5. No string on any public page matches a claim in §6.
6. The page never names a competitor as an adversary.
7. `/businesses`, `/how-it-works`, `/pricing` and `/service-areas` each add
   depth rather than restating homepage copy.
8. `app/page.tsx` has been structurally replaced, not edited in place.
