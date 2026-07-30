# Couranr Canonical MVP UI Definition

**Version:** 1.0  
**Status:** Approved implementation source of truth  
**Product:** Couranr — local delivery infrastructure for local businesses

## 1. Authority and conflict rules

1. `02_DECISION_REGISTRY.json` controls locked product decisions, pricing, operating hours, payer behavior, states, terminology, and launch gates.
2. `01_MASTER_IMPLEMENTATION_SPEC.md` controls workflows, permissions, data, payments, proof, exceptions, routes, and release scope.
3. `05_AI_COMMUNICATION_SPEC.md` controls messaging, Assistant, Ghost Operations, Ask Couranr, confidence, verifier, privacy, and kill switches.
4. This file controls which screens are MVP, their routes/states, and which image is the canonical visual reference.
5. Canonical images control layout, hierarchy, visual language, and responsive intent only. They never override written pricing, policy, permissions, state transitions, security, claims, or copy.
6. Legacy repository behavior and noncanonical mocks have no authority.

> **Required implementation rule:** Written specifications control behavior. Canonical mocks control appearance. When they conflict, the written specification wins and the mock must be corrected during implementation.

## 2. MVP visual system

- **Canonical logo:** lowercase Couranr wordmark from the canonical logo package. Do not redraw or substitute the old pin, `C.`, or AI variants.
- **Navy:** `#0D1525` — sidebar, high-emphasis text, dark surfaces.
- **Couranr Gold:** `#F4B740` — primary action and restrained brand accent.
- **Route Blue:** `#2563EB` — maps, links, route and informational states.
- **Canvas:** `#F7F8F5`; **Surface:** `#FFFFFF`; **Border:** `#E3E7ED`; **Muted:** `#667085`; **Success:** `#15803D`.
- **Typography:** Geist Sans or Inter. Use sentence case, short labels, readable line height, and no generic “seamless/reimagined” startup language.
- **Cards:** 18–22 px radius, one-pixel neutral border, restrained shadow, 24–32 px padding.
- **Buttons:** 46–52 px height on desktop, at least 44 px touch target, clear primary/secondary/destructive hierarchy.
- **No:** giant halos, glassmorphism, emoji feature icons, perspective-distorted UI, fake metrics, unreadable miniature dashboards, or color-only status meaning.

## 3. Global content and behavior corrections

- Couranr charges only for delivery and approved operating charges. Product price and product refund remain the merchant’s responsibility.
- Pilot has no monthly fee, signup fee, product-sales commission, subscription tier, or mandatory plan purchase.
- MVP has no public support phone. Primary support is in-app; the normal Couranr response target is 15 minutes during operating hours.
- Do not claim 24/7 support, on-time guarantee, buyer protection, trusted-by-thousands, delivery volume, customer count, ratings, or other unverified proof.
- Operating hours are Monday–Friday, 6:00 AM–6:00 PM, with a 4:00 PM same-day cutoff. Overnight is request-only when enabled; Rush and Overnight do not stack.
- Initial marketed areas are Washington, DC; Stafford; Woodbridge; Fredericksburg; and surrounding areas. Maryland is not initially marketed.
- All time windows and ETAs are estimates. Couranr confirms availability, schedule, and vehicle before capture.
- Initial dispatch is Couranr-managed. No public driver marketplace, self-selection, bidding, or automatic assignment without authorized Operations command.
- Customer accounts are optional. There is no unrestricted customer–driver chat.
- AI cannot execute price, payment, address, delivery state, cancellation, refund, return, incident, claim, vehicle, or safety decisions.
- Never expose founder/personal-operator language. Use Couranr review, Couranr confirmation, Couranr Operations Queue, Couranr-managed dispatch, and Couranr Support.

## 4. Route and screen registry

**Tier meanings:** `Core` is required before the production canary. `MVP-complete` may follow the core vertical slice but is required before broad pilot scaling. No screen marked post-MVP belongs in the first implementation branch.

### Public

| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |
|---|---|---|---|---|---|---|
| PUB-001 | Marketing homepage | `/` | Core | 10 | Responsive | `canonical-mvp-images/public/PUB-001_marketing-homepage.png` |
| PUB-002 | Sign in | `/sign-in` | Core | 10 | Responsive | `canonical-mvp-images/public/PUB-002_sign-in.png` |
| PUB-003 | Business sign up | `/sign-up` | Core | 4 | Responsive | `canonical-mvp-images/public/PUB-003_business-sign-up.png` |
| PUB-004 | Delivery estimate and hosted request | `/estimate and /request/[merchantSlug]` | Core | 5–6 | Mobile-first responsive | `canonical-mvp-images/public/PUB-004_delivery-estimate-and-hosted-request.png` |
| PUB-005 | Secure delivery payment | `/pay/[token]` | Core | 6 | Mobile-first responsive | `canonical-mvp-images/public/PUB-005_secure-delivery-payment.png` |
| PUB-006 | Secure live tracking | `/track/[token]` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/public/PUB-006_secure-live-tracking.png` |
| PUB-007 | Delivery Help | `/help/[token]` | Core | 8 | Mobile-first responsive | `canonical-mvp-images/public/PUB-007_delivery-help.png` |
| PUB-008 | Pricing page | `/pricing` | Core | 10 | Responsive | `Derived from PUB-001 design system; no separate approved mock.` |
| PUB-009 | Businesses page | `/businesses` | Core | 10 | Responsive | `Derived from PUB-001 design system; no separate approved mock.` |
| PUB-010 | Service areas page | `/service-areas` | Core | 10 | Responsive | `Derived from PUB-001 design system; no separate approved mock.` |
| PUB-011 | How Couranr works | `/how-it-works` | Core | 10 | Responsive | `Derived from PUB-001 design system; no separate approved mock.` |

### Merchant

| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |
|---|---|---|---|---|---|---|
| MER-001 | Merchant dashboard | `/business` | Core | 4–10 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-001_merchant-dashboard.png` |
| MER-002 | Merchant onboarding | `/business/onboarding` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-002_merchant-onboarding.png` |
| MER-003 | Live activation checklist | `/business/onboarding?step=activation` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-003_live-activation-checklist.png` |
| MER-004 | Deliveries list | `/business/deliveries` | Core | 5–8 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-004_deliveries-list.png` |
| MER-005 | Create delivery with Smart Intake | `/business/deliveries/new` | Core | 5 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-005_create-delivery-with-smart-intake.png` |
| MER-006 | Delivery review and quote | `/business/deliveries/new?step=review` | Core | 6 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-006_delivery-review-and-quote.png` |
| MER-007 | Delivery detail | `/business/deliveries/[id]` | Core | 5–8 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-007_delivery-detail.png` |
| MER-008 | Customers list | `/business/customers` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-008_customers-list.png` |
| MER-009 | Customer detail | `/business/customers?customer=[id]` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-009_customer-detail.png` |
| MER-010 | Presets list | `/business/presets` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-010_presets-list.png` |
| MER-011 | Preset builder | `/business/presets?edit=[id]` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-011_preset-builder.png` |
| MER-012 | Merchant messages and support | `/business/messages` | Core | 8–9 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-012_merchant-messages-and-support.png` |
| MER-013 | Website tools | `/business/website-tools` | Core | 10 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-013_website-tools.png` |
| MER-014 | Merchant settings | `/business/settings` | Core | 4–8 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-014_merchant-settings.png` |
| MER-015 | Team and permissions | `/business/settings/team` | Core | 4 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-015_team-and-permissions.png` |
| MER-016 | Billing settings | `/business/settings/billing` | Core | 6 | Desktop-first responsive | `canonical-mvp-images/merchant/MER-016_billing-settings.png` |

