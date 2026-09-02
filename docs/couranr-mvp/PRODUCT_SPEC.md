# Couranr — product specification

**AUTHORITY** for narrative product doctrine: workflows, actor responsibilities,
permissions, lifecycle behaviour and boundaries that are not cleanly expressible
as an atomic decision record.

`02_DECISION_REGISTRY.json` overrides this document wherever a later explicit
decision amends it. `ui_screen_registry.json` owns screens and routes;
`VISUAL_REGISTRY.json` owns visual sources and composition; the two ledgers own
implementation state. See
[`authority/AUTHORITY_MANIFEST.json`](./authority/AUTHORITY_MANIFEST.json).

## Couranr Pricing Authority V2 amendments — 2026-09-01

These decisions amend the preserved historical pricing doctrine below, which
described a $22.99 fare covering the first three loaded miles. Their atomic
forms are PRC-005, MIL-003, MIL-004, SUR-003, SUR-004, REF-003, TRF-001 and
ECO-001 in `02_DECISION_REGISTRY.json`.

**Historical quotes are immutable.** Every quote already minted keeps its own
`pricing_policy_version` and its own stored line items, and is read back from
those stored facts. Today's engine is never re-run to reconstruct yesterday's
price.

- **One universal customer engine.** Couranr Business merchant-paid, Couranr
  Business customer-paid and future consumer Couranr Same Day price identically.
  Merchant vertical or category does not change the base fare or the mileage
  rate — a restaurant, a bakery, a florist and a hardware store pay the same
  core fare for the same physical shipment. Vertical may shape Smart Intake
  presets later; it never touches the core delivery price.
- **Standard fare.** $7.99 covers the first 2.000 loaded miles. Above that:
  $1.25 per loaded mile over 2 through 10, $1.50 over 10 through 25. Above 25
  loaded miles there is no automatic final price. Distance is the
  server-authoritative Google route distance at thousandth-of-a-mile precision;
  browser mileage is never accepted and mileage is never rounded up to a whole
  mile. Money is integer cents with deterministic half-up rounding only where a
  rate produces a fractional cent. The nearest-$0.25 rounding rule is retired.
- **Weight.** Included through 25 lb; $3.00 over 25 through 50 lb; above 50 lb
  is a Large Item requiring a manual quote. A band is a charge, never a claimed
  weight, and never a statement that a vehicle is available.
- **Service and options.** Priority +$5.00, Rush +$10.00, Overnight +$30.00
  request-only and Couranr-confirmed, Signature +$3.00, photo/PIN proof
  included. Rush and Overnight never stack. There is no platform fee, no
  consumer surcharge, no payer differential, no category multiplier and no
  payment-processing surcharge passed to the payer.
- **Predicted traffic.** Priced up front from one canonical Google route
  response carrying both the traffic-aware and static durations:
  `delay = max(traffic_aware − static, 0)`. The first 5 minutes are included,
  then $0.45 per minute; above 25 minutes the route needs review. If that
  evidence cannot be obtained or validated, the request fails safe into review
  rather than assuming no traffic. Once a payer accepts and authorizes a quote,
  later real-world traffic never changes it. There is no post-delivery traffic
  meter, no surge, no weather or event multiplier and no fixed evening
  surcharge.
- **Quote stability.** An unaccepted immediate quote is valid for 15 minutes,
  after which it is rerouted and recalculated before acceptance. A material
  price-driving change — pickup, destination, route, weight band, service level,
  requested timing that changes the route or traffic calculation, signature, or
  an explicit Operations requote — requires a fresh immutable Quote Version.
  Quote N is never mutated.
- **Base service definition.** The $7.99 base means one pickup, one destination,
  a package ready for pickup, an ordinary handoff, 25 lb or less, ordinary
  approved-vehicle capability and the first 2 loaded miles. It is not charged by
  item count. Assembly, installation, setup or breakdown, heavy stair work,
  substantial loading labour, special equipment, anything over 50 lb, and
  special vehicle requirements are not silently inside that lane.
- **Waiting.** The first 10 accumulated minutes per delivery are included.
  Waiting begins only after the driver has recorded arrival and the handoff is
  not ready. After that: $0.75 per minute on a standard vehicle, $1.00 per
  minute on a rented van or truck, with partial minutes not rounded up. At 30
  total waiting minutes automatic continuation ends and Operations decides.
  **Governed authority only** — no fulfillment or payment path assesses it yet,
  and none is invented here.
- **Cancellation and failed pickup.** $0 before Couranr confirmation or driver
  commitment; $8 after confirmation but before arrival; $15 once the driver has
  arrived and pickup cannot occur; $0 whenever Couranr caused it. **Governed
  authority only**, on the same basis as waiting.
- **Returns.** A physical return is priced as a NEW physical route under this
  policy, from the failed or current location to the return destination. The
  "70% of the original charge, $14.99 minimum" rule is retired. If Couranr
  caused the failure requiring the corrective return, the payer owes nothing.
- **Tolls, parking, tax, tip, promotions.** Tolls and parking are actual
  documented cost with no markup, as a separate operational line. Tax is
  separate from the delivery subtotal and no taxability rule is invented here.
  Tips are separate and 100% to the driver, never Couranr revenue. A promotion
  never overwrites or mutates the standard quote: standard revenue, the
  promotional credit with its reason, campaign and approver, and the amount
  actually paid are preserved separately.
