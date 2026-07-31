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