### Driver

| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |
|---|---|---|---|---|---|---|
| DRV-001 | Driver dashboard | `/driver` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-001_driver-dashboard.png` |
| DRV-002 | Assigned delivery detail | `/driver/deliveries/[id]` | Core | 7–8 | Mobile primary | `canonical-mvp-images/driver/DRV-002_assigned-delivery-detail.png` |
| DRV-003 | Pickup PIN and proof | `/driver/deliveries/[id]?step=pickup-proof` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-003_pickup-pin-and-proof.png` |
| DRV-004 | Package discrepancy | `/driver/deliveries/[id]?step=discrepancy` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-004_package-discrepancy.png` |
| DRV-005 | Driving Mode | `/driver/deliveries/[id]?mode=driving` | Core | 7–9 | Mobile primary | `canonical-mvp-images/driver/DRV-005_driving-mode.png` |
| DRV-006 | Drop-off proof | `/driver/deliveries/[id]?step=delivery-proof` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-006_drop-off-proof.png` |
| DRV-007 | Offline proof sync | `/driver/deliveries/[id]?panel=offline-sync` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-007_offline-proof-sync.png` |
| DRV-008 | Driver messages | `/driver/messages` | Core | 8–9 | Mobile primary | `canonical-mvp-images/driver/DRV-008_driver-messages.png` |
| DRV-009 | Driver availability | `/driver/availability` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-009_driver-availability.png` |
| DRV-010 | Vehicle profile | `/driver/vehicle` | Core | 7 | Mobile primary | `canonical-mvp-images/driver/DRV-010_vehicle-profile.png` |

### Operations

| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |
|---|---|---|---|---|---|---|
| OPS-001 | Operations dashboard | `/operations` | Core | 7–10 | Desktop primary | `canonical-mvp-images/operations/OPS-001_operations-dashboard.png` |
| OPS-002 | Queue and managed dispatch | `/operations/queue and /operations/deliveries` | Core | 7 | Desktop primary | `canonical-mvp-images/operations/OPS-002_queue-and-managed-dispatch.png` |
| OPS-003 | Delivery review workspace | `/operations/deliveries/[id]` | Core | 7 | Desktop primary | `canonical-mvp-images/operations/OPS-003_delivery-review-workspace.png` |
| OPS-004 | Requote and promotional credit | `/operations/deliveries/[id]?panel=requote` | Core | 6–7 | Desktop primary | `canonical-mvp-images/operations/OPS-004_requote-and-promotional-credit.png` |
| OPS-005 | Operations messages and support inbox | `/operations/messages and /operations/support` | Core | 8–9 | Desktop primary | `canonical-mvp-images/operations/OPS-005_operations-messages-and-support-inbox.png` |
| OPS-006 | Couranr Ghost Operations | `/operations/ghost` | Core | 9 | Desktop primary | `canonical-mvp-images/operations/OPS-006_couranr-ghost-operations.png` |
| OPS-007 | Merchant management | `/operations/merchants` | Core | 4–9 | Desktop primary | `canonical-mvp-images/operations/OPS-007_merchant-management.png` |
| OPS-008 | Vehicle management | `/operations/vehicles` | Core | 7 | Desktop primary | `canonical-mvp-images/operations/OPS-008_vehicle-management.png` |
| OPS-009 | Payments and reconciliation | `/operations/payments` | Core | 6 | Desktop primary | `canonical-mvp-images/operations/OPS-009_payments-and-reconciliation.png` |
| OPS-010 | Payment authorization review | `/operations/payments?tab=authorizations` | Core | 6 | Desktop primary | `canonical-mvp-images/operations/OPS-010_payment-authorization-review.png` |
| OPS-011 | Refund management | `/operations/refunds` | Core | 6–7 | Desktop primary | `canonical-mvp-images/operations/OPS-011_refund-management.png` |
| OPS-012 | Incidents and claims | `/operations/incidents` | Core | 7 | Desktop primary | `canonical-mvp-images/operations/OPS-012_incidents-and-claims.png` |
| OPS-013 | Operations analytics | `/operations/analytics` | Core | 10 | Desktop primary | `canonical-mvp-images/operations/OPS-013_operations-analytics.png` |
| OPS-014 | Unmet demand analytics | `/operations/analytics?tab=unmet-demand` | MVP-complete | 10 | Desktop primary | `canonical-mvp-images/operations/OPS-014_unmet-demand-analytics.png` |
| OPS-015 | Operations settings | `/operations/settings` | Core | 3, 8–9 | Desktop primary | `canonical-mvp-images/operations/OPS-015_operations-settings.png` |
| OPS-016 | Availability controls | `/operations/settings?tab=availability` | Core | 3, 7 | Desktop primary | `canonical-mvp-images/operations/OPS-016_availability-controls.png` |
| OPS-017 | Policy and pricing registry | `/operations/settings?tab=policies` | MVP-complete | 3 | Desktop primary | `canonical-mvp-images/operations/OPS-017_policy-and-pricing-registry.png` |
| OPS-018 | Notification template manager | `/operations/settings?tab=notifications` | MVP-complete | 8 | Desktop primary | `canonical-mvp-images/operations/OPS-018_notification-template-manager.png` |
| OPS-019 | Ghost auto-reply controls and kill switches | `/operations/settings?tab=ai` | Core | 9 | Desktop primary | `canonical-mvp-images/operations/OPS-019_ghost-auto-reply-controls-and-kill-switches.png` |
| OPS-020 | Activity and audit log | `/operations/settings?tab=audit` | Core | 2–9 | Desktop primary | `canonical-mvp-images/operations/OPS-020_activity-and-audit-log.png` |
| OPS-021 | Ask Couranr lead inbox | `/operations/ghost?tab=leads` | MVP-complete | 9–10 | Desktop primary | `canonical-mvp-images/operations/OPS-021_ask-couranr-lead-inbox.png` |

### Customer

| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |
|---|---|---|---|---|---|---|
| CUS-001 | Address-change request | `/help/[token]#address-change` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-001_address-change-request.png` |
| CUS-002 | Cancellation and return request | `/help/[token]#cancellation-return` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-002_cancellation-and-return-request.png` |
| CUS-003 | Recipient unavailable resolution | `/help/[token]#recipient-unavailable` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-003_recipient-unavailable-resolution.png` |
| CUS-004 | Delivery problem report | `/help/[token]#delivery-problem` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-004_delivery-problem-report.png` |
| CUS-005 | Revised quote approval | `/pay/[token]?mode=requote` | Core | 6–7 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-005_revised-quote-approval.png` |
| CUS-006 | Proof-of-delivery viewer | `/track/[token]#proof` | Core | 7 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-006_proof-of-delivery-viewer.png` |
| CUS-007 | Return and refund status | `/help/[token]#return-status` | Core | 6–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-007_return-and-refund-status.png` |
| CUS-008 | Delivery preferences and access instructions | `/track/[token]#access` | Core | 7–8 | Mobile-first responsive | `canonical-mvp-images/customer/CUS-008_delivery-preferences-and-access-instructions.png` |

## 5. Detailed screen contracts

### Public contracts

#### PUB-001 — Marketing homepage