- **Route Saver.** The "$16.99 per stop" public starting price is retired.
  Route Saver stays a deferred future capability with no advertised price until
  the Route Run aggregate and its economics exist. No replacement price is
  invented now.
- **Internal economics are separate from customer pricing.** Customer route
  pricing uses loaded route distance only; driver approach and deadhead mileage
  are never added to customer loaded mileage. Contribution reporting targets
  roughly 20–25% contribution margin on ordinary completed deliveries before
  company-level overhead, and below 20% is an internal Operations warning. It
  must never change a customer price, mutate an accepted quote, create a hidden
  multiplier, or automatically reject a request. Where the required cost inputs
  are missing, contribution is UNKNOWN and profitability is never fabricated.

## Foundation Gate A amendments — 2026-08-31

These decisions amend the preserved historical doctrine below. Their atomic
forms are FND-001 through FND-007 in `02_DECISION_REGISTRY.json`.

The canonical foundation lifecycle is:

Future Intake → Request → immutable Quote Version → Payment Obligation and
Service Plan → Delivery → future Route aggregation.

- A requester is `business` or `consumer`. Business requests retain business
  tenancy and membership authorization. A consumer request has no fake business
  account, may have no authenticated creator, and stores an immutable request-
  time name/phone/email contact snapshot. Submission requires a usable phone or
  email.
- `request.version` is only optimistic compare-and-set generation for the
  mutable request row. It is not quote, payment, service-plan, or delivery
  commercial identity. Readiness-only changes may advance it without changing
  the accepted quote.
- `couranr_quote_versions.id` is immutable commercial identity. Submission,
  payer approval, payment obligation, confirmed service plan, and delivery all
  identify the exact quote UUID. Repricing inserts Quote N+1 and never edits
  Quote N. Request quote columns are a compatibility projection only.
- A payment obligation derives amount, pricing-policy version, payer type and
  currency from its immutable quote. Delivery commercial snapshots come from
  that quote, captured money from the obligation, and schedule/vehicle
  commitments from the service plan.
- One Delivery is one customer/destination fulfillment. New canonical requests
  have zero `additional_stops`; historical values are preserved. Future Route
  Saver uses a Route Run aggregate that groups multiple Delivery records. Gate A
  does not create that aggregate.
- The existing readiness vocabulary means pickup readiness for both requester
  kinds. There is no second consumer readiness machine.
- Request `source` says where the request originated, such as merchant portal,
  consumer send, hosted request, operations, API, or import. Smart Intake is a
  future enrichment/input capability; historical `smart_intake` source values
  remain readable, but it is not new source authority or commercial DML
  authority.

The historical additional-stop and Route Saver prices below remain future
product/pricing authority; they do not permit extra destinations on one
canonical Delivery in Gate A.

## Provenance — this is an EXTRACTION, not a rewrite

Every line below is lifted verbatim from `Couranr_Claude_Code_Master_Package.md`
at the repo root: its Master Implementation Specification and its AI and
Communication Specification plus Release Acceptance Matrix, in that order. Not a
word was edited, reordered or summarised, and
`tests/couranr-product-spec.test.ts` asserts byte-identity against the package on
every run — so this document cannot drift from the doctrine it was cut from, and
nobody has to trust that it did not.

What was deliberately LEFT BEHIND, because §3.C of the authority consolidation
work order says execution history does not belong in live doctrine: the package
README, the repository cutover matrix, the phased execution plan and the Claude
Code start prompt. Those are branch instructions and dated plans. They remain in
the Master Package, which is HISTORICAL now, and none of the 45 decision records
cited any of them — all 33 that named the package cited §1–§18 of the Master
Implementation Specification, which is reproduced here in full.

---

# Couranr Merchant Delivery MVP — Master Implementation Specification

## 1. Implementation mandate

Transform `kkoly10/couranr-os` from a mixed auto-rental, document-service, generic business, and courier application into one focused product:

> **Couranr — local delivery infrastructure for local businesses.**

The merchant remains the seller and merchant of record for goods. Couranr handles delivery request intake, deterministic pricing, payment authorization and capture, Couranr-managed dispatch, driver execution, tracking, proof, returns, delivery-charge refunds, support, and operational intelligence.

This document is authoritative. Claude Code must not invent replacement policies or preserve legacy behavior because it already exists.

## 2. Product promise and boundaries

### Core promise

> Receive the order however you already receive it. Couranr handles what happens after the order is ready.

Merchants may receive orders through their website, phone, text, social media, point of sale, in person, or other merchant-controlled channels. Couranr does not need to become the merchant’s ecommerce platform.

### Couranr charges

Couranr charges for delivery and approved operational charges: waiting, returns, loading or handling, additional stops, signature service, overnight service, tolls, and parking.

Couranr does not charge a monthly fee, signup fee, or product-sales commission during the pilot.

### Merchandise responsibility

The merchant remains responsible for merchandise price, product quality, product availability, product refunds, replacement, accurate package description, packaging, legal eligibility, readiness, and accepting valid returns. Couranr handles delivery-service charges and delivery-service incidents.

## 3. Markets and operating model

### Initial marketed markets

- Washington, DC
- Stafford
- Woodbridge
- Fredericksburg
- Surrounding areas

Maryland is not an initial marketed market.

Public copy:

