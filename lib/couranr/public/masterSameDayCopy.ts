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
  hero_headline: "Local delivery, built around you.",
  hero_support: "Need one local delivery? Use Couranr Same Day. Run a business that wants to offer delivery to customers? Couranr for Business gives you the delivery operation behind it.",
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

     NO "View Prohibited & Restricted Items Policy" CTA. The brief asks for one
     and says to take its destination from the legal registry rather than
     typing a URL — but `lib/legal.ts` carries two effective dates and no such
     document, and no canonical screen owns that route. The choices were a link
     to nothing, a link to the LEGACY multi-product /terms page, or no link.
     The rendered category summary already answers "what can I not send?"
     completely, so the CTA waits for the policy document to exist. */
  prohibited_heading: "Some things shouldn\u2019t travel with Couranr.",
  prohibited_body: "For safety, legal and insurance reasons, Couranr does not transport certain regulated, hazardous or unusually high-risk items.",
  prohibited_help: "Not sure about your item? Describe it when you request the delivery. Couranr checks whether it can be accepted before you pay.",

  /* Accountable handoffs. Every sentence here describes evidence the shipped
     pickup/drop-off implementation actually records (PRF-001: pickup
     confirmation, and one of recipient PIN, photo or signature at drop-off).
     Value-tiered custody — declared-value ceilings, numbered tamper-evident
     seals, recipient identity verification — is NOT described, because it is
     not in this build. Adding those sentences before that work ships would be
     a protection claim Couranr cannot honour. */
  handoff_heading: "Built for accountable handoffs.",
  handoff_body: "Couranr records important pickup and delivery events so there is a clear record of the handoff.",
  handoff_progressive: "A delivery is picked up against a confirmation step, and handed over using the method chosen for that delivery \u2014 a recipient code, a photo at the door, or a signature.",
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

  /* Availability. The nine interaction states (idle/focused/typing/…) are a
     PRODUCT requirement for /send and stay enforced there; they were never
     marketing, and depicting internal UI state on a marketing page told a
     visitor nothing about whether Couranr could run their trip. */
  availability_headline: "Enter the addresses. Couranr checks the trip.",
  availability_body: "Add the pickup and destination in Same Day. Couranr checks the trip against the area it currently serves before you submit your request.",
  availability_cta: "Check a delivery",

  tracking_headline: "Follow it from confirmation to handoff.",
  tracking_body:
    "Couranr gives the recipient a private tracking experience after the delivery is confirmed. Pickup, movement and secure handoff are recorded as the delivery progresses.",
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
  trip_pickup_hint: "Search for the business or enter its address.",
  trip_destination: "Where is it going?",
  item_question: "What are we delivering?",
  item_example: "A birthday cake I already paid for at Main Street Bakery.",
  /* INT-002: the AI disclosure, shown at the START of the item step in live
     mode — before any description is read. Registry MKT-005 owns the text. */
  item_ai_disclosure:
    "Couranr uses AI to read this description and suggest your shipment details. You confirm everything before you pay, and Couranr — not the AI — sets the price and what can be carried.",
  readiness_question: "Is it ready for pickup?",
  readiness_yes: "Yes, the business says it’s ready",
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
  acknowledgement: "I confirm this item is eligible for delivery and I have authority to send or collect it.",
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