- **Route/state:** `/`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Explain Couranr to local merchants and drive business-account creation or delivery estimation.
- **Allowed actions:** Create business account; estimate delivery; open Ask Couranr; navigate to pricing, businesses, service areas, and how it works.
- **Required states:** Default; mobile navigation; assistant closed/open; service-area notice.
- **Authoritative source:** Spec §§2–4, 16
- **Mandatory correction/constraint:** Use the locked merchant-delivery positioning. No auto rental/docs, fake metrics, guarantees, phone support, subscriptions, or Maryland launch marketing.
- **Canonical visual:** `canonical-mvp-images/public/PUB-001_marketing-homepage.png`

#### PUB-002 — Sign in

- **Route/state:** `/sign-in`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Authenticate merchants, drivers, and Operations users through one branded entry point.
- **Allowed actions:** Password sign-in; Google sign-in when enabled; magic link; password recovery.
- **Required states:** Idle; validation error; invalid credentials; rate limited; magic-link sent; loading.
- **Authoritative source:** Spec §§14, 16
- **Mandatory correction/constraint:** Use canonical Couranr logo. Remove fabricated performance statistics and phone-support claims.
- **Canonical visual:** `canonical-mvp-images/public/PUB-002_sign-in.png`

#### PUB-003 — Business sign up

- **Route/state:** `/sign-up`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Create a test workspace without forcing heavy live-activation requirements.
- **Allowed actions:** Create account; OAuth when enabled; accept account terms.
- **Required states:** Idle; field errors; existing account; verification sent; loading.
- **Authoritative source:** Spec §5, §16
- **Mandatory correction/constraint:** Do not require website, EIN, registration upload, Stripe, or full activation during sign-up.
- **Canonical visual:** `canonical-mvp-images/public/PUB-003_business-sign-up.png`

#### PUB-004 — Delivery estimate and hosted request

- **Route/state:** `/estimate and /request/[merchantSlug]`
- **Tier / phase:** Core / Phase 5–6
- **Purpose:** Capture a delivery estimate or a merchant-branded customer request without requiring an account.
- **Allowed actions:** Enter order reference, destination, recipient, package, timing, payer preference; submit to merchant validation when merchant-hosted.
- **Required states:** Draft; address validation; merchant confirmation pending; quote unavailable; review required; submitted.
- **Authoritative source:** Spec §§6–7, 16
- **Mandatory correction/constraint:** The merchant must validate customer-initiated merchandise details before payment. Do not include product checkout or merchandise payment.
- **Canonical visual:** `canonical-mvp-images/public/PUB-004_delivery-estimate-and-hosted-request.png`

#### PUB-005 — Secure delivery payment

- **Route/state:** `/pay/[token]`
- **Tier / phase:** Core / Phase 6
- **Purpose:** Allow the selected payer to authorize the delivery charge against an immutable quote.
- **Allowed actions:** Review delivery-only quote; select payment method; authorize; handle additional authentication.
- **Required states:** Quote valid; expiring; requires action; authorized; failed; cancelled; replaced by requote.
- **Authoritative source:** Spec §§7, 10, 16
- **Mandatory correction/constraint:** Charge delivery and approved operating fees only. Remove merchandise subtotal, on-time guarantee, buyer-protection, 24/7 phone, and “trusted by thousands” claims.
- **Canonical visual:** `canonical-mvp-images/public/PUB-005_secure-delivery-payment.png`

#### PUB-006 — Secure live tracking

- **Route/state:** `/track/[token]`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Show safe, token-scoped delivery progress, estimated timing, proof availability, and help.
- **Allowed actions:** View status; update allowed access instructions; open Delivery Help; view proof when complete.
- **Required states:** Preparing; confirmed; assigned; picked up; in transit; at drop-off; delivered; return; proof processing.
- **Authoritative source:** Spec §§11–12, 16
- **Mandatory correction/constraint:** Times are estimates. Do not show unrestricted call or customer–driver chat. Use secure delivery-specific messaging/help.
- **Canonical visual:** `canonical-mvp-images/public/PUB-006_secure-live-tracking.png`

#### PUB-007 — Delivery Help

- **Route/state:** `/help/[token]`
- **Tier / phase:** Core / Phase 8
- **Purpose:** Provide delivery-aware support with secure in-app messaging and guided issue categories.
- **Allowed actions:** Choose help topic; message Couranr Support; attach evidence; see response target and case status.
- **Required states:** Open; waiting on customer; waiting on Couranr; resolved; after-hours; urgent safety escalation.
- **Authoritative source:** Spec §12, AI spec §Communication model
- **Mandatory correction/constraint:** No public support phone at MVP. State the normal 15-minute response target during operating hours, not a guarantee.
- **Canonical visual:** `canonical-mvp-images/public/PUB-007_delivery-help.png`

#### PUB-008 — Pricing page

- **Route/state:** `/pricing`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Explain deterministic delivery pricing and approved surcharges.
- **Allowed actions:** Estimate a delivery; create business account.
- **Required states:** Standard; expanded pricing details; manual-quote notice.
- **Authoritative source:** Spec §4, §16
- **Mandatory correction/constraint:** Derive visually from PUB-001. First 3 miles $22.99; no monthly fee during pilot; all estimates subject to Couranr confirmation.
- **Canonical visual:** `Derived from PUB-001 design system; no separate approved mock.`

#### PUB-009 — Businesses page

- **Route/state:** `/businesses`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Show supported business categories and merchant-controlled ordering channels.
- **Allowed actions:** Select category; create business account; estimate delivery.
- **Required states:** Category tabs; general-business fallback.
- **Authoritative source:** Spec §§2, 5, 16
- **Mandatory correction/constraint:** Category changes recommendations, not eligibility. Do not advertise medical or prohibited categories.
- **Canonical visual:** `Derived from PUB-001 design system; no separate approved mock.`

#### PUB-010 — Service areas page

- **Route/state:** `/service-areas`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Explain DC, Stafford, Woodbridge, Fredericksburg, surrounding areas, and review-based extended distance.
- **Allowed actions:** Check route; estimate delivery.
- **Required states:** Primary market; surrounding area; extended-distance review.
- **Authoritative source:** Spec §3, §16
- **Mandatory correction/constraint:** Maryland is not initially marketed. Do not use rigid ZIP rejection.
- **Canonical visual:** `Derived from PUB-001 design system; no separate approved mock.`

#### PUB-011 — How Couranr works

- **Route/state:** `/how-it-works`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Explain request, payer, Couranr confirmation, pickup, tracking, proof, and support.
- **Allowed actions:** Create account; estimate delivery.
- **Required states:** Merchant-paid and customer-paid examples.
- **Authoritative source:** Spec §§7, 11–12, 16
- **Mandatory correction/constraint:** No instant-confirmation promise. Capture occurs after Couranr confirmation.
- **Canonical visual:** `Derived from PUB-001 design system; no separate approved mock.`

### Merchant contracts

#### MER-001 — Merchant dashboard

- **Route/state:** `/business`
- **Tier / phase:** Core / Phase 4–10
- **Purpose:** Show today’s deliveries, readiness, attention items, payment states, messages, and quick actions.
- **Allowed actions:** Create delivery; mark ready; open delivery; view messages; resolve attention items.
- **Required states:** New workspace; empty; active day; degraded payments; activation incomplete.
- **Authoritative source:** Spec §§5, 7–8, 12, 16–17
- **Mandatory correction/constraint:** No fabricated revenue, customer, or on-time metrics. Use real posted data only.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-001_merchant-dashboard.png`

#### MER-002 — Merchant onboarding

- **Route/state:** `/business/onboarding`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Create the test workspace, choose category, set pickup location and payer default, and accept basic policies.
- **Allowed actions:** Verify contact; add business; choose 1 primary + up to 3 secondary categories; set payer default; continue to workspace.
- **Required states:** Test workspace; verification pending; suspicious-business review; saved draft.
- **Authoritative source:** Spec §5
- **Mandatory correction/constraint:** Keep onboarding light. Logo, Stripe, advanced website tools, and live activation belong after dashboard entry.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-002_merchant-onboarding.png`

