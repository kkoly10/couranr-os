/**
 * The customer-readable text of the V1 legal/policy DRAFTS.
 *
 * WHY THE PROSE IS DATA AND NOT JSX. Three reasons, in order of weight:
 *
 *   1. EVERY MONEY FIGURE IS COMPOSED, NEVER TYPED. The declared-value ceiling
 *      and the two protection thresholds are built here from
 *      `CONSUMER_MAX_DECLARED_VALUE_CENTS` and `PROTECTION_THRESHOLDS` — the
 *      same constants the server derives from and the database re-derives in
 *      SQL. `tests/couranr-legal-documents.test.ts` fails on a literal dollar
 *      figure anywhere in this directory or in the legal routes, so the only
 *      way a number reaches a customer is through the authority.
 *   2. The text is assertable. A test can read the rendered words — that the
 *      counsel-review notice is on every document, that the recipient-PIN
 *      paragraph says the PIN does not end a claim — without rendering React.
 *   3. One renderer serves five documents, so a section cannot acquire a
 *      heading level, an anchor or a version footer that its siblings lack.
 *
 * TONE. Plain customer English. Short sentences, second person, no defined
 * terms in capitals, no cross-references by section number. A sender standing
 * at their door with a driver in front of them should be able to read any one
 * paragraph and know what it means.
 *
 * ACCURACY OVER COMPLETENESS. Every operational sentence below describes
 * behaviour that exists in the code or the applied migrations today. Where a
 * capability is built but not switched on — recipient identity verification is
 * the live example — the document says so rather than describing a promise the
 * system cannot keep. Where a legal term has not been reviewed, the document
 * says it is open rather than inventing one.
 */

import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_THRESHOLDS,
  declaredValueDollars,
} from "@/lib/couranr/consumer/protection";
import {
  PROHIBITED_CLASSES,
  type ProhibitedClass,
} from "@/lib/couranr/shipment/facts";
import { ACKNOWLEDGEMENT_VERSIONS } from "@/lib/couranr/activation/states";
import {
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENTS,
  type LegalDocumentId,
} from "@/lib/couranr/legal/registry";

/* ------------------------------------------------------------- the shape -- */

export type LegalBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: readonly string[] };

export type LegalSection = {
  /** Stable anchor id. Changing one breaks a link somebody has saved. */
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
};

const p = (text: string): LegalBlock => ({ kind: "text", text });
const ul = (items: readonly string[]): LegalBlock => ({ kind: "list", items });

/* ----------------------------------------------------------- the figures -- */

/**
 * Composed, never typed. `declaredValueDollars` renders exact cents and never
 * rounds, so these read as the authority states them: the band boundary is
 * "the highest value still in this band", which is why the copy below says
 * "more than" rather than restating a second number.
 */
const MAX_DECLARED = declaredValueDollars(CONSUMER_MAX_DECLARED_VALUE_CENTS);
const STANDARD_TOP = declaredValueDollars(PROTECTION_THRESHOLDS.standardMaxCents);
const SECURE_TOP = declaredValueDollars(PROTECTION_THRESHOLDS.securePickupMaxCents);

/* ------------------------------------------- the prohibited-class labels -- */

/**
 * Plain English for every machine value in `PROHIBITED_CLASSES`.
 *
 * TYPED AS A TOTAL RECORD ON PURPOSE. A new prohibited class added to the
 * shipment authority fails the typecheck here until somebody writes the words a
 * customer will read, rather than silently shipping a policy that omits it.
 * `tests/couranr-legal-documents.test.ts` asserts the same thing at runtime, in
 * both directions, because `tsconfig` sets `"strict": false`.
 */
const PROHIBITED_LABELS: Record<ProhibitedClass, string> = {
  alcohol: "Alcohol",
  tobacco: "Tobacco",
  vaping_nicotine: "Vaping products and nicotine",
  cannabis_thc: "Cannabis and THC products",
  firearms: "Firearms",
  ammunition: "Ammunition",
  prescription_medication: "Medication that requires a prescription",
  controlled_substances: "Controlled substances",
  fuel: "Fuel",
  compressed_gas: "Compressed gas, including cylinders and canisters",
  corrosive_hazmat: "Corrosive materials",
  toxic_hazmat: "Toxic materials",
  infectious_material: "Infectious material",
  regulated_dangerous_goods: "Anything else classed as regulated dangerous goods",
  fireworks: "Fireworks",
  explosives: "Explosives",
  illegal_goods: "Anything illegal to possess or to move",
  stolen_goods: "Stolen goods",
  cash: "Cash",
  negotiable_instruments:
    "Negotiable instruments, such as cheques made out to cash, money orders and bearer bonds",
  biological_specimens: "Biological specimens",
  live_animals: "Live animals",
  people: "People",
};

