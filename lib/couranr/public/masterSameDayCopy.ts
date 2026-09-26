/**
 * MKT-005 — the locked Master, Same Day and direct-consumer copy.
 *
 * GENERATED-BY-HAND, VERIFIED BY TEST. `02_DECISION_REGISTRY.json` is the
 * authority; this module is the render-time implementation of it, and
 * `tests/couranr-master-sameday-copy.test.ts` asserts the two agree string for
 * string. A copy edit made here and not there fails the suite rather than
 * shipping copy no decision approved.
 *
 * WORDS ONLY. No route, no URL, no price, no market name, no operating hour.
 * Routes belong to `ui_screen_registry.json` (read them through
 * `routeForScreen`); decision-dependent numbers belong to
 * `lib/couranr/public/governed.ts`.
 *
 * Every apostrophe is U+2019. The owner brief spelled two strings with an
 * ASCII apostrophe in its locked-copy list and with U+2019 in its own body
 * spec; MKT-005.value.apostrophe_normalization records the choice and why.
 */

/** PUB-012, the Couranr master homepage. */
export const MASTER_COPY = {
  hero_headline: "Already bought it? We’ll go get it.",
  hero_support: "Couranr picks up eligible purchases you’ve already arranged—and delivers things you already have.",
  hero_boundary: "You arrange the item. Couranr handles the trip.",
  hero_pickup_cta: "Pick something up",
  hero_send_cta: "Send something",
  hero_business_prompt: "Delivering orders for your customers?",
  hero_business_cta: "Couranr for Business",
  consumer_door_title: "Couranr Same Day",
  consumer_door_support: "Send something you have or pick up something you’ve already bought.",
  business_door_title: "Couranr for Business",
  business_door_support: "Your customers order from you. Couranr handles the delivery operation.",
  /* The master brand line. It names the shared network; `network_heading`
     below asks the question this page exists to answer. */
  brand_line: "One local delivery network. Two ways to use it.",
  network_heading: "One delivery, or delivery as part of your business?",
  network_statement: "Same Day solves a delivery. Couranr for Business helps your business offer delivery.",
  network_consumer_title: "Couranr Same Day",
  network_consumer_body: "Use Same Day when you personally need an item delivered or picked up.",
  network_consumer_points: [
    "Something you already own",
    "Something you already bought or arranged",
    "No business workspace required",
    "Request and pay for the delivery you need",
  ],
  network_business_title: "Couranr for Business",
  network_business_body: "Use Couranr for Business when customers are buying from your business and delivery is part of how you serve them.",
  network_business_points: [
    "Manage customer deliveries in one workspace",
    "Choose whether the business or customer pays",
    "Follow fulfillment, tracking and proof",
    "Keep delivery history together",
  ],
  /* The distinction is PURPOSE, not speed, and not whether the requester
     happens to own a business. Both products may run same-day. */
  network_edge_case: "A business owner can still use Same Day for an occasional personal or one-off trip. What determines the product is the purpose of the delivery\u2014not whether you happen to own a business.",
  network_example: "Bought a cake and need it picked up? Same Day. Run the bakery and want Couranr delivering customer cake orders? For Business.",
  service_area_heading: "Where Couranr delivers",

  use_cases_heading: "Here’s when Couranr comes in.",
  marketplace_title: "Bought something on Facebook Marketplace?",
  marketplace_body: "Arrange the purchase with the seller and confirm they can hand it to a courier. Couranr can collect an eligible item and bring it to you.",
  marketplace_boundary: "Couranr handles delivery—not seller payments, negotiation or product authentication.",
  route_story_brand: "Couranr",
  ready_title: "Your order is ready. Your schedule isn’t.",
  ready_body: "Dry cleaning, a print order or an eligible purchase from a local shop. Confirm it is ready and that the pickup location permits courier collection. Couranr handles the trip.",
  send_title: "Something needs to get across town.",
  send_body: "Keys at home. Documents at work. A gift for a friend. Send an eligible item from where it is to the person who needs it.",

  workflow_heading: "Arrange the pickup. We’ll handle the delivery.",
  workflow_titles: [
    "Get the item ready",
    "Tell us about the trip",
    "Review your delivery",
    "Couranr handles the trip",
  ],
  workflow_bodies: [
    "Arrange the item with the seller, store or person holding it, and confirm courier collection.",
    "Enter the pickup and destination, describe the item, and provide the required contact information.",
    "See the delivery estimate before you submit. Couranr confirms availability, schedule and vehicle before capture.",
    "The driver completes the required pickup process, and the recipient gets their own delivery information for handoff.",
  ],
  workflow_example: "Example: arrange a box of books with a local seller, confirm courier pickup, enter the seller’s address and your destination, review the delivery estimate, and Couranr handles the trip.",

  business_heading: "Your customers order from you. We handle delivery.",
  business_body: "Keep taking orders through your existing website, messages, phone or counter. Couranr for Business helps you organize delivery after the order is ready.",
  business_points: [
    "Manage customer deliveries in one workspace",
    "Choose whether the business or customer pays",
    "Follow fulfillment, tracking and proof",
    "Keep delivery history together",
  ],
  business_cta: "Explore Couranr for Business",

  check_heading: "See whether we can make the trip—and what it will cost.",
  check_body: "Enter the pickup and destination and describe the item. Couranr checks the trip and shows the delivery estimate before you submit.",
  check_payment: "Couranr confirms availability, schedule and vehicle before any payment is captured.",
  check_cta: "Check my delivery",

  handoff_heading: "Know how your item changes hands.",
  handoff_pickup: "Couranr provides pickup verification for the person handing over the item. Keep it with that person and do not send it to the driver in advance.",
  handoff_recipient: "When the delivery is confirmed, Couranr emails the recipient their own private tracking and handoff instructions.",
  handoff_evidence: "Some shipments require additional pickup documentation based on the declared value.",
  handoff_honesty: "Couranr documents what is presented and handed over. Couranr does not authenticate, appraise or certify merchandise.",

  faq_heading: "A few things to know before you book.",
  faq_questions: [
    "Can Couranr collect a Facebook Marketplace purchase?",
    "Does Couranr buy or pay for the item?",
    "Does the seller or store need a Couranr Business account?",
    "Can Couranr carry anything?",
    "Does the recipient need to be there?",
  ],
  faq_answers: [
    "Couranr can collect an eligible item when the purchase is already arranged and the seller agrees to courier pickup. Couranr is the delivery service, not the seller or marketplace.",
    "No. Merchandise payments and agreements stay between you and the seller or store.",
    "No for a Same Day pickup. The pickup party still needs to agree to collection and complete the required handoff.",
    "No. Couranr checks shipment details and does not carry prohibited or restricted items. Some size, weight, value or handling needs may require review or may not be available.",
    "Same Day requires an adult recipient and a recipient handoff step. The request flow tells you what is required for the shipment.",
  ],
  closing_headline: "One less trip to make.",
  closing_support: "Pick up something you arranged, send something you have, or put Couranr to work for your business.",
} as const;