#### MER-003 — Live activation checklist

- **Route/state:** `/business/onboarding?step=activation`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Guide the merchant from test workspace to live delivery eligibility.
- **Allowed actions:** Accept delivery terms; prohibited-item policy; responsibility and return acknowledgement; verify operations contact; run test delivery; request activation.
- **Required states:** Not started; in progress; pending Couranr review; live; blocked with reason.
- **Authoritative source:** Spec §5
- **Mandatory correction/constraint:** Do not require website tools or subscription purchase to activate. Use only true live-activation requirements.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-003_live-activation-checklist.png`

#### MER-004 — Deliveries list

- **Route/state:** `/business/deliveries`
- **Tier / phase:** Core / Phase 5–8
- **Purpose:** Find and manage merchant delivery requests across request, payment, readiness, review, and fulfillment states.
- **Allowed actions:** Filter; search; create; open; duplicate; cancel when allowed; mark ready.
- **Required states:** All canonical request/payment/readiness/fulfillment combinations; empty; error.
- **Authoritative source:** Spec §§7–8, 16
- **Mandatory correction/constraint:** Never collapse independent state groups into one misleading status.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-004_deliveries-list.png`

#### MER-005 — Create delivery with Smart Intake

- **Route/state:** `/business/deliveries/new`
- **Tier / phase:** Core / Phase 5
- **Purpose:** Turn merchant text, pasted orders, presets, or manual entry into an editable structured delivery draft.
- **Allowed actions:** Describe/paste; apply preset; confirm extracted fields; answer one clarification; choose payer and timing; continue to review.
- **Required states:** Blank; parsing; high/medium/low confidence; clarification; review trigger; AI unavailable/manual fallback.
- **Authoritative source:** Spec §6, AI spec §Smart Intake
- **Mandatory correction/constraint:** AI never prices, confirms, selects final vehicle, or invents critical fields.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-005_create-delivery-with-smart-intake.png`

#### MER-006 — Delivery review and quote

- **Route/state:** `/business/deliveries/new?step=review`
- **Tier / phase:** Core / Phase 6
- **Purpose:** Review normalized delivery details, deterministic quote, payer, policy flags, and customer-payment link before submission.
- **Allowed actions:** Edit details; accept quote; choose merchant/customer payer; authorize or send payment link; submit for Couranr review.
- **Required states:** Quote valid; review required; payment pending; authorized; requote required; validation error.
- **Authoritative source:** Spec §§4, 7, 10
- **Mandatory correction/constraint:** Use locked pricing. No product sale amount. No silent price change.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-006_delivery-review-and-quote.png`

#### MER-007 — Delivery detail

- **Route/state:** `/business/deliveries/[id]`
- **Tier / phase:** Core / Phase 5–8
- **Purpose:** Provide the merchant’s complete delivery timeline, payer/readiness states, map, proof, conversation, and permitted actions.
- **Allowed actions:** Mark ready; message driver/support; request change; approve merchant-paid requote; cancel when allowed; view proof/receipt.
- **Required states:** All lifecycle states; proof processing; return; incident; payment failure.
- **Authoritative source:** Spec §§8, 11–12, 16
- **Mandatory correction/constraint:** Merchant cannot assign, mark picked up/delivered, issue delivery refunds, or mutate arbitrary state.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-007_delivery-detail.png`

#### MER-008 — Customers list

- **Route/state:** `/business/customers`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Manage recipient records, saved destinations, delivery history, payer preference, and repeat delivery.
- **Allowed actions:** Search; filter; create; open; repeat delivery; edit contact/address.
- **Required states:** Empty; active; archived; duplicate warning.
- **Authoritative source:** Spec §§4–5, 16
- **Mandatory correction/constraint:** Do not expose payment credentials or unnecessary PII in list view.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-008_customers-list.png`

#### MER-009 — Customer detail

- **Route/state:** `/business/customers?customer=[id]`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Show one customer’s addresses, instructions, history, payer preference, and repeat-delivery action.
- **Allowed actions:** Create repeat delivery; edit address/instructions; message through delivery context.
- **Required states:** No deliveries; active delivery; conflicting address; archived.
- **Authoritative source:** Spec §§5, 7, 12
- **Mandatory correction/constraint:** Customer notes are merchant-scoped. Do not imply Couranr owns the customer relationship.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-009_customer-detail.png`

#### MER-010 — Presets list

- **Route/state:** `/business/presets`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Manage Couranr-recommended, merchant-customized, and merchant-created delivery presets.
- **Allowed actions:** Create; edit; duplicate; archive; review recommendation; view usage.
- **Required states:** Global recommendation; customized; merchant-created; update suggested; archived.
- **Authoritative source:** Spec §5
- **Mandatory correction/constraint:** Global updates never overwrite merchant customization. Every delivery stores immutable preset snapshot.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-010_presets-list.png`

#### MER-011 — Preset builder

- **Route/state:** `/business/presets?edit=[id]`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Define item assumptions, required questions, handling, proof, vehicle capabilities, and payer default.
- **Allowed actions:** Edit; version; add required question; save; duplicate.
- **Required states:** New; edited; version conflict; recommendation available.
- **Authoritative source:** Spec §5
- **Mandatory correction/constraint:** Never silently assert exact weight, dimensions, value, final vehicle, price, loading, or safety.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-011_preset-builder.png`

#### MER-012 — Merchant messages and support

- **Route/state:** `/business/messages`
- **Tier / phase:** Core / Phase 8–9
- **Purpose:** Centralize merchant–driver delivery chat and merchant–Couranr Support conversations.
- **Allowed actions:** Open thread; send message/attachment; choose issue category; view 15-minute target; accept verified assistant reply.
- **Required states:** Unread; response pending; AI answered; human review; after-hours; closed.
- **Authoritative source:** Spec §12, AI spec §§Communication, Assistant
- **Mandatory correction/constraint:** No public phone. Messages never directly mutate address, price, cancellation, refund, return, proof, or state.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-012_merchant-messages-and-support.png`

#### MER-013 — Website tools

- **Route/state:** `/business/website-tools`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Create merchant delivery link, QR code, embed/button tools, branding, and customer request defaults.
- **Allowed actions:** Copy link; download QR; configure form/button; preview; publish.
- **Required states:** Draft; published; invalid embed settings; disabled.
- **Authoritative source:** Spec §§7, 16
- **Mandatory correction/constraint:** Do not turn Couranr into the merchant’s product checkout. Customer request still requires merchant validation.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-013_website-tools.png`

#### MER-014 — Merchant settings

- **Route/state:** `/business/settings`
- **Tier / phase:** Core / Phase 4–8
- **Purpose:** Manage business profile, pickup defaults, categories, payer defaults, notifications, security, and delivery policies.
- **Allowed actions:** Edit business; update defaults; manage policies; configure operational notifications.
- **Required states:** Saved; unsaved; verification required; permission denied.
- **Authoritative source:** Spec §§3, 5, 12, 16
- **Mandatory correction/constraint:** Locked policy registry wins over any mock values. No subscription controls in pilot.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-014_merchant-settings.png`

#### MER-015 — Team and permissions