export const PROHIBITED_ITEM_LINES: readonly string[] =
  PROHIBITED_CLASSES.map((c) => PROHIBITED_LABELS[c]);

/* ----------------------------------------------------- 1. Terms of Use --- */

const TERMS_OF_USE: readonly LegalSection[] = [
  {
    id: "what-this-covers",
    heading: "What this covers",
    blocks: [
      p(
        "These terms cover using Couranr and asking Couranr to carry something for you. "
        + "They apply to everyone who uses the site, books a delivery, or follows a Couranr "
        + "tracking link."
      ),
      p(
        "Some things have their own document, because they carry their own rules and their "
        + "own version. Those documents sit alongside this one and are listed on the Couranr "
        + "legal page."
      ),
    ],
  },
  {
    id: "who-may-use-couranr",
    heading: "Who may use Couranr",
    blocks: [
      p(
        "You must be 18 or older to book a delivery. The person receiving a delivery must also "
        + "be 18 or older."
      ),
      p(
        "The details you give Couranr have to be accurate: the addresses, what is in the "
        + "package, who is receiving it, and how to reach you. Couranr acts on what you tell it."
      ),
    ],
  },
  {
    id: "what-couranr-is",
    heading: "What Couranr does, and what it does not do",
    blocks: [
      p(
        "Couranr moves a package from one local address to another and records what happened "
        + "along the way."
      ),
      p(
        "Couranr does not sell, inspect, authenticate, appraise, test or repair anything it "
        + "carries. A driver photographs what is handed to them. A photograph shows what was "
        + "handed over. It is not a statement that an item is genuine, working, or worth what "
        + "anyone says it is worth."
      ),
    ],
  },
  {
    id: "requests-and-confirmation",
    heading: "Asking for a delivery is not the same as having one",
    blocks: [
      p(
        "Sending a request is not the same as having a confirmed delivery. Couranr confirms "
        + "it, and until it does, nothing is scheduled. Couranr can decline a request, and "
        + "will say so."
      ),
      p(
        "Couranr can also refuse a package at the door if what is presented is not what was "
        + "described, or if carrying it would break the prohibited and restricted items policy."
      ),
    ],
  },
  {
    id: "tracking-links",
    heading: "Tracking and help links",
    blocks: [
      p(
        "Couranr sends a link for following a delivery and for getting help with it. That link "
        + "is the key to the delivery. Anyone who has the link can see the delivery and act on "
        + "the page, so treat it the way you would treat a door key and do not forward it to "
        + "anyone who should not have it."
      ),
    ],
  },
  {
    id: "paying",
    heading: "Paying",
    blocks: [
      p(
        "Couranr shows you the price for your delivery before you accept it, and you pay for "
        + "the delivery you accepted. Card details go to Couranr's payment processor. Couranr "
        + "does not store your card number."
      ),
    ],
  },
  {
    id: "versions",
    heading: "When these documents change",
    blocks: [
      p(
        "Each Couranr document carries a version, printed at the top of the page. When the "
        + "text changes, the version changes with it. Where Couranr records that you accepted "
        + "a document, it records which version you were shown."
      ),
    ],
  },
];

/* --------------------------------------- 2. Same Day Shipment Terms ------ */