/** PUB-013, Couranr Same Day. */
export const SAME_DAY_COPY = {
  hero_headline: "Need it across town today?",
  hero_support: "Send something you have, or have Couranr pick up something you already bought or arranged.",
  hero_question: "What do you need?",
  intent_send_title: "Send something I have",
  intent_send_support: "From me, my home, work, a friend or family member.",
  intent_pickup_title: "Pick something up for me",
  intent_pickup_support: "Something you\u2019ve already bought, ordered or arranged.",

  /* The Business cross-link. Same Day and For Business are separated by the
     PURPOSE of the delivery, never by speed — both may run same-day. A
     business owner with a one-off personal trip belongs here, not there. */
  crosslink_heading: "Delivering orders for your customers?",
  crosslink_body: "Same Day is for individual deliveries. If delivery is part of your business, explore Couranr for Business.",
  crosslink_cta: "For Business",

  already_bought_headline: "Already bought it? We\u2019ll go get it.",
  already_bought_body: "Your dry cleaning is ready. The cake is finished. Your print order is waiting. You bought something from a local shop.",
  already_bought_close: "Couranr can pick it up and bring it to you.",
  already_bought_cta: "Pick something up",
  send_what_you_have_headline: "Sometimes the thing is already with you.",
  send_what_you_have_body: "Keys left at home. Documents someone needs. A gift for a friend. Something your family forgot.",
  send_what_you_have_close: "You don\u2019t have to make the trip yourself.",
  send_what_you_have_cta: "Send something",

  /* What Couranr delivers. EXAMPLES, never an eligibility promise — the
     shipment policy decides, per shipment, after the details are described. */
  breadth_headline: "Everyday local items, without making the trip yourself.",
  breadth_lead: "Couranr Same Day is designed for eligible items you already own, have purchased or have arranged for pickup.",
  breadth_group_titles: [
    "Documents & keys",
    "Local purchases",
    "Clothing & personal items",
    "Practical items",
  ],
  breadth_group_bodies: [
    "Papers, keys and everyday personal items.",
    "Retail orders, bakery orders and purchases already arranged with a business.",
    "Dry cleaning, clothing, gifts and forgotten belongings.",
    "Eligible electronics, auto parts, tools and office supplies.",
  ],
  breadth_disclaimer: "Examples are not automatic approval. Couranr checks the shipment details before accepting the delivery.",

  /* What Couranr does NOT deliver. The CATEGORY NAMES are not written here:
     they are rendered from PROHIBITED_CLASSES in lib/couranr/shipment/facts.ts,
     the one vocabulary the /send funnel and the policy engine already enforce.
     A second hand-typed list on a marketing page is exactly the drift this
     repository keeps paying for.

     THE POLICY CTA IS BACK, AND THIS BLOCK USED TO EXPLAIN WHY IT WAS ABSENT.
     It said `lib/legal.ts` carried no such document and no canonical screen
     owned the route, so the only options were a dead link or a link to the
     LEGACY multi-product /terms page. That is no longer true:
     `lib/couranr/legal/registry.ts` owns `prohibited-items` — title, slug,
     version and `acceptanceIsRecorded: true` — and /legal/prohibited-items
     renders it. `/send`’s clickwrap already cites the same registry entry, so
     the marketing page linking to anything else would be the drift.

     THE DOCUMENT NAME IS NOT TYPED HERE EITHER, for the same reason a category
     is not: the page renders the link with the title the registry owns, so the
     name on this page and the document behind it cannot become two different
     things. This string is the lead-in only. */
  prohibited_heading: "Some things shouldn\u2019t travel with Couranr.",
  prohibited_body: "For safety, legal and insurance reasons, Couranr does not transport certain regulated, hazardous or unusually high-risk items.",
  prohibited_help: "Not sure about your item? Describe it when you request the delivery. Couranr checks whether it can be accepted before you pay.",
  prohibited_cta: "Read the full policy:",

  /* Accountable handoffs. Every sentence here describes evidence the shipped
     SAME DAY path actually records — which is narrower than the driver
     platform as a whole, and that distinction is the correction.

     THREE METHODS EXIST; SAME DAY USES ONE. `PROOF_METHODS` offers
     photo_or_pin, signature and leave_at_door, but both consumer write paths
     pass a literal `p_proof_method: "photo_or_pin"` (lib/couranr/consumer/send.ts)
     and SendFlow exposes no choice — so on the product THIS page sells, a
     photograph left at the door and a captured signature can never occur.
     Offering all three described the platform and mis-described the product.

     VALUE-TIERED CUSTODY IS REAL NOW, AND THIS BLOCK USED TO DENY IT. It said
     declared-value ceilings, numbered tamper-evident seals and recipient
     identity verification were "not in this build". Two of those three have
     shipped: `deriveProtection` in lib/couranr/consumer/protection.ts derives
     standard / secure pickup / protected handoff from the declared value, the
     SQL re-derives and enforces it, and
     private.couranr_enforce_consumer_custody_sequence requires the prepack
     photograph, the sealed-package photograph, the seal bound to that
     photograph, and the sender’s credential consumed LAST, in that order.
     Denying protection that shipped is the same defect as promising protection
     that has not, one direction over.

     WHAT IS STILL NOT OFFERED, AND WHY THE STATED CEILING IS NOT THE POLICY
     CEILING. Protected handoff needs recipient identity verification, which is
     not activated. `private.couranr_block_unavailable_protected_handoff` is an
     enabled trigger that raises `protected_handoff_identity_unavailable` for
     ANY consumer request at that level the moment it leaves draft, with no
     flag and no escape, and `submitConsumerSend` refuses it first with no
     payment authorized. A declared value above
     PROTECTION_THRESHOLDS.securePickupMaxCents derives to protected handoff, so
     THAT threshold — not CONSUMER_MAX_DECLARED_VALUE_CENTS, which is the policy
     ceiling — is what a customer can actually buy today. Neither amount is
     written here; the page renders both figures from
     lib/couranr/consumer/protection.ts. */
  handoff_heading: "Built for accountable handoffs.",
  handoff_body: "Couranr records important pickup and delivery events so there is a clear record of the handoff.",
  /* MAIN CARRIES A WEAKER VERSION OF THIS SENTENCE, AND IT IS SUPERSEDED, NOT
     LOST. PR #82's 1b7e3efc rewrote it to "released at pickup against a
     confirmation step… confirmed and recorded at the door", on the reasoning
     that naming a code "promises something nothing gives them" because the
     routes issuing one existed only under /api/couranr/merchant and
     /api/couranr/operations, with no consumer surface showing it.

     That reasoning was correct on main and is FALSE on this branch. The
     recipient mints their own PIN from their own tracking link —
     app/api/couranr/track/[token]/dropoff-code/route.ts, rendered by
     components/couranr/tracking/TrackingPage.tsx — and the sender holds the
     pickup code in SendFlow. Both halves of the sentence are things a customer
     actually gets here, so the stronger wording is the accurate one. Restoring
     main's version would understate a capability that shipped, which is the
     same defect as overstating one, pointing the other way. */
  handoff_progressive: "Every Same Day delivery is released at pickup by a code the sender holds, and handed over against a code at the door. What the shipment is worth decides how much more Couranr does.",
  /* ENDS WHERE THE AMOUNT BEGINS — the page appends the figure derived from
     PROTECTION_THRESHOLDS. Same shape as SEND_COPY.declared_value_max_note and
     for the same reason: a number inside a sentence is a second place the
     threshold lives, and it goes stale without anything going red. */
  handoff_secure_pickup: "Secure pickup goes further: the Couranr driver photographs the item before it is packed, applies a numbered tamper-evident seal, photographs the sealed package, and confirms the sender\u2019s code last. Couranr applies it to every shipment declared above",
  /* Also ends where the amount begins. "Accepts today" rather than a policy
     ceiling, deliberately: while protected handoff is unavailable, what the
     policy permits and what a customer can submit are two different numbers,
     and a marketing page owes the second one. */
  handoff_declared_value: "You tell Couranr what a shipment is worth when you request it. Today Couranr Same Day accepts a declared value up to",
  handoff_declared_value_close: "If a shipment is worth more than that, Couranr says so before you pay and nothing is charged.",
  handoff_honesty: "Couranr documents what is presented and handed over. Couranr does not authenticate, appraise or certify merchandise.",

  workflow_headline: "A few details. Then Couranr handles the trip.",
  workflow_labels: [
    "Tell us where",
    "Tell us what you\u2019re sending",
    "Choose when",
    "Review your delivery and price",
    "Couranr confirms",
  ],
  price_headline: "See the price before you request.",
  price_body:
    "You review the delivery and its price before anything is requested. Couranr confirms availability, schedule and vehicle before any payment is captured.",

  /* Tracking. THIS BLOCK USED TO SAY Couranr held no recipient identity, had
     no channel to reach the recipient, and therefore gave the SENDER the link
     to keep or forward. Every clause of that is now false. `recipient_email`
     is REQUIRED — consumer/send.ts fails `recipient_email_required` without it
     — and lib/couranr/email/consumerLifecycle.ts emails the recipient their
     own tracking link, then emails them again when it is out for delivery and
     when it arrives. getConsumerSendView returns NO tracking token at all: the
     sender is told that the notification went out and to which address, which
     is what lets them catch a typo, and nothing more.

     SAY WHAT THE CUSTOMER GETS, NOT HOW IT IS ENFORCED. The reason the sender
     does not receive the link is that the recipient’s token authorizes the
     recipient’s own actions, and a forwarded screen would hand those to whoever
     received it. That is a correct reason and it does not belong on a marketing
     page; SendFlow explains it where the sender can act on it.

     Availability. The nine interaction states (idle/focused/typing/…) are a
     PRODUCT requirement for /send and stay enforced there; they were never
     marketing, and depicting internal UI state on a marketing page told a
     visitor nothing about whether Couranr could run their trip. */
  availability_headline: "Enter the addresses. Couranr checks the trip.",
  availability_body: "Add the pickup and destination in Same Day. Couranr checks the trip against the area it currently serves before you submit your request.",
  availability_cta: "Check a delivery",

  tracking_headline: "Follow it from confirmation to handoff.",
  tracking_body:
    "When the delivery is confirmed, Couranr emails your recipient their own private tracking, and tells you the address it went to. Pickup, movement and handoff are recorded as the delivery progresses.",
  tracking_labels: [
    "Confirmed",
    "Picked up",
    "Delivered",
  ],
  closing_headline: "One less trip to make.",
  closing_support: "Send something you have or let Couranr go pick it up.",
} as const;