- **Route/state:** `/business/settings/team`
- **Tier / phase:** Core / Phase 4
- **Purpose:** Invite staff and manage owner, manager/dispatcher, billing, counter-staff, and view-only access.
- **Allowed actions:** Invite; resend; change role; disable/remove; review activity.
- **Required states:** Pending invitation; active; disabled; last-owner protection.
- **Authoritative source:** Spec §§8, 14, 16
- **Mandatory correction/constraint:** Use least privilege and tenant isolation. Driver access is assignment-scoped.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-015_team-and-permissions.png`

#### MER-016 — Billing settings

- **Route/state:** `/business/settings/billing`
- **Tier / phase:** Core / Phase 6
- **Purpose:** Manage merchant payment methods, delivery receipts, charges, credits, refunds, and invoices/records.
- **Allowed actions:** Add/update payment method; view delivery charge; download receipt; open support case.
- **Required states:** No method; default method; payment failed; refund pending/complete.
- **Authoritative source:** Spec §§7, 10, 16
- **Mandatory correction/constraint:** No monthly subscription invoice during pilot. Separate delivery charge from product sale.
- **Canonical visual:** `canonical-mvp-images/merchant/MER-016_billing-settings.png`

### Driver contracts

#### DRV-001 — Driver dashboard

- **Route/state:** `/driver`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Show assigned/current delivery, upcoming work, availability, messages, and safe quick actions.
- **Allowed actions:** Open assigned delivery; go online/offline; open messages; view vehicle.
- **Required states:** Online; offline; current delivery; no assignment; blocking compliance issue.
- **Authoritative source:** Spec §§8–9, 11, 16
- **Mandatory correction/constraint:** No public driver marketplace or self-selected offers in MVP. Couranr assigns work.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-001_driver-dashboard.png`

#### DRV-002 — Assigned delivery detail

- **Route/state:** `/driver/deliveries/[id]`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Present sanitized assigned-delivery data and valid next commands.
- **Allowed actions:** Start route; arrive; open merchant chat; report issue; capture proof.
- **Required states:** Assigned; en route; at pickup; picked up; in transit; at drop-off; return.
- **Authoritative source:** Spec §§8, 11–12, 16
- **Mandatory correction/constraint:** Only assigned driver can access. Show minimum necessary recipient and merchant data.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-002_assigned-delivery-detail.png`

#### DRV-003 — Pickup PIN and proof

- **Route/state:** `/driver/deliveries/[id]?step=pickup-proof`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Verify merchant handoff, package count, condition, and actual vehicle before custody.
- **Allowed actions:** Enter pickup PIN; capture shipment/condition photos; confirm count; record staff identity.
- **Required states:** Pending; invalid PIN; discrepancy; offline saved; verified.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** Large/unusual shipment asks dimensions, securement, loading participants/equipment, and existing damage.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-003_pickup-pin-and-proof.png`

#### DRV-004 — Package discrepancy

- **Route/state:** `/driver/deliveries/[id]?step=discrepancy`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Pause pickup and collect evidence when the package differs materially from the request.
- **Allowed actions:** Choose reason; capture photos; add notes; submit to Operations; message support.
- **Required states:** Draft; awaiting Couranr review; requote; safe to continue; cancelled.
- **Authoritative source:** Spec §§6, 11
- **Mandatory correction/constraint:** Driver cannot approve price, vehicle change, or unsafe continuation.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-004_package-discrepancy.png`

#### DRV-005 — Driving Mode

- **Route/state:** `/driver/deliveries/[id]?mode=driving`
- **Tier / phase:** Core / Phase 7–9
- **Purpose:** Provide safe navigation and minimal delivery controls while suppressing routine distractions.
- **Allowed actions:** Navigate; mark arrived; report blocking issue; safe-stop support summary.
- **Required states:** Driving; rerouting; offline; safety alert; arrived.
- **Authoritative source:** AI spec §Driving Mode
- **Mandatory correction/constraint:** No routine alert sounds, repeated vibration, or typing prompts while moving.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-005_driving-mode.png`

#### DRV-006 — Drop-off proof

- **Route/state:** `/driver/deliveries/[id]?step=delivery-proof`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Capture recipient PIN/signature or authorized leave-at-door evidence.
- **Allowed actions:** Choose allowed handoff; enter PIN/signature; photo; complete delivery.
- **Required states:** Direct handoff; signature; leave at door; failed attempt; return required; offline pending sync.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** No face or ID-document photo. Leave at door requires prior authorization and safe conditions.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-006_drop-off-proof.png`

#### DRV-007 — Offline proof sync

- **Route/state:** `/driver/deliveries/[id]?panel=offline-sync`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Safely queue encrypted proof when connectivity fails and reconcile it later.
- **Allowed actions:** View pending proof; retry; sync; inspect error.
- **Required states:** Offline; pending sync; retrying; verified; permanently failed/Operations alert.
- **Authoritative source:** Spec §11, acceptance §Operations/driver/proof
- **Mandatory correction/constraint:** Do not finalize settlement until required proof is uploaded and verified.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-007_offline-proof-sync.png`

#### DRV-008 — Driver messages

- **Route/state:** `/driver/messages`
- **Tier / phase:** Core / Phase 8–9
- **Purpose:** Show delivery-specific merchant messages and Couranr Support conversations.
- **Allowed actions:** Reply; attach allowed evidence; open delivery context; safe-stop summary.
- **Required states:** Unread; driving suppressed; AI draft; human support; closed.
- **Authoritative source:** Spec §12, AI spec §§Communication, Driving Mode
- **Mandatory correction/constraint:** No unrestricted customer chat and no personal phone exposure.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-008_driver-messages.png`

#### DRV-009 — Driver availability

- **Route/state:** `/driver/availability`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Manage active status and operating availability for Couranr-managed assignments.
- **Allowed actions:** Go online/offline; set hours; select active vehicle; update availability.
- **Required states:** Online; busy; offline; unavailable due to compliance.
- **Authoritative source:** Spec §§3, 9, 16
- **Mandatory correction/constraint:** Availability does not create a public offer marketplace or guarantee assignments.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-009_driver-availability.png`

#### DRV-010 — Vehicle profile

- **Route/state:** `/driver/vehicle`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Maintain cargo dimensions, payload, enclosed/open status, equipment, weather protection, and availability.
- **Allowed actions:** Edit vehicle; upload evidence; activate/deactivate; update inspection/insurance.
- **Required states:** Active; unavailable; maintenance; verification pending; expired compliance.
- **Authoritative source:** Spec §9, §14
- **Mandatory correction/constraint:** Capability data, not rigid labels, controls matching. Operations chooses final vehicle.
- **Canonical visual:** `canonical-mvp-images/driver/DRV-010_vehicle-profile.png`

### Operations contracts

#### OPS-001 — Operations dashboard

- **Route/state:** `/operations`
- **Tier / phase:** Core / Phase 7–10
- **Purpose:** Show live delivery health, pending reviews, support SLA, payment risk, Ghost flags, and quick actions.
- **Allowed actions:** Open queue; review high-priority item; message parties; pause requests/AI.
- **Required states:** Normal; high load; payment incident; proof incident; AI paused.
- **Authoritative source:** Spec §§9, 12–13, 16–18
- **Mandatory correction/constraint:** Use verified live metrics only. No fake revenue or SLA statistics.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-001_operations-dashboard.png`

#### OPS-002 — Queue and managed dispatch

- **Route/state:** `/operations/queue and /operations/deliveries`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Review requests and select compatible vehicle, driver, schedule, and action.
- **Allowed actions:** Confirm as quoted; select vehicle; assign driver; change schedule; request info; requote; cannot confirm.
- **Required states:** Pending review; missing info; authorized; requote; assigned; declined.
- **Authoritative source:** Spec §§8–10, 16
- **Mandatory correction/constraint:** Assignment method is couranr_managed. Store recommendation, selected vehicle, and override reason.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-002_queue-and-managed-dispatch.png`