const SAME_DAY_SHIPMENT_TERMS: readonly LegalSection[] = [
  {
    id: "who-this-is-for",
    heading: "Who this is for",
    blocks: [
      p(
        "This is the document you accept when you send a Couranr Same Day shipment. It says "
        + "what you are telling Couranr, what Couranr does with your package, and what the "
        + "evidence Couranr collects does and does not mean."
      ),
      p(
        "When you accept it, Couranr stores the version shown at the top of this page against "
        + "your shipment, so there is a record of exactly which text you were shown."
      ),
    ],
  },
  {
    id: "age-and-authority",
    heading: "Age, and the right to send the item",
    blocks: [
      p("You must be 18 or older to send a shipment."),
      p(
        "The person receiving it must also be 18 or older, and confirms that themselves before "
        + "the delivery. This is true of every Couranr shipment, not only the high-value ones: "
        + "Couranr cannot complete a delivery until that confirmation is on the record."
      ),
      p(
        "You must own what you are sending, or have the owner's permission to send it. By "
        + "booking, you are telling Couranr that you do."
      ),
    ],
  },
  {
    id: "declared-value",
    heading: "The value you declare",
    blocks: [
      p(
        `You tell Couranr what the whole shipment is worth. The most you may declare is `
        + `${MAX_DECLARED}, and that is the total for everything in the shipment, not the `
        + `price of one item in it. Couranr does not accept a shipment declared above that.`
      ),
      p(
        "The figure you give is your own statement about your own property. Couranr uses it "
        + "for one thing: deciding how carefully the shipment has to be handled and "
        + "photographed."
      ),
      p(
        "It is not insurance. It is not a guarantee that Couranr will pay you that amount if "
        + "something goes wrong. It is not an appraisal or a valuation, and Couranr never "
        + "treats it as one."
      ),
      p(
        "Couranr does not authenticate, appraise or test anything it carries. Nobody at "
        + "Couranr opens an item to check that it is genuine, that it is the model you named, "
        + "or that it works."
      ),
    ],
  },
  {
    id: "handling-bands",
    heading: "What your declared value changes",
    blocks: [
      p("The value you declare decides how the pickup and the handoff are run."),
      ul([
        `Up to ${STANDARD_TOP}: standard handling. Your recipient confirms the handoff with a `
          + `code they read to the driver.`,
        `More than ${STANDARD_TOP}: Secure Pickup. The extra steps below happen at your door.`,
        `More than ${SECURE_TOP}: Protected Handoff. Everything in Secure Pickup, plus the `
          + `recipient verifies their identity before the package changes hands, and the `
          + `package can never be left at a door.`,
      ]),
      /* THIS DESCRIBED THE FUNNEL AS IT WAS. It said such a request "can be
         priced and saved but Couranr will not confirm it", which was true when
         the only refusal sat at submit. The declared value is now refused the
         moment it is entered, before any price is calculated and before
         anything is stored — so the old sentence both overstated how far a
         sender could get and contradicted /policy/delivery, which says the
         value is refused at entry. Two public documents, one rule, opposite
         statements.

         Safe to correct in place rather than behind a new version: no request
         in production carries a sender_terms_version at all, so no recorded
         acceptance points at the superseded wording. */
      p(
        `Couranr cannot take a Protected Handoff shipment today. Recipient identity `
        + `verification is built but not switched on, so a request that declares more than `
        + `${SECURE_TOP} is refused as soon as the value is entered — before Couranr `
        + `calculates a price and before anything is saved. Couranr would rather refuse `
        + `the shipment than run a handoff it promised to check and cannot.`
      ),
    ],
  },
  {
    id: "secure-pickup",
    heading: "Secure Pickup: what happens at your door",
    blocks: [
      p("Above the standard band, the pickup runs in a fixed order, and the order is the point."),
      ul([
        "The driver photographs the item before it goes into its outer packaging.",
        "You pack it, in front of the driver, once that photograph has been taken.",
        "The driver puts a numbered tamper-evident seal on the package and photographs the "
          + "sealed package with the seal visible.",
        "Only then do you give the driver your pickup code.",
      ]),
      p(
        "You do not have to open packaging the item came in from its manufacturer. If it is "
        + "still in its factory box, the driver photographs it as it is. The photograph records "
        + "what was handed over, and Couranr does not claim it records anything about what is "
        + "sealed inside a box Couranr never opened."
      ),
      p(
        "One seal belongs to one delivery. Couranr will not record a second seal for the same "
        + "delivery, so there is never a question about which seal the driver checked."
      ),
    ],
  },
  {
    id: "pickup-code",
    heading: "What your pickup code means",
    blocks: [
      p(
        "Your pickup code is yours. You give it to the driver at the end of the pickup, after "
        + "the photographs are taken and the seal is on."
      ),
      p(
        "Because it comes last, giving it means something specific: you are confirming that the "
        + "package that was documented and sealed in front of you is the package you are "
        + "handing over. On a standard shipment it means the simpler thing, that you handed the "
        + "package to the driver who came for it."
      ),
      p(
        "Do not give the code to anyone before the pickup, and do not send it in a message. A "
        + "driver who has the code before the package is documented has skipped the part that "
        + "protects you."
      ),
    ],
  },
  {
    id: "the-handoff",
    heading: "At the other end",
    blocks: [
      p(
        "Your recipient must be 18 or older, and confirms that themselves before the delivery. "
        + "Couranr cannot complete the delivery until that confirmation is recorded, on every "
        + "shipment and not only the high-value ones."
      ),
      p(
        "On a Protected Handoff, the recipient also verifies their identity through an "
        + "identity-verification provider before the package changes hands. Couranr keeps the "
        + "result of that check and the provider's reference for it. Couranr does not keep "
        + "images of the identity documents."
      ),
      p(
        "Where a seal was applied, the driver looks at it at the door, photographs it, and "
        + "records whether it is intact, damaged or missing. That record cannot be revised "
        + "afterwards. A damaged or missing seal opens an incident with Couranr Operations "
        + "automatically, and it does not stop the handoff: leaving a recipient without their "
        + "package would give the one person holding it a reason to report a seal as intact."
      ),
    ],
  },
  {
    id: "recipient-pin",
    heading: "The recipient's PIN, and what it proves",
    blocks: [
      p(
        "Your recipient gets a PIN and reads it to the driver at the door. It is how Couranr "
        + "records that the package reached the person who was expecting it, at that moment."
      ),
      p(
        "That is all it is. A PIN is evidence of a handoff. It is not you agreeing that "
        + "everything was fine, and it does not end your right to report damage or loss. If the "
        + "package arrives damaged, or something is missing from it, the PIN does not take that "
        + "claim away."
      ),
    ],
  },
  {
    id: "honesty",
    heading: "Honesty, both ways",
    blocks: [
      p(
        "Couranr's evidence only works if what goes into it is true. Deliberately declaring "
        + "something you are not sending, agreeing with your recipient to report a problem that "
        + "did not happen, or changing a photograph or a record before giving it to Couranr, "
        + "can affect what Couranr does with a claim, as far as the law allows."
      ),
      p(
        "This cuts the other way too. A mistake is not fraud. A blurry photograph is not fraud. "
        + "Couranr looks at what happened before it decides anything."
      ),
    ],
  },
  {
    id: "claims-stay-open",
    heading: "A real claim stays reviewable",
    blocks: [
      p(
        "Nothing in this document takes away your ability to report a genuine problem and have "
        + "Couranr look at it. If your package was damaged, went missing, or never arrived, "
        + "report it and Couranr will review it against the evidence it holds."
      ),
      p(
        "How a claim is filed, and what evidence Couranr keeps, is set out in Claims and Loss."
      ),
    ],
  },
];