> Local business delivery across DC, Stafford, Woodbridge, Fredericksburg, and surrounding areas.

Supporting copy:

> Same-day, next-day, scheduled, overnight, bulky, and extended-distance delivery—managed by Couranr.

Requests outside the primary markets must be captured and reviewed rather than silently rejected by ZIP code.

### Hours

- Monday through Friday
- Standard fulfillment: 6:00 AM–6:00 PM
- Earliest pickup: 6:00 AM
- Same-day request cutoff: 4:00 PM
- After 4:00 PM: normally next business day
- Friday after 4:00 PM: normally Monday unless closure or observed holiday
- Overnight: 6:00 PM–6:00 AM when Couranr enables and confirms it
- Overnight surcharge: $30
- Rush and overnight do not stack during the pilot
- All pickup and delivery times are estimates

Availability states:

- Standard
- Same-day
- Priority
- Rush
- Overnight
- Scheduled only
- Temporarily closed
- Weather-limited

## 4. Pricing registry

All prices are stored in integer cents and calculated server-side.

### Standard delivery

- First three loaded miles: $22.99
- Miles 4–10: $2.25 per loaded mile
- Miles 11–25: $3.00 per loaded mile
- Miles 26–50: $3.50 per loaded mile
- Miles 51–75: $4.00 per loaded mile
- Miles 76–100: $4.75 per loaded mile
- More than 100 miles: request captured for manual final quote

### Service-level charges

- Priority: +$7
- Rush: +$12
- Overnight: +$30
- Rush and overnight do not stack

### Additional charges

- Additional stop: +$8
- Signature: +$3
- Photo/PIN proof: included
- 26–50 lb: +$10
- 51–75 lb or SUV-bulky class: +$25
- 76–150 lb or pickup/cargo-van class: +$50
- 151–200 lb or XL class: +$85
- More than 200 lb: Couranr review and manual quote
- First 10 waiting minutes: included
- Waiting after 10 minutes: $0.75 per minute
- Return: 70% of original delivery charge, $14.99 minimum
- Cancellation after Couranr confirmation and before arrival: $8
- Failed pickup attempt after arrival: $15
- Tolls and parking: at cost
- Tip: 100% to driver

Final calculated total is rounded to the nearest $0.25 when the accepted pricing policy requires it. Preserve exact inputs and line items.

### Route Saver

- One merchant pickup
- At least three stops
- Compatible delivery window
- Couranr controls route order
- Merchant normally pays during the pilot
- Public starting price: $16.99 per stop

### Internal economics

Store internal cost estimates separately from customer pricing.

Initial internal driver-cost benchmark:

- First three miles: $15.50
- Miles 4–10: $1.65 per mile
- Miles 11–25: $2.30 per mile
- Miles 26–50: $2.75 per mile
- Miles 51–75: $3.20 per mile
- Miles 76–100: $3.80 per mile
- Priority: +$5
- Rush: +$8
- Additional stop: +$6
- 26–50 lb: +$7
- Signature: +$2
- Waiting: $0.50 per minute
- Tolls/parking reimbursed
- Tips 100%

When Couranr operates the delivery directly, this is a cost benchmark, not an automatic payable.

### Promotional credit

Never overwrite the standard quote to make a pilot delivery free or cheaper. Record the standard quote, amount paid, Couranr promotional credit, reason, market, category, campaign, and approver.

## 5. Merchant onboarding and presets

### Two-speed onboarding

Test workspace requires verified account, business name, contact, primary location, and primary category. It cannot dispatch live deliveries.

Live activation requires verified contact, accepted delivery terms, prohibited-item policy, merchant responsibility acknowledgement, return acceptance, and required operating information.

Do not require a universal website, EIN, storefront, or business-registration upload unless risk review requires it.

Allow storefront businesses, home businesses, sole proprietors, social-media sellers acting as businesses, service providers, and general local businesses.

### Categories

Merchant selects one primary category and up to three secondary categories.

Initial registry:

1. Dry cleaning, laundry, tailoring
2. Printing, signage, promotional products
3. Boutique, clothing, shoes, accessories
4. Florists, gifts, specialty retail
5. Repair and electronics
6. Auto parts and accessories
7. Furniture and home goods
8. Event rentals and supplies
9. Bakeries, prepared food, catering
10. Books, cards, collectibles, hobby
11. General local business

Category controls initial recommendations, not eligibility.

### Preset hierarchy

1. Couranr global category preset
2. Merchant-customized preset
3. Merchant-created preset

Global updates never overwrite merchant customization. Every preset is versioned. Each delivery stores preset ID, version, and immutable snapshot.

Presets may suggest common item, package count, handling, proof, vehicle capabilities, required questions, and payer preference. They must not silently assert exact weight, dimensions, value, final vehicle, final price, loading availability, or safety.

## 6. Couranr Smart Intake

MVP inputs:

- Natural-language description
- Pasted order
- Saved preset
- Manual form

Voice, image, receipt screenshot, and photo intake are post-launch.

Smart Intake:

1. Parses merchant text.
2. Returns a structured editable draft.
3. Records source, confidence, and evidence per field.
4. Asks one highest-impact clarification at a time.
5. Sends confirmed structured data to deterministic route, pricing, and policy services.
6. Never prices, confirms, captures money, selects the final vehicle, or accepts the delivery.

Confidence:

- 85% or higher: prefill and display source
- 60–84%: show likely value and require confirmation
- Below 60%: leave empty and ask

Never invent exact weight, dimensions, declared value, address, recipient identity, loading assistance, stairs, final vehicle, final price, final schedule, leave-at-door authorization, or payment status.

Review triggers include overnight, more than 25 loaded miles, more than 50 lb, bulky without dimensions, loading uncertainty, hazardous-material signal, high value, temperature sensitivity, oversized fragile item, secure destination, special-facility access, vehicle mismatch, conflicting information, low confidence, address uncertainty, or setup/breakdown work.

Review means human judgment, not automatic rejection.

## 7. Merchant-paid and customer-paid workflows

Onboarding asks who usually pays:

- Customer usually pays
- My business usually pays
- It depends on the order

Default: it depends on the order. Both options remain available for every delivery.

### Merchant-paid

1. Merchant creates request.
2. Merchant selects business pays.
3. Quote is generated.
4. Merchant accepts.
5. Payment method is confirmed.
6. Payment is authorized.
7. Merchant marks ready.
8. Request enters Couranr review.
9. Couranr confirms schedule and vehicle.
10. Payment captures.
11. Delivery is created and assigned.

### Customer-paid merchant link

1. Merchant creates and confirms merchandise-order details.
2. Merchant selects customer pays.
3. Customer receives secure link.
4. Customer reviews merchant, item summary, address, timing, policy, and price.
5. Customer authorizes payment.
6. Merchant marks ready.
7. Couranr confirms.
8. Payment captures.
9. Delivery begins.

Customer account is not required.

### Customer-initiated hosted request

1. Customer opens merchant delivery link.
2. Customer submits order reference and delivery details.
3. Merchant validates order and eligibility.
4. Quote is generated.
5. Customer authorizes.
6. Merchant marks ready.
7. Couranr confirms and captures.
8. Delivery begins.

Never request customer payment before merchant validation.

Payer changes:

- Before authorization: allowed
- After authorization: cancel old obligation and create new
- After capture: refund/new charge requires Couranr Operations
- After pickup: normally not allowed

No split payments in MVP.

## 8. Canonical states and authority

Use independent state groups.

Request:
`draft`, `awaiting_merchant_confirmation`, `awaiting_quote_acceptance`, `pending_couranr_review`, `quote_revision_required`, `confirmed`, `declined`, `cancelled`, `closed`.

Payment:
`not_started`, `payment_method_saved`, `requires_action`, `authorized`, `capture_pending`, `captured`, `failed`, `cancelled`, `partially_refunded`, `refunded`.

Readiness:
`not_confirmed`, `preparing`, `ready`, `not_ready`, `unavailable`.

Review:
`not_required`, `pending`, `accepted_as_quoted`, `requoted`, `declined`.

Fulfillment:
`not_scheduled`, `scheduled`, `assigned`, `en_route_to_pickup`, `at_pickup`, `picked_up`, `in_transit`, `at_dropoff`, `delivered`, `attempt_failed`, `return_required`, `returning`, `returned`, `cancelled`.

Incident:
`none`, `reported`, `under_review`, `awaiting_evidence`, `resolved`, `closed`.

Merchant may create/edit requests, confirm merchandise order, mark readiness, approve merchant-paid quotes, request changes, and message.

Customer may confirm address, approve customer-paid quote, select allowed handoff, and request help.

Driver may execute assigned fulfillment transitions, capture required proof, and send delivery messages.

Couranr Operations controls review, schedule, vehicle, assignment, requote, return, delivery refunds, incidents, and audited overrides.

No browser sends an arbitrary target status. Every transition uses a named server command.

## 9. Vehicle and dispatch model

Vehicle records store name, type, cargo dimensions, payload, enclosed/open, folding seats, dolly, ramp, tie-downs, weather protection, active/availability, and capabilities.

Smart Intake recommends capabilities. Couranr Operations selects the actual compatible vehicle.

Store recommended capabilities, recommended vehicle when applicable, selected vehicle, and override reason.

Initial assignment method: `couranr_managed`.

No public driver marketplace in MVP.

Couranr Operations Queue shows merchant, customer, market, addresses, distance, timing, package, weight/dimensions, loading, handling, recommended capability, compatible vehicles, payer, quote, payment, internal cost, contribution, review reasons, missing information, and risk.

Actions: confirm as quoted, select vehicle, change schedule, ask information, send revised quote, apply promotional credit, could not confirm service, convert to Route Saver, duplicate/reschedule.

## 10. Payment and ledger architecture

A payment obligation represents who owes, how much, which quote, why, current status, and replacement relationship.

A payment attempt represents Stripe PaymentIntent, authorization, amount capturable, capture, failure, cancellation, deadline, and provider identifiers.

Do not store raw card data.

Immediate request:

1. Create manual-capture PaymentIntent.
2. Payer confirms.
3. Verify Stripe reports capturable funds.
4. Mark obligation authorized.
5. Couranr confirms.
6. Capture idempotently.
7. Create delivery only after successful capture.
8. Reconcile through webhook after interruptions.

Scheduled future request:

1. Save payment method with consent.
2. Recalculate closer to fulfillment.
3. Generate updated quote if needed.
4. Obtain approval for material increase.
5. Authorize/capture closer to fulfillment.