#### OPS-003 — Delivery review workspace

- **Route/state:** `/operations/deliveries/[id]`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Inspect request, quote, payer, readiness, vehicle fit, risk, proof, conversation, and economics.
- **Allowed actions:** Confirm; request info; schedule; select vehicle; assign; requote; apply credit; decline.
- **Required states:** Review pending; accepted; requoted; declined; active delivery; exception.
- **Authoritative source:** Spec §§8–11, 16
- **Mandatory correction/constraint:** No client-authoritative state mutation. All actions are named server commands with audit.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-003_delivery-review-workspace.png`

#### OPS-004 — Requote and promotional credit

- **Route/state:** `/operations/deliveries/[id]?panel=requote`
- **Tier / phase:** Core / Phase 6–7
- **Purpose:** Create an immutable replacement quote with reason and optional Couranr promotional credit.
- **Allowed actions:** Edit allowed line items; choose reason; apply credit; preview; send for payer approval.
- **Required states:** Draft; approval pending; accepted; expired; declined; replaced authorization.
- **Authoritative source:** Spec §§4, 7, 10
- **Mandatory correction/constraint:** Never overwrite original quote. Credit is separate expense and requires reason, campaign, market, category, approver.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-004_requote-and-promotional-credit.png`

#### OPS-005 — Operations messages and support inbox

- **Route/state:** `/operations/messages and /operations/support`
- **Tier / phase:** Core / Phase 8–9
- **Purpose:** Unify merchant, driver, and customer-help conversations with delivery context and priority.
- **Allowed actions:** Reply; assign; request evidence; open delivery; use/edit AI draft; resolve.
- **Required states:** Unread; urgent; active delivery; waiting on party; AI draft; escalated; closed.
- **Authoritative source:** Spec §12, AI spec §§Communication, Assistant
- **Mandatory correction/constraint:** Internal notes and AI drafts must be excluded from participant queries, exports, realtime, and notifications.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-005_operations-messages-and-support-inbox.png`

#### OPS-006 — Couranr Ghost Operations

- **Route/state:** `/operations/ghost`
- **Tier / phase:** Core / Phase 9
- **Purpose:** Summarize operations, verify facts, draft replies/actions, and surface risk while Couranr is on delivery.
- **Allowed actions:** Ask global/case question; view evidence; use/edit reply; prepare requote/refund/schedule/return recommendation.
- **Required states:** Verified recommendation; missing evidence; conflict; human required; AI/provider paused.
- **Authoritative source:** Spec §13, AI spec §Ghost Operations
- **Mandatory correction/constraint:** Ghost has read and preparation tools only—no direct execution, SQL, financial, address, state, refund, return, or safety mutation.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-006_couranr-ghost-operations.png`

#### OPS-007 — Merchant management

- **Route/state:** `/operations/merchants`
- **Tier / phase:** Core / Phase 4–9
- **Purpose:** Review merchant activation, contact, categories, presets, support, performance, and risk.
- **Allowed actions:** Open account; message; review activation; pause account with reason; inspect audit.
- **Required states:** Test workspace; active; needs review; paused; incomplete.
- **Authoritative source:** Spec §§5, 12–14, 16
- **Mandatory correction/constraint:** No fabricated merchant performance. Account pause must be reasoned and audited.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-007_merchant-management.png`

#### OPS-008 — Vehicle management

- **Route/state:** `/operations/vehicles`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Maintain all Couranr-operated and future driver vehicles, capabilities, compliance, and active assignments.
- **Allowed actions:** Add/edit; assign driver; mark maintenance/unavailable; inspect capability.
- **Required states:** Available; assigned; maintenance; compliance warning; out of service.
- **Authoritative source:** Spec §9, §16
- **Mandatory correction/constraint:** Do not imply current fleet size or external drivers unless real.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-008_vehicle-management.png`

#### OPS-009 — Payments and reconciliation

- **Route/state:** `/operations/payments`
- **Tier / phase:** Core / Phase 6
- **Purpose:** Monitor authorizations, captures, refunds, Stripe reconciliation, settlements, ledger balance, and alerts.
- **Allowed actions:** Open payment; reconcile; replay safe event; export; open Stripe.
- **Required states:** Balanced; unreconciled; webhook delayed; capture pending; refund pending; failed.
- **Authoritative source:** Spec §10, acceptance §Payments/ledger
- **Mandatory correction/constraint:** Authorization is not revenue. Every captured/refund transaction must balance and reconcile.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-009_payments-and-reconciliation.png`

#### OPS-010 — Payment authorization review

- **Route/state:** `/operations/payments?tab=authorizations`
- **Tier / phase:** Core / Phase 6
- **Purpose:** Review capturable funds, quote linkage, payer, expiry, risk, and capture/release actions.
- **Allowed actions:** Capture after confirmation; release; request new method; open support case.
- **Required states:** Authorized; capture pending; captured; expired; failed; requires action.
- **Authoritative source:** Spec §§7, 10
- **Mandatory correction/constraint:** Capture only after Couranr confirms. Commands must be idempotent.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-010_payment-authorization-review.png`

#### OPS-011 — Refund management

- **Route/state:** `/operations/refunds`
- **Tier / phase:** Core / Phase 6–7
- **Purpose:** Review delivery-charge refund requests with evidence, policy, Stripe, and ledger effects.
- **Allowed actions:** Approve full/partial; deny; message merchant/customer; view incident.
- **Required states:** Pending; approved; processing; partially refunded; refunded; denied; failed.
- **Authoritative source:** Spec §§10–11
- **Mandatory correction/constraint:** Merchant controls product refund; Couranr controls delivery-service refund. No on-time guarantee policy.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-011_refund-management.png`

#### OPS-012 — Incidents and claims

- **Route/state:** `/operations/incidents`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Investigate damage, missing, wrong item, unsafe handling, delivery failure, and evidence.
- **Allowed actions:** Start review; request evidence; add internal note; escalate; resolve.
- **Required states:** Reported; under review; awaiting evidence; resolved; closed.
- **Authoritative source:** Spec §§8, 11
- **Mandatory correction/constraint:** Do not promise automatic product-value compensation. Separate merchandise responsibility from delivery incident.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-012_incidents-and-claims.png`

#### OPS-013 — Operations analytics

- **Route/state:** `/operations/analytics`
- **Tier / phase:** Core / Phase 10
- **Purpose:** Measure paid deliveries, markets, categories, payer mix, economics, support, proof, and driver utilization.
- **Allowed actions:** Filter; drill down; export privacy-safe aggregates.
- **Required states:** Loading; partial data; empty; live.
- **Authoritative source:** Spec §17, acceptance §Analytics/observability
- **Mandatory correction/constraint:** No message bodies, full addresses, gate codes, phone numbers, proof URLs, or card data in analytics.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-013_operations-analytics.png`

#### OPS-014 — Unmet demand analytics

- **Route/state:** `/operations/analytics?tab=unmet-demand`
- **Tier / phase:** MVP-complete / Phase 10
- **Purpose:** Analyze requests Couranr could not confirm by market, reason, category, time, distance, and vehicle need.
- **Allowed actions:** Filter; review opportunity; open underlying requests.
- **Required states:** No data; increasing demand; partial attribution.
- **Authoritative source:** Spec §17
- **Mandatory correction/constraint:** Use actual could-not-confirm reasons; do not treat all unfulfilled requests as lost customers.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-014_unmet-demand-analytics.png`