/* ------------------------------- 3. Prohibited and Restricted Items ------ */

const PROHIBITED_ITEMS: readonly LegalSection[] = [
  {
    id: "what-couranr-will-not-carry",
    heading: "What Couranr will not carry",
    blocks: [
      p(
        "This list is closed. If what you are sending falls into one of these, Couranr will not "
        + "carry it, whatever else is true about the shipment."
      ),
      ul(PROHIBITED_ITEM_LINES),
    ],
  },
  {
    id: "how-couranr-decides",
    heading: "How Couranr decides",
    blocks: [
      p(
        "You tell Couranr whether any of the above is in your shipment. Three answers are "
        + "possible, and they lead to three different places."
      ),
      ul([
        "None of them: your request can be quoted and go ahead in the ordinary way.",
        "One of them: the shipment is refused.",
        "Not sure, or not answered: a person at Couranr reviews the request before anything "
          + "else happens. Not answering is treated exactly like saying you are not sure.",
      ]),
      p(
        "Couranr also reads your own description of the item, and uses AI to help it spot "
        + "wording that looks like something on this list. Nothing Couranr's software thinks "
        + "can prohibit a shipment on its own. It can only send the request to a person to "
        + "look at. A prohibition always comes from a confirmed answer, never from a hunch."
      ),
    ],
  },
  {
    id: "at-the-door",
    heading: "At the door",
    blocks: [
      p(
        "A driver can refuse a package at pickup if what is in front of them is not what was "
        + "described, or if carrying it would be unsafe or against this policy. Where that "
        + "happens, Couranr Operations decides what happens next."
      ),
    ],
  },
  {
    id: "value-ceiling",
    heading: "Value has a ceiling too",
    blocks: [
      p(
        `Couranr does not carry a shipment declared above ${MAX_DECLARED} in total. That is a `
        + `limit on the whole shipment, not on each item in it, and it is refused at the point `
        + `you enter it rather than discovered at your door.`
      ),
    ],
  },
  {
    id: "merchant-acknowledgement",
    heading: "If you run a business account",
    blocks: [
      p(
        "Businesses activating a Couranr account accept a prohibited-items acknowledgement as "
        + `part of activation, recorded at version ${ACKNOWLEDGEMENT_VERSIONS.prohibited_items}. `
        + "That acknowledgement predates this page. Bringing the two onto one version is open "
        + "work, and until it is done, a business account's recorded acknowledgement and this "
        + "page carry different version strings."
      ),
    ],
  },
];