Create immutable balanced ledger transactions. Minimum accounts: Stripe clearing, delivery revenue, overnight revenue, waiting revenue, return revenue, tips payable, toll/parking reimbursement, processing expense, promotional-credit expense, refund expense, dispute, and tax liability where applicable.

Authorization is not revenue. Capture creates revenue. Never rewrite accepted quote or captured transaction to represent refund or adjustment.

## 11. Delivery lifecycle, proof, exceptions, and returns

Pickup requires merchant pickup PIN, package count, shipment photo, condition photo, merchant/staff identity, timestamp, location, and actual vehicle.

Large/unusual shipments also require dimensions, securement photo, loading participants, equipment, existing damage, and acknowledgement.

Material discrepancy pauses pickup and may require requote.

Delivery proof:

- Direct handoff: recipient PIN, first name, timestamp, location
- Signature: signature, signer name, timestamp, location
- Leave at door: merchant permission, customer authorization, safe location, weather suitability, photo, timestamp, location

Do not require face or ID-document photos.

Waiting:

- First 10 minutes included
- Five-minute reminder
- Paid waiting at 10 minutes
- Operations alert at 15
- Decision at 20

Cancellation:

- Before authorization: no charge
- After authorization before confirmation: release, no charge
- Couranr cannot confirm: release, no charge
- After confirmation before arrival: $8
- After arrival with unavailable package/merchant: $15 attempt fee plus approved waiting
- After pickup: original delivery plus applicable return

Recipient unavailable: record arrival, notify, contact, wait, use authorized safe leave-at-door only when permitted, otherwise return.

Return: 70% of original, $14.99 minimum, structured reason, evidence, notifications, payment obligation, merchant return PIN, condition photo, timestamp, receipt. No automatic free redelivery.

Weather before pickup: pause/cancel, release/refund, no cancellation fee, offer reschedule. After pickup: stop safely, notify, continue/hold/return, preserve evidence, no overnight fee solely due to Couranr delay.

## 12. Communication system

MVP has no public support phone.

Primary support:

- Merchant in-app Support
- Merchant–driver delivery-specific chat
- Couranr Operations Inbox
- Customer Delivery Help through secure tracking
- Email for receipts and nonurgent records

No unrestricted customer–driver chat.

Couranr normally responds within 15 minutes during operating hours. Automated acknowledgement does not count as human response.

After hours, AI may answer verified questions. Human-required ordinary issues are due next operating period. Active accepted overnight deliveries retain the 15-minute target.

Driving Mode activates during travel states. Routine support alerts are silent, AI continues analysis, active blocking/safety alerts remain, typing is discouraged, and a safe-stop brief appears later.

Conversation types:

- Merchant–Couranr Support
- Merchant–driver delivery chat
- Customer Delivery Help
- Couranr Operations Inbox

All message writes go through authenticated server commands with participant checks, idempotency, audit, and AI enqueue.

## 13. AI systems

Couranr Smart Intake creates request drafts.

Couranr Assistant serves authenticated merchants and recipients and may auto-answer only verified low-risk facts.

Ask Couranr is a 24/7 public marketing assistant for public pricing, markets, hours, categories, onboarding, proof, public policies, nonbinding estimates, lead qualification, and signup. It has no private operational access.

Couranr Ghost Operations is the internal super assistant: summarize unread messages, explain blockers, retrieve delivery/payment/proof facts, find policy, find generalized similar cases, draft replies, recommend actions, prepare nonexecuting action drafts, create operations briefs, and support analytics.

The model has no direct SQL. Use an allowlisted tool broker.

Read tools:

- getMerchantSummary
- getDeliverySummary
- getDeliveryTimeline
- getQuoteSummary
- getPaymentStatus
- getProofStatus
- getConversationContext
- getApplicablePolicy
- findSimilarResolvedCases
- getOperationsQueue
- getMarketMetrics

Preparation tools may draft replies, requotes, refund recommendations, schedule proposals, and return recommendations. No direct execution tools.

Auto-reply requires safe category, resolved identity, verified tenant, verified facts, exact policy match, no conflict, no financial approval, no mutation, no safety/claim issue, at least 95% final confidence, and verifier pass.

Human review always required for address change, price change, refund, damage, cancellation after confirmation, return, timing guarantee, vehicle change, safety/restricted item, fee waiver, and payment dispute.

Kill switch required globally and by category, merchant, and conversation.

## 14. Data model and security

Schemas:

- `public`: RLS-protected operational tables intentionally exposed
- `private`: payments, Stripe, ledger, idempotency, AI logs, operator roles, costs, security, sensitive evidence
- `analytics`: de-identified events and aggregates

Core table groups:

Identity/merchant:
`business_accounts`, `business_members`, `business_locations`, `merchant_customers`, `customer_addresses`, `merchant_preferences`, `couranr_operator_roles`.

Presets:
`category_presets`, `category_item_presets`, `merchant_item_presets`, `merchant_item_preset_versions`.

Intake/request:
`intake_sessions`, `intake_extractions`, `intake_field_evidence`, `intake_clarifications`, `intake_corrections`, `delivery_requests`, `delivery_request_versions`, `shipment_packages`.

Quotes/money:
`delivery_quotes`, `delivery_quote_line_items`, `quote_acceptances`, `private.payment_obligations`, `private.payment_attempts`, `private.stripe_webhook_events`, `private.refunds`, `private.financial_adjustments`, `private.ledger_transactions`, `private.ledger_entries`, `private.delivery_cost_entries`.