#### OPS-015 — Operations settings

- **Route/state:** `/operations/settings`
- **Tier / phase:** Core / Phase 3, 8–9
- **Purpose:** Configure roles, proof, notifications, pricing governance, AI controls, integrations, security, and retention.
- **Allowed actions:** Edit approved settings; save; inspect permission/audit.
- **Required states:** Saved; unsaved; permission denied; policy version conflict.
- **Authoritative source:** Spec §§4, 12–14, 16
- **Mandatory correction/constraint:** No mock value overrides the Decision Registry. Sensitive changes require high privilege and audit.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-015_operations-settings.png`

#### OPS-016 — Availability controls

- **Route/state:** `/operations/settings?tab=availability`
- **Tier / phase:** Core / Phase 3, 7
- **Purpose:** Control service levels, hours, cutoff, overnight, weather-limited mode, market availability, and closures.
- **Allowed actions:** Enable/disable modes; change closures; publish availability.
- **Required states:** Standard; scheduled only; temporarily closed; weather limited; overnight enabled.
- **Authoritative source:** Spec §3
- **Mandatory correction/constraint:** MVP hours are Mon–Fri 6 AM–6 PM, same-day cutoff 4 PM. Do not use weekend/mock hours.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-016_availability-controls.png`

#### OPS-017 — Policy and pricing registry

- **Route/state:** `/operations/settings?tab=policies`
- **Tier / phase:** MVP-complete / Phase 3
- **Purpose:** View versioned deterministic pricing and policy rules with effective dates and audit.
- **Allowed actions:** Draft version; validate; publish with approval; view history.
- **Required states:** Draft; scheduled; active; superseded; validation failed.
- **Authoritative source:** Spec §§3–4, decision registry
- **Mandatory correction/constraint:** UI edits must produce versioned server-side policy data; no second pricing engine.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-017_policy-and-pricing-registry.png`

#### OPS-018 — Notification template manager

- **Route/state:** `/operations/settings?tab=notifications`
- **Tier / phase:** MVP-complete / Phase 8
- **Purpose:** Manage approved, versioned operational templates by audience, channel, language, and event.
- **Allowed actions:** Preview; edit; validate variables; activate version; test send.
- **Required states:** Draft; active; deprecated; invalid variables; suppressed.
- **Authoritative source:** Spec §12
- **Mandatory correction/constraint:** AI cannot change price, time promise, refund, fee, payment, safety, legal, or state language.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-018_notification-template-manager.png`

#### OPS-019 — Ghost auto-reply controls and kill switches

- **Route/state:** `/operations/settings?tab=ai`
- **Tier / phase:** Core / Phase 9
- **Purpose:** Control safe auto-replies by category, merchant, conversation, provider, and global state.
- **Allowed actions:** Pause/resume; set deterministic gates; inspect correction rate; open decision audit.
- **Required states:** Active; draft-only; globally paused; category paused; provider degraded; automatic safety pause.
- **Authoritative source:** AI spec §§Assistant, Kill switches
- **Mandatory correction/constraint:** Auto-send requires at least 95% final confidence, exact verified facts, policy, verifier, tenant scope, and allowed category.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-019_ghost-auto-reply-controls-and-kill-switches.png`

#### OPS-020 — Activity and audit log

- **Route/state:** `/operations/settings?tab=audit`
- **Tier / phase:** Core / Phase 2–9
- **Purpose:** Inspect state commands, policy versions, AI decisions, data access, payment events, and overrides.
- **Allowed actions:** Filter; inspect event; export permitted audit; link to entity.
- **Required states:** Normal; security alert; missing evidence; immutable record.
- **Authoritative source:** Spec §§8, 13–14
- **Mandatory correction/constraint:** Append-only; no edit/delete. Redact secrets and unnecessary PII.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-020_activity-and-audit-log.png`

#### OPS-021 — Ask Couranr lead inbox

- **Route/state:** `/operations/ghost?tab=leads`
- **Tier / phase:** MVP-complete / Phase 9–10
- **Purpose:** Review consented public-assistant leads, market/category fit, questions, and attribution.
- **Allowed actions:** Open summary; respond in app/email when consented; create merchant signup follow-up; mark outcome.
- **Required states:** New; qualified; contacted; converted; closed; no consent.
- **Authoritative source:** AI spec §Ask Couranr, Spec §17
- **Mandatory correction/constraint:** No private customer/delivery lookup. Track consent and UTM/source. No phone-first support flow.
- **Canonical visual:** `canonical-mvp-images/operations/OPS-021_ask-couranr-lead-inbox.png`

### Customer contracts

#### CUS-001 — Address-change request

- **Route/state:** `/help/[token]#address-change`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Collect a proposed address change without directly mutating the active delivery.
- **Allowed actions:** Submit corrected address; explain reason; approve resulting revised quote when required.
- **Required states:** Before authorization; after authorization; after confirmation; after pickup; approved; denied.
- **Authoritative source:** Spec §§8, 11–12
- **Mandatory correction/constraint:** Request creates Operations review. After pickup, driver stops safely and Operations decides reprice/return.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-001_address-change-request.png`

#### CUS-002 — Cancellation and return request

- **Route/state:** `/help/[token]#cancellation-return`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Explain applicable stage-based cancellation or return and submit a reviewed request.
- **Allowed actions:** Choose reason; review fee estimate; submit; message support.
- **Required states:** Pre-authorization; pre-confirmation; confirmed; arrived; after pickup; return in progress.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** No unlimited free redelivery. Fees follow locked stage rules and are not decided by chat.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-002_cancellation-and-return-request.png`

#### CUS-003 — Recipient unavailable resolution

- **Route/state:** `/help/[token]#recipient-unavailable`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Offer allowed handoff or return choices when recipient contact fails.
- **Allowed actions:** Confirm safe leave-at-door if already permitted; provide access detail; request return/reschedule.
- **Required states:** Driver arrived; contact attempts; waiting; leave at door allowed; return required.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** Leave at door only with prior authorization and safe/weather-suitable location.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-003_recipient-unavailable-resolution.png`

#### CUS-004 — Delivery problem report

- **Route/state:** `/help/[token]#delivery-problem`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Report damaged, missing, wrong, or undelivered items with structured evidence.
- **Allowed actions:** Choose problem; attach photos; add details; submit; view case status.
- **Required states:** Draft; reported; awaiting evidence; under review; resolved.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** Do not promise automatic product refund or compensation. Merchant remains responsible for merchandise.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-004_delivery-problem-report.png`

#### CUS-005 — Revised quote approval

- **Route/state:** `/pay/[token]?mode=requote`
- **Tier / phase:** Core / Phase 6–7
- **Purpose:** Compare original and revised delivery-only quote and obtain payer approval before replacing authorization.
- **Allowed actions:** Approve; decline; view reason; contact support.
- **Required states:** Pending; accepted; declined; expired; payment action required.
- **Authoritative source:** Spec §§7, 10
- **Mandatory correction/constraint:** Remove 24/7 support, on-time guarantee, and any product-total content. Show exact reason and immutable versions.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-005_revised-quote-approval.png`

#### CUS-006 — Proof-of-delivery viewer