/* ------------------------------------------------------ 4. Privacy ------- */

const PRIVACY: readonly LegalSection[] = [
  {
    id: "what-couranr-collects",
    heading: "What Couranr collects to move a shipment",
    blocks: [
      p("Couranr collects what it needs to pick a package up and put it down again."),
      ul([
        "Your name and email address, and your phone number if you give one.",
        "The pickup address and the drop-off address.",
        "Your recipient's name and email address, and their phone number if you give one.",
        "What you say is in the package, and the value you declare for it.",
        "Photographs the driver takes at pickup and at the door, including the seal where one "
          + "is used, and the seal's number.",
        "The times each step happened, and which driver did it.",
        "Ordinary technical records from your use of the site, such as request logs.",
      ]),
      p(
        "Email is the channel Couranr uses for the things that matter: your confirmation, your "
        + "tracking link, and anything to do with a later claim. That is why Couranr asks for "
        + "it rather than treating it as optional."
      ),
      p(
        "Sending a Same Day shipment does not create an account and does not ask you for a "
        + "password."
      ),
    ],
  },
  {
    id: "who-can-see-it",
    heading: "Who can see it",
    blocks: [
      p(
        "Couranr staff who are working on your delivery, and the driver assigned to it, can see "
        + "what they need to do the job."
      ),
      p(
        "Anyone holding your tracking or help link can see that delivery. The link is the "
        + "access, so forwarding it gives someone else the same view you have."
      ),
      p("Delivery photographs are stored privately and are not published anywhere."),
    ],
  },
  {
    id: "identity-verification",
    heading: "Identity verification",
    blocks: [
      p(
        "Where a shipment needs the recipient to verify their identity, that check is run by an "
        + "identity-verification provider, not by Couranr. Couranr keeps the outcome and the "
        + "provider's reference for it. Couranr does not receive or store images of identity "
        + "documents."
      ),
      p("This check is not switched on today."),
    ],
  },
  {
    id: "payment-data",
    heading: "Payment details",
    blocks: [
      p(
        "Card details go to Couranr's payment processor and are handled by them. Couranr does "
        + "not store your card number."
      ),
    ],
  },
  {
    id: "photos-you-send",
    heading: "Photographs you send with a problem report",
    blocks: [
      p(
        "If you report a problem with a delivery, you can attach photographs. Those are stored "
        + "privately with the report and are seen by the Couranr staff reviewing it."
      ),
    ],
  },
];

/* --------------------------------------------------- 5. Claims and Loss -- */

