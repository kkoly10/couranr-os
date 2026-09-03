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
  hero_support: "Whether you’re sending something across town or adding delivery to your business, Couranr handles the trip.",
  consumer_door_title: "Send something",
  consumer_door_support: "For individuals who need something delivered locally.",
  business_door_title: "Add delivery to my business",
  business_door_support: "Your customers order from you. Couranr handles delivery.",
  network_heading: "One local delivery network. Two ways to use it.",
  network_individuals: "You already own it, bought it, or need it picked up. Couranr moves it.",
  network_businesses: "Your customers order from you. Couranr handles delivery.",
} as const;

/** PUB-013, Couranr Same Day. */
export const SAME_DAY_COPY = {
  hero_headline: "Need it across town today?",
  hero_support: "Send something you have, or have Couranr pick something up for you.",
  hero_question: "What do you need?",
  intent_send_title: "Send something I have",
  intent_send_support: "From me, my home, work, a friend or family member.",
  intent_pickup_title: "Pick something up for me",
  intent_pickup_support: "Something you’ve already bought, ordered or arranged.",
  already_bought_headline: "Already bought it? We’ll go get it.",
  already_bought_body: "Your dry cleaning is ready. The cake is finished. Your print order is waiting. You bought something from a local shop.",
  already_bought_close: "Couranr can pick it up and bring it to you.",
  already_bought_cta: "Pick something up",
  send_what_you_have_headline: "Sometimes the thing is already with you.",
  send_what_you_have_body: "Keys left at home. Documents someone needs. A gift for a friend. Something your family forgot.",
  send_what_you_have_close: "You don’t have to make the trip yourself.",
  send_what_you_have_cta: "Send something",
  breadth_headline: "The local trips that steal your time.",
  breadth_labels: [
    "Keys",
    "Documents",
    "Gifts",
    "Finished orders",
    "Store purchases",
    "Dry cleaning",
    "Bakery orders",
    "Personal items",
  ],
  workflow_headline: "A few details. Then Couranr handles the trip.",
  workflow_labels: [
    "Tell us where",
    "Tell us what",
    "Choose when",
    "Review your quote",
    "Couranr confirms",
  ],
  price_headline: "See the price before you request.",
  tracking_headline: "Know what’s happening after pickup.",
  tracking_labels: [
    "Confirmed",
    "Picked up",
    "Delivered",
  ],
  closing_headline: "One less trip to make.",
  closing_support: "Send something you have or let Couranr go pick it up.",
  price_body:
    "You review the delivery and its price before anything is requested. Couranr confirms availability, schedule and vehicle before any payment is captured.",
  tracking_body:
    "Couranr sends the recipient a private tracking link when the delivery is confirmed. It is the only way the delivery can be opened.",
  /**
   * consumer-availability. The work order asks PUB-013 to "present the full
   * address/availability interaction story" and NAMES its nine states. The
   * section shipped as two prose paragraphs that described checking without
   * depicting any of them, so the requirement was not met.
   *
   * Three parallel arrays rather than an array of objects, because the MKT-005
   * parity test walks strings and arrays of strings — a nested object per state
   * would flatten into keys the registry and the module would have to agree on
   * one by one. A test asserts all three are the same length.
   *
   * No address is invented and no boundary is drawn: SVC-002 is UNRESOLVED, so
   * "eligible" says Couranr can run the trip and "review-needed" says the
   * address is captured, never that it is out of area.
   */
  availability_headline: "Tell Couranr where, and it checks.",
  availability_state_order: [
    "idle",
    "focused",
    "typing",
    "suggestions",
    "selected",
    "checking",
    "eligible",
    "review-needed",
    "error",
  ],
  availability_state_labels: [
    "Idle",
    "Focused",
    "Typing",
    "Suggestions",
    "Selected",
    "Checking",
    "Eligible",
    "Review needed",
    "Error",
  ],
  availability_state_captions: [
    "The pickup and destination fields, waiting for you.",
    "You tap one. Couranr is ready for the address.",
    "You start typing. Nothing is submitted yet.",
    "Matching addresses appear as you type.",
    "You choose the one you meant, and it fills in.",
    "Couranr checks the trip against the area it operates in.",
    "Couranr can run this trip. You carry on to the next step.",
    "Couranr captures the address for review. Nothing is turned away at the door.",
    "Something did not load. You can try again without losing what you entered.",
  ],
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
  /* Live V1 is ASAP only; Couranr confirms the exact timing after the
     request. Scheduled consumer timing is deferred, so live mode never
     renders a choice the backend would ignore. */
  timing_live_note: "Couranr picks up as soon as possible and confirms the exact timing with you after your request.",
  review_heading: "Here’s your delivery",
  contact_heading: "Where should we send updates?",
  acknowledgement: "I confirm this item is eligible for delivery and I have authority to send or collect it.",
  production_stop: "Same Day ordering isn’t live yet.",
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