/** PUB-004's direct-consumer mode at /send. */
export const SEND_COPY = {
  trip_send_origin: "Where is the item now?",
  trip_pickup_origin: "Where should we pick it up?",
  trip_pickup_hint: "Enter the address where the item will be collected.",
  trip_destination: "Where is it going?",
  item_question: "What are we delivering?",
  item_example: "A box of books I already bought from a local seller.",
  /* INT-002: the AI disclosure, shown at the START of the item step in live
     mode — before any description is read. Registry MKT-005 owns the text. */
  item_ai_disclosure:
    "Couranr uses AI to read this description and suggest your shipment details. You confirm everything before you pay, and Couranr — not the AI — sets the price and what can be carried.",
  readiness_question: "Is it ready for pickup?",
  readiness_yes: "Yes, they say it’s ready for pickup",
  readiness_no: "Not yet / I’m not sure",
  timing_question: "When do you need it?",
  timing_asap: "As soon as possible",
  timing_today: "Today",
  timing_schedule: "Schedule it",
  /* Shown for the ASAP choice. Scheduled timing is live on /send and on the
     merchant-hosted flow (TMZ-001), so `timing_schedule` renders a real
     choice; `timing_today` stays in the registry-locked set unrendered —
     ASAP before the cutoff IS today under HRS-001, not a separate intent. */
  timing_live_note: "Couranr picks up as soon as possible and confirms the exact timing with you after your request.",
  review_heading: "Here’s your delivery",
  contact_heading: "Where should we send updates?",
  /* A named recipient with an email is REQUIRED from V1 onward — send.ts
     refuses the request otherwise. It used to be optional, and a delivery could
     be created carrying no recipient identity at all; that is history now, and
     it is the reason Couranr can email the recipient their own tracking instead
     of handing the sender a link to forward. */
  recipient_heading: "Who is receiving this delivery?",
  declared_value_label: "What is this shipment worth?",
  declared_value_help:
    "Your own estimate of the total value, in dollars. Couranr uses it to decide how the "
    + "shipment is handled and photographed — it is not an appraisal, a valuation, or insurance.",
  /* The CEILING IS NOT WRITTEN HERE. MKT-005 forbids a price literal in copy —
     a number in a sentence is a second place the amount lives, and it goes
     stale silently. /send composes this with the ceiling read from
     CONSUMER_MAX_DECLARED_VALUE_CENTS, which is the same constant the server
     and the database derive from. */
  declared_value_max_note: "Couranr Same Day carries shipments declared up to",
  /* Shown when the value is inside policy but the tier it derives to cannot
     be bought yet. It names the product, never the provider — a customer
     has no use for the fact that an identity vendor is not switched on. */
  declared_value_unavailable_note:
    "Protected Handoff is not available yet. Couranr Same Day currently accepts "
    + "shipments with a declared value up to",
  /* Progressive disclosure. The sender is told what the declared value CHANGES
     about the handling, at the moment they enter it — not after they have paid. */
  /* TRUE OF THE CANONICAL PATH. This used to promise that the driver
     photographs the delivery at drop-off. Consumer Same Day uses proof_method
     'photo_or_pin', which routes to the recipient-PIN handoff — and that path
     takes no photograph at all. Promising evidence the system does not collect
     is worse than promising less, because the sender only finds out when they
     ask for it in a claim. */
  protection_standard:
    "Standard handling: your recipient confirms the handoff with a code they read to the driver.",
  protection_secure_pickup:
    "Secure pickup: the driver photographs the item before it is packed, applies a numbered "
    + "tamper-evident seal, photographs the sealed package, and confirms your pickup code last.",
  protection_protected_handoff:
    "Protected handoff: everything in secure pickup, plus the recipient verifies their identity "
    + "before the handoff. This shipment cannot be left at a door.",
  /* THE CLICKWRAP, and the reason it is worded this way.
     The server records `sender_terms_version` and `sender_terms_accepted_at`
     on every submitted request. Before this string said so, the recorded
     evidence was STRONGER THAN THE UI THAT GENERATED IT: a row asserted the
     sender had accepted a versioned document, and the sentence they actually
     ticked never named a document at all. What is recorded and what was shown
     are now the same statement.
     NO HREF LIVES HERE. MKT-005 stores words, never destinations
     (`routes_excluded`), and the parity test refuses a path or a URL inside
     any locked string. `SendFlow` renders the two documents as real links
     beside this checkbox, titled and versioned from
     `lib/couranr/legal/registry.ts` — the one module that owns a version —
     so the name in this sentence and the document behind the link cannot
     become two different things. */
  acknowledgement:
    "I confirm that I am 18 or older, that I am authorized to send or collect these items, "
    + "that the recipient is 18 or older, and that the shipment description, quantity and "
    + "declared value are accurate. I agree to Couranr’s Same Day Shipment Terms and "
    + "Prohibited and Restricted Items Policy.",
  electronic_consent:
    "I agree to conduct this transaction electronically and to receive Couranr records and "
    + "notices by email.",
  /* The lead-in above the two document links. The documents are presented
     BEFORE the checkboxes, because a clickwrap whose documents are only
     reachable from a footer asks for agreement to something the sender was
     never offered. */
  legal_read_first:
    "Read these before you accept. Couranr records the version you accept with your shipment.",
  received_heading: "We have your request.",
  received_support: "Couranr is confirming your delivery.",
} as const;

/** Master and consumer chrome labels. */
export const PUBLIC_CHROME_COPY = {
  same_day: "Same Day",
  for_business: "For Business",
  business_sign_in: "Business sign in",
  track_a_delivery: "Track a delivery",
  start_a_delivery: "Start a delivery",
} as const;

/** Every locked string, flattened — what the parity test walks. */
export const MKT_005_COPY = {
  master: MASTER_COPY,
  same_day: SAME_DAY_COPY,
  send: SEND_COPY,
  chrome: PUBLIC_CHROME_COPY,
} as const;