Fulfillment:
`driver_profiles`, `vehicles`, `deliveries`, `delivery_assignments`, `delivery_events`, `delivery_proofs`, `delivery_returns`, `delivery_incidents`.

Communication/AI:
`conversations`, `conversation_participants`, `conversation_messages`, `message_attachments`, `conversation_read_states`, `support_response_deadlines`, `private.ai_runs`, `private.ai_tool_calls`, `private.ai_response_decisions`, `couranr_knowledge`, `policy_registry`.

Platform:
`private.idempotency_records`, `private.audit_events`, `guest_access_tokens`, `analytics.events`.

Security:

- Every exposed table has RLS.
- Private security-definer authorization functions use fixed search path.
- Merchant access scoped by business account.
- Driver access assignment-scoped and sanitized.
- Customer access uses hashed, random, purpose-scoped, expiring tokens.
- Storage buckets private.
- Signed URLs short-lived.
- Internal notes never leak.
- Service-role backend-only.
- AI never receives secrets, raw card data, auth tokens, or unrestricted dumps.

Concurrency:

Every mutable aggregate has version. Commands include expectedVersion and idempotencyKey.

Guarantee one effect for request creation, quote acceptance, PaymentIntent creation, capture, assignment, state transition, message, proof finalization, refund, and return.

## 15. Legacy quarantine

Before destructive work:

- Tag `legacy-multiservice-2026-07-27`
- Archive branch `archive/auto-docs-multiservice`
- Active branch `feature/merchant-delivery-mvp`
- Verify database backup
- Inventory Stripe, storage, environment variables

Retain/adapt Next.js, React, Supabase Auth, business accounts/members, address concepts, driver UI concepts, Stripe SDK/signature verification, Resend, maps, Vitest.

Replace old browser quote, old quote API, checkout, direct assign/mark-in-transit, old payment helpers, shared webhook, generic courier admin, public proof storage, and mixed status model.

Archive auto rental, document services, subscription packages, mixed jobs, docs usage, old pricing, and old rejection tests.

Disable:

- `/api/delivery/assign-driver`
- `/api/delivery/mark-in-transit`
- `/api/auto/*`
- `/api/docs/*`

Redirect:

- `/courier/quote` → `/estimate`
- `/courier/checkout` → `/business/deliveries/new`
- `/dashboard/business/deliveries` → `/business/deliveries`

No dual write. New requests never create legacy orders.

## 16. Target routes

Public:
`/`, `/pricing`, `/businesses`, `/service-areas`, `/how-it-works`, `/estimate`, `/request/[merchantSlug]`, `/pay/[token]`, `/track/[token]`, `/help/[token]`, `/sign-in`, `/sign-up`.

Merchant:
`/business`, `/business/onboarding`, `/business/deliveries`, `/business/deliveries/new`, `/business/deliveries/[id]`, `/business/customers`, `/business/presets`, `/business/messages`, `/business/website-tools`, `/business/settings`, `/business/settings/team`, `/business/settings/billing`.

Driver:
`/driver`, `/driver/deliveries/[id]`, `/driver/messages`, `/driver/availability`, `/driver/vehicle`.

Operations:
`/operations`, `/operations/queue`, `/operations/deliveries`, `/operations/deliveries/[id]`, `/operations/messages`, `/operations/support`, `/operations/ghost`, `/operations/merchants`, `/operations/vehicles`, `/operations/payments`, `/operations/refunds`, `/operations/incidents`, `/operations/analytics`, `/operations/settings`.

## 17. Analytics

Track lead market, merchant market, pickup/destination market, source, category, request source, Smart Intake usage, quote, payer, authorization, capture, completed paid delivery, repeat delivery, distance, weight/dimensions, vehicle recommendation/selection, urgency, revenue, Stripe fee, reserve, cost, credit, refund, contribution, cancellation, wait, return, support case, AI answer, response time, and unmet demand reason.

Do not copy message bodies, full addresses, gate codes, phone numbers, proof URLs, or card data into analytics.

## 18. Release authority

Launch requires:

- Zero P0 defects
- Zero core P1 defects
- Cross-tenant security passes
- Both payer flows pass
- Payment and ledger reconcile
- Proof and returns pass
- Driver assignment/state authority pass
- Backup verified
- Production canary passes
- Operations can pause requests and AI

Ghost drafts may launch while auto-replies remain disabled.

Each phase report must list completed phase, files created/changed/disabled, migrations, tests and results, security implications, data implications, known gaps, next phase, and any accepted decision that could not be implemented.

---

# Couranr AI and Communication Specification

## One intelligence platform, five permissioned surfaces

| Surface | Name | Audience | Data boundary |
|---|---|---|---|
| Intake | Couranr Smart Intake | Request creator | Current intake, allowed merchant context |
| Public | Ask Couranr | Anonymous prospect | Public knowledge and consented lead data |
| Merchant | Couranr Assistant | Authenticated merchant | That merchant’s account/deliveries |
| Recipient | Delivery Help | Signed token holder | One delivery |
| Internal | Couranr Ghost Operations | Couranr Operations | Broad controlled tools, audited |

Shared infrastructure does not mean shared permissions.

## Communication model

No public support phone at MVP.

Channels:
- Merchant in-app Support
- Delivery-specific merchant–driver chat
- Customer Delivery Help
- Couranr Operations Inbox
- Email for receipts/nonurgent records