- **Route/state:** `/track/[token]#proof`
- **Tier / phase:** Core / Phase 7
- **Purpose:** Show authorized delivery proof, timestamps, handoff method, and timeline.
- **Allowed actions:** View full image; download/share when policy permits; open help.
- **Required states:** Proof processing; verified; unavailable; revoked token.
- **Authoritative source:** Spec §11
- **Mandatory correction/constraint:** Private storage and purpose-scoped token. No face/ID document requirement and no driver phone call button.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-006_proof-of-delivery-viewer.png`

#### CUS-007 — Return and refund status

- **Route/state:** `/help/[token]#return-status`
- **Tier / phase:** Core / Phase 6–8
- **Purpose:** Explain return custody, inspection/status, delivery-charge refund status, and expected payment processing.
- **Allowed actions:** View timeline; message support; view receipt.
- **Required states:** Return required; returning; returned; refund pending; refunded; denied.
- **Authoritative source:** Spec §§10–11
- **Mandatory correction/constraint:** No buyer-protection or product-refund promise. Show only Couranr delivery-service financial status.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-007_return-and-refund-status.png`

#### CUS-008 — Delivery preferences and access instructions

- **Route/state:** `/track/[token]#access`
- **Tier / phase:** Core / Phase 7–8
- **Purpose:** Confirm address, access, allowed handoff, leave-at-door authorization, and delivery window.
- **Allowed actions:** Edit allowed instructions; choose handoff; save.
- **Required states:** Editable before lock; locked after pickup; unsafe option disabled; saved.
- **Authoritative source:** Spec §§8, 11–12
- **Mandatory correction/constraint:** No 24/7 support claim. Gate codes and sensitive instructions must be protected and shown only to assigned driver/Couranr.
- **Canonical visual:** `canonical-mvp-images/customer/CUS-008_delivery-preferences-and-access-instructions.png`

## 6. Required UI states for every applicable screen

- Loading skeleton that preserves page structure and does not flash unauthorized data.
- Empty state with one clear next action and no fake sample metrics.
- Inline validation with field-level recovery; never rely only on toast notifications.
- Permission denied and tenant mismatch states that reveal no existence or private details.
- Network failure and retry; driver proof workflows also require offline-safe queued state.
- Concurrent-update/version-conflict state for requests, quotes, presets, policies, and settings.
- Action pending, success, reversible confirmation, and destructive confirmation with consequence text.
- Payment states: requires action, authorized, capture pending, captured, failed, cancelled, partially refunded, refunded.
- Proof states: pending capture, pending sync, verified, failed, unavailable to viewer.
- AI states: analyzing, verified answer, draft only, human required, missing/conflicting evidence, provider paused, global kill switch.
- After-hours support state and urgent safety escalation without exposing a personal number.

## 7. Responsive and accessibility requirements

- Marketing and customer-token flows are mobile-first. Driver surfaces are mobile primary. Merchant and Operations are desktop primary but must remain usable on tablet.
- Merchant mobile launch requirement: dashboard, create delivery, review, delivery detail, messages, readiness, and payer link controls.
- Operations mobile is not a full dashboard requirement for launch; it needs safe read-only alerts and emergency pause only if implemented.
- Use WCAG 2.2 AA contrast, visible focus, keyboard navigation, semantic landmarks, accessible names, reduced-motion support, and non-color status cues.
- Maps must have list/text alternatives. Charts must have accessible summaries and tables.
- Never place sensitive access instructions, full phone numbers, payment details, or proof URLs in lock-screen notification copy.

## 8. Implementation order

1. Phase 0 repository inventory and preservation checkpoint. No UI rewrite before this report.
2. Global shell, canonical logo, design tokens, role-aware navigation, auth, and route containment.
3. Merchant onboarding, activation, customers, presets, and test workspace.
4. Smart Intake, request draft, review, deterministic quote, and both payer flows.
5. Operations review/dispatch, vehicle selection, assignment, payment capture, and ledger reconciliation.
6. Driver execution, pickup proof, delivery proof, offline sync, tracking, and receipts.
7. Exceptions: waiting, merchant not ready, recipient unavailable, address change, cancellation, return, damage, and weather.
8. In-app messages, Delivery Help, response timers, notification templates, and privacy boundaries.
9. Couranr Assistant, Ghost drafts, verifier, audit, kill switches; auto-replies may remain disabled.
10. Marketing routes, Ask Couranr, attribution, analytics, observability, backups, acceptance matrix, and controlled production canary.

## 9. Deferred and noncanonical visual inventory

| Source image | Concept | Disposition |
|---|---|---|
| `bulk_deliveries_dashboard.png` | Bulk delivery upload/batch management | Post-MVP; Route Saver covers launch multi-stop need. |
| `couranr_api_integrations_dashboard.png` | Public API/integrations console | Post-MVP; no target MVP route. |
| `reports_export_dashboard.png` | Merchant report builder | Post-MVP; MVP analytics can be Operations-first. |
| `sla_coverage_dashboard.png` | Merchant SLA coverage dashboard | Post-MVP; no SLA guarantees at launch. |
| `availability_schedule_dashboard.png` | Advanced merchant capacity/surge schedule | Post-MVP; use locked Operations availability controls. |
| `branded_tracking_page_dashboard.png` | Advanced branded tracking customizer | Post-MVP; basic branding may live inside Website Tools. |
| `automations_dashboard_overview.png` | Merchant automation builder | Post-MVP; operational notifications are system-defined at MVP. |
| `subscription_plan_dashboard_ui.png` | Subscription plan management | Rejected for pilot; no monthly fee. |
| `driver_incentives_dashboard_ui.png` | Driver incentives/rewards | Post-MVP. |
| `earnings_and_payouts_dashboard.png` | Driver payout dashboard | Post-MVP while Couranr directly operates pilot deliveries. |
| `driver_performance_dashboard.png` | Driver leaderboard/coaching | Post-MVP; avoid premature gamification. |
| `driver_availability_shift_planner.png` | Advanced shift calendar | Post-MVP; use DRV-009 simple availability. |
| `address_book_locations_dashboard.png` | Standalone merchant address book | Post-MVP as separate route; basic addresses remain in Customers/Settings. |
| `notifications_center_dashboard.png` | Customer account notification center | Post-MVP; customer account not required. |
| `notification_center_dashboard.png` | Merchant notification center duplicate | Reference only; messages/dashboard cover launch. |
| `company_settings_dashboard.png` | Duplicate merchant settings exploration | Reference only; MER-014 is canonical. |
| `billing_and_invoice_dashboard.png` | Duplicate billing exploration | Reference only; MER-016 is canonical. |
| `website_tools_dashboard_ui.png` | Duplicate Website Tools exploration | Reference only; MER-013 is canonical. |
| `team_management_dashboard_for_petal_stem.png` | Duplicate team management exploration | Reference only; MER-015 is canonical. |

All collage/contact-sheet files, generic `imagegen.png` files, oddly titled duplicates, and prior visual explorations are noncanonical unless explicitly mapped in the registry above.

## 10. UI completion definition

- Every Core route/state above exists and is role/tenant protected.
- Every action calls a named server command; no browser sends arbitrary target status or writes privileged tables directly.
- Every screen implements its required loading, empty, error, offline, conflict, and permission states.
- All canonical copy conflicts are corrected to the Decision Registry and Master Specification.
- Both payer flows, proof, return, address change, messaging, and Ghost isolation pass the acceptance matrix.
- No noncanonical/post-MVP screen is exposed in navigation or active runtime.
- The controlled production canary passes with Stripe, ledger, proof, analytics, support, and Ghost evidence.