const CLAIMS_AND_LOSS: readonly LegalSection[] = [
  {
    id: "how-to-report",
    heading: "How to report a problem",
    blocks: [
      p(
        "Open the help page from your delivery's Couranr link and report the problem there. "
        + "That page belongs to that delivery, so the report arrives already attached to the "
        + "right one."
      ),
      p("There are four things you can report:"),
      ul([
        "The package arrived damaged.",
        "Something is missing from it.",
        "The wrong item arrived.",
        "It never arrived at all.",
      ]),
      p("You can add up to five photographs, each up to 10 MB, and describe what happened."),
    ],
  },
  {
    id: "what-happens-next",
    heading: "What happens after you report it",
    blocks: [
      p("A report moves through a fixed set of states, and you can see where yours is."),
      ul([
        "Reported: Couranr has it.",
        "Awaiting evidence: Couranr has asked you for something, usually a photograph.",
        "Under review: a person at Couranr is working through it.",
        "Resolved: Couranr has reached an answer and told you what it is.",
      ]),
      p("One open report at a time per delivery, so nothing is reviewed twice by accident."),
    ],
  },
  {
    id: "evidence-couranr-holds",
    heading: "What Couranr already holds",
    blocks: [
      p(
        "You do not have to prove everything yourself. Couranr keeps its own record of the "
        + "delivery and reviews a claim against it."
      ),
      ul([
        "Photographs taken at pickup, and where the shipment was handled securely, the "
          + "photograph of the item before packing and of the sealed package.",
        "The seal's number, and its condition at the door, photographed and recorded at the "
          + "moment the driver saw it.",
        "The recipient's PIN confirmation, or the delivery photograph, depending on how the "
          + "handoff was made.",
        "The time of every step, and which driver carried it out.",
      ]),
      p(
        "A seal recorded as damaged or missing opens an incident with Couranr Operations by "
        + "itself. It does not depend on a driver choosing to mention it."
      ),
    ],
  },
  {
    id: "pin-does-not-close-a-claim",
    heading: "A completed handoff does not close a claim",
    blocks: [
      p(
        "Your recipient reading the PIN to the driver records that the package reached them. "
        + "It does not record that the contents were fine, and it does not end your ability to "
        + "report damage or loss afterwards."
      ),
    ],
  },
  {
    id: "declared-value-and-claims",
    heading: "What the value you declared does here",
    blocks: [
      p(
        "The value you declared decided how your shipment was handled and photographed. It is "
        + "your own statement about your own property, and it is not insurance."
      ),
      p(
        "What Couranr pays on a claim, and what part your declared value plays in that, is not "
        + "written in this draft. It is one of the points below that has not been through legal "
        + "review, and Couranr will not put a number here before it has been."
      ),
    ],
  },
  {
    id: "false-claims",
    heading: "Claims that are not genuine",
    blocks: [
      p(
        "Reporting a problem that did not happen, arranging one with your recipient, or "
        + "altering evidence before sending it, can affect how Couranr handles a claim, as far "
        + "as the law allows."
      ),
      p(
        "A genuine claim stays reviewable. Getting a detail wrong is not the same as making a "
        + "claim up, and Couranr looks at what happened before deciding anything."
      ),
    ],
  },
];

/* ------------------------------------------------------------ the table -- */

export const LEGAL_SECTIONS: Readonly<Record<LegalDocumentId, readonly LegalSection[]>> = {
  "terms-of-use": TERMS_OF_USE,
  "same-day-shipment-terms": SAME_DAY_SHIPMENT_TERMS,
  "prohibited-items": PROHIBITED_ITEMS,
  privacy: PRIVACY,
  "claims-and-loss": CLAIMS_AND_LOSS,
};

export function legalSections(id: LegalDocumentId): readonly LegalSection[] {
  return LEGAL_SECTIONS[id];
}

/**
 * The whole document as one string: headings, paragraphs and list items, in
 * order. What a test reads, and what a future search index would read. Built
 * from the same structure the page renders, so it cannot describe a document
 * the page does not show.
 */
export function legalDocumentText(id: LegalDocumentId): string {
  const meta = LEGAL_DOCUMENTS[id];
  const parts: string[] = [meta.title, meta.summary];
  for (const section of LEGAL_SECTIONS[id]) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "text") parts.push(block.text);
      else parts.push(...block.items);
    }
  }
  return parts.join("\n");
}

/** Every document's text, for scans that must cover the whole set. */
export function allLegalDocumentText(): string {
  return LEGAL_DOCUMENT_IDS.map((id) => legalDocumentText(id)).join("\n");
}