Support target:
> Couranr normally responds to in-app support messages within 15 minutes during operating hours.

Operating hours: Monday–Friday, 6:00 AM–6:00 PM.

After hours:
- AI answers verified questions.
- Human-required ordinary cases wait until next operating period.
- Active accepted overnight delivery retains 15-minute Operations target.

Conversation deadlines store `received_at`, `response_due_at`, `first_couranr_response_at`, next operating period, and due state. At 10 minutes mark due soon; at 15 overdue. Automated acknowledgement does not count as Operations response.

## Conversation permissions

Merchant–support includes authorized merchant roles and Couranr.

Delivery chat includes merchant, assigned driver, and Couranr Operations. It is created after delivery confirmation.

Customer Delivery Help is limited by one signed token and one delivery. Customer may report availability, access, address concern, handoff concern, unrecognized delivery, delivery problem, or other. A message never directly mutates address, price, payer, cancellation, return, proof, or state.

Visibility:
- participants
- couranr_internal
- driver_and_couranr
- merchant_and_couranr

Internal notes and AI drafts must be excluded from initial queries, realtime, exports, and notifications.

## Driving Mode

Active during travel states.

- Routine support alerts silent
- No repeated sound/vibration
- Messages continue to record
- AI continues analysis
- Blocking and safety alerts remain visible
- Typing discouraged
- Safe-stop brief summarizes work

## Smart Intake

Every extracted field stores value, confidence, source, source text, and confirmation requirement.

Sources:
- merchant_statement
- saved_preset
- merchant_default
- previous_confirmed_delivery
- ai_inference
- unknown

Required extraction:
- Order reference
- Recipient
- Pickup/drop-off
- Shipment/category/item
- Quantity/package count
- Weight/dimensions/value
- Handling/loading
- Timing/service level
- Payer
- Proof
- Vehicle requirements
- Restricted signals
- Review reasons
- Missing fields
- One clarification
- Overall confidence

Input is untrusted. Use system/data separation, structured schema, field allowlist, input caps, PII minimization, deterministic pricing/safety, no direct SQL, no mutation tool, and correction audit.

## Couranr Assistant auto-reply

Confidence is based mainly on verified database facts and exact policy, then context completeness, conflict checks, model confidence, and independent verifier.

Safe auto-reply:
- Verified delivery status
- Verified payment status
- Confirmed estimated pickup window
- Missing information
- Hours
- Navigation help
- Proof availability
- Standard policy

Human required:
- Address or price change
- Refund
- Damage
- Cancellation after confirmation
- Return
- Timing guarantee
- Vehicle change
- Safety/restricted item
- Fee waiver
- Payment dispute
- Suspension/legal claim

Decision record contains summary, category, urgency, resolved entities, verified facts and sources, missing/conflicting facts, policy version, proposed reply, decision, confidence, explanation, and prohibited actions.

Decisions:
- auto_send
- request_clarification
- operations_review
- safety_escalation

Verifier checks evidence, unsupported promises, false action claims, private-data leakage, prohibited actions, terminology, policy version, and tenant scope.

## Couranr Ghost Operations

Case panel:
- Merchant need
- Current facts
- Blocker
- Risk
- Suggested reply
- Recommended actions
- Policy
- Similar generalized cases
- Warning
- Missing evidence
- Confidence
- Audit

Global queries:
- What needs attention?
- Summarize unread messages.
- What blocks a delivery?
- Draft routine replies.
- Which deliveries wait on readiness?
- Which requests include changes?
- Which market has strongest paid repeat demand?
- What should be handled before the next route?

Read tools:
- getMerchantSummary
- getDeliverySummary
- getDeliveryTimeline
- getQuoteSummary
- getPaymentStatus
- getProofStatus
- getConversationContext
- getApplicablePolicy
- findSimilarResolvedCases
- getOperationsQueue
- getMarketMetrics

Preparation tools:
- Reply draft
- Requote draft
- Refund recommendation
- Schedule proposal
- Return recommendation

No execution tool is directly available to the model.

## Ask Couranr

Public capabilities:
- Markets, hours, cutoff, overnight
- Public pricing and payer options
- Categories and onboarding
- Proof/cancellation/wait/return policy
- Deterministic nonbinding estimate
- Lead qualification with consent
- Merchant signup/test workspace

Public prohibitions:
- No merchant/delivery/customer lookup
- No payment/proof/private conversation
- No internal notes

Delivery status routes to secure tracking or login.

Lead record may contain business/contact/email/market/category/delivery type/frequency/payer preference/concern/chat summary/source/UTM/recommended next action with consent.

## Data broker and audit

Every AI call includes surface, actor, business, conversation, delivery, purpose, tools, data classes, record cap, and expiration.

Every tool call records run, tool, scope, purpose, parameter hash, accessed records, sensitive classes, result, duration, and timestamp.

Every auto reply records facts, policy, models, prompt, verifier, confidence, final message, human correction, and feedback.

## Kill switches

Pause:
- All auto replies
- Category
- Merchant
- Conversation
- Public assistant
- AI provider

Automatic pause on tenant failure, missing policy, data conflict, provider degradation, high correction rate, verifier failures, or security anomaly.

AI failure must not block manual support, payment, fulfillment, proof, tracking, authorized refunds, or state commands.


---

# Couranr Release Acceptance Matrix

## Severity

- **P0:** Security, money, custody, proof, safety, or unrecoverable data failure. Zero open.
- **P1:** Core merchant/customer/driver/Operations failure. Zero core open.
- **P2:** Safely deferrable only with workaround, owner, and date.
- **P3:** Cosmetic/enhancement.

## Evidence

Every P0/P1 test records test ID, commit SHA, environment, identity, preconditions, steps, expected/actual, pass/fail, UI evidence, logs, database rows, Stripe IDs, ledger ID, proof object, defect, and retest.

## Automated gate

```text
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check:routes
npm run check:legacy-imports
npm run check:rls
npm run check:migrations
npm run check:policy-registry
npm run test:security
npm run test:payments
npm run test:delivery-lifecycle
npm run test:ghost-isolation
```

## Required test groups

### Legacy
- Preservation exists.
- Auto/docs cannot mutate.
- Old quote/checkout cannot price/pay.
- Webhook isolated.
- New request creates no legacy order.

### Database/security
- Clean and upgrade migrations.
- RLS every exposed table.
- Merchant A/B isolation through UI/API/realtime/UUID guessing.
- Role boundaries.
- Driver assignment scope.
- Guest-token purpose/expiry/revocation.
- Internal-note privacy.
- No client secrets.

### Onboarding/presets
- Test versus live activation.
- One primary + three secondary categories.
- General business.
- Payer default ask each time.
- Card not required to finish.
- Versioned presets.
- No silent exact facts.

### Smart Intake
- Plain language and pasted order.
- Confidence bands.
- One clarification.
- No invented critical fields.
- Heavy/long retained for review.
- Restricted signals.
- Prompt injection blocked.
- AI outage fallback.
- Correction audit.

### Pricing
- $22.99 first three miles.
- All distance/weight/service tiers.
- Nonstacking rush/overnight.
- Stops, signature, waiting, return, cancellation, attempt.
- Route Saver.
- Promotional credit.
- Quote immutability.
- Cent reconciliation.

### Payments/ledger
- Merchant-paid.
- Customer-paid.
- Hosted request.
- Authorization/capture failures.
- Duplicate click/event/refund.
- Quote expiration.
- Payer change.
- Out-of-order webhook.
- Interrupted capture.
- Balanced ledger and Stripe reconciliation.
- Test/live isolation.

### Operations/driver/proof
- Complete Queue.
- Confirm/requote/information/decline.
- Vehicle recommendation/selection.
- Operations-only assignment.
- Driver sanitized data.
- Valid/invalid state transitions.
- Pickup and delivery proof.
- Leave-at-door controls.
- Mismatch.
- Offline proof.
- Driving Mode.

### Exceptions
- Wait clock.
- Merchant not ready.
- Recipient unavailable.
- Address change.
- Cancellation stages.
- Return.
- No free redelivery.
- Damage/unsafe lift/prohibited item.
- Weather.

### Messaging
- Merchant support.
- 15-minute and after-hours timers.
- Merchant–driver.
- Operations visibility.
- Chat cannot mutate.
- Attachments.
- Realtime privacy.
- Idempotent send.
- Delivery Help.
- No direct customer-driver flood.

### AI
- Scoped context.
- No SQL.
- Tenant isolation.
- Verified answers.
- No false action claim.
- 95% plus deterministic gates and verifier.
- Restricted escalations.
- Redaction.
- Driving Mode.
- Kill switch.
- Audit.
- Provider failure leaves manual operations.
- Public/private boundary.
- Deterministic estimate and lead consent.

### Analytics/observability
- Market and source attribution.
- Paid/repeat demand.
- Category and economics.
- Unmet demand.
- Support and AI metrics.
- No PII.
- Alerts for payments, webhook, ledger, proof, support, security, stuck states.

### Recovery
- Backup verified.
- Restore rehearsal.
- Storage reconciliation.
- Stripe replay.
- Pause new requests.
- Pause AI.

## Required end-to-end scenarios

1. Merchant-paid Stafford delivery
2. Customer-paid DC delivery
3. Customer-hosted request
4. Revised quote/larger vehicle
5. Merchant not ready/waiting
6. Recipient unavailable/return
7. Address change after pickup
8. More than 100 lb reviewed safely
9. Overnight delivery
10. Couranr cannot confirm/release authorization
11. Ghost safe reply while driving
12. Ghost escalation
13. Marketing lead to paid delivery attribution
14. Offline proof recovery
15. Capture interruption/webhook reconciliation

## Production canary

One controlled real production delivery must cover merchant workspace, request, accepted quote, low-value payment, review, vehicle, assignment, chat, pickup proof, tracking, delivery proof, receipt, support, Ghost, Stripe, ledger, and analytics.

## Go/no-go

Go: zero P0, zero core P1, all required areas pass, canary and backup pass, Stripe/ledger reconcile, Operations can pause requests and AI.

Conditional go: only an optional disabled feature remains; no security, money, safety, custody, or data risk. Ghost auto-replies may remain disabled.

No-go:
- Cross-tenant leak
- Incorrect charge/refund
- Missing proof
- Unauthorized mutation
- Unbalanced ledger
- Failed payer flow
- Return charge error
- Driver access failure
- Unsafe acceptance
- Unrecoverable webhook
- Missing backup
- Failed canary
