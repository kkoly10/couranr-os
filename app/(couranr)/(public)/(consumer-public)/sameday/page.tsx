import type { Metadata } from "next";
import Link from "next/link";
import { SAME_DAY_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { MARKETS_PUBLIC_COPY_NEUTRAL } from "@/lib/couranr/public/governed";
import { PROHIBITED_GROUPS, groupLabels } from "@/lib/couranr/public/prohibitedSummary";
import { routeForScreen } from "@/lib/couranr/navigation";

/**
 * PUB-013 — Couranr Same Day, at `/sameday`.
 *
 * The consumer entry path MKT-004 added. TWELVE governed regions since the
 * 2026-09 marketing-architecture lock, and the contract's floors are the
 * inverse of the business family's: three image-led sections and a product
 * proof are REQUIRED, because a page asking a person to hand over something
 * they own has to show the handover rather than describe it.
 *
 * WHAT THE LOCK CHANGED, and why each is a decision rather than a reshuffle:
 *   - a COMPACT business cross-link at §2. The separation between Same Day and
 *     For Business is PURPOSE, never speed, and a person who owns a business
 *     and needs one personal trip belongs here. Compact on purpose — the brief
 *     says not to make it a giant visual section.
 *   - §5 states the trips as example GROUPS with an explicit disclaimer, in
 *     place of a bare list of nouns that read as an eligibility promise.
 *   - §6 is new and says what Couranr will NOT carry. Its categories are
 *     rendered from `PROHIBITED_CLASSES` through `prohibitedSummary`, the same
 *     vocabulary the policy engine and `/send` enforce. Nothing here types a
 *     category name; a second list is exactly the drift the brief bans.
 *   - §7 is new and describes the handoff EVIDENCE THIS BUILD RECORDS. Nothing
 *     more. See the note on that section.
 *   - §10 no longer depicts the nine internal address-interaction states. They
 *     remain a PRODUCT requirement on `/send` and are untouched there; on a
 *     marketing page they told a visitor nothing about whether Couranr could
 *     run their trip.
 *
 * WHAT THIS PAGE MUST NOT DO, unchanged:
 *   - no fake price. `consumer-price` states when the price appears, not what
 *     it is.
 *   - no live tracking data. `consumer-tracking` is a product story.
 *   - no marketplace, catalogue, menu or storefront — MKT-004's consumer
 *     guardrail. For collection the item is already bought elsewhere.
 *   - no generic consumer sign-in. Customer accounts are optional at MVP.
 *   - no radius, ZIP eligibility or polygon: SVC-002 is UNRESOLVED.
 *
 * Every string comes from `SAME_DAY_COPY` (MKT-005) or from the derived
 * prohibition summary; every destination from the screen source. The market
 * sentence is MKT-006's consumer-neutral one, imported not typed — MKT-001's
 * begins "Local BUSINESS delivery across …", which is the wrong product to
 * describe to a person on this page.
 */

export const metadata: Metadata = {
  title: "Couranr Same Day — local delivery, today",
  description: SAME_DAY_COPY.hero_support,
};

const IMG = "/images/marketing/2026-08/w";

export default function Page() {
  const send = routeForScreen("PUB-004");
  const business = routeForScreen("PUB-001");
  const sendIntent = (intent: "send" | "pickup") => `${send}?intent=${intent}`;

  return (
    <div className="cr-mkt">
      {/* ─── 1 ──────────────────────────── sameday-hero / split-story ─── */}
      {/* Mobile requirement from the contract: the headline AND both intent
          actions appear before the image takes the next scroll region, so the
          image follows the actions in source order and only moves beside them
          at the desktop breakpoint. */}
      <section
        className="cr-mkt-section cr-sd-hero"
        aria-labelledby="s1-h"
        data-couranr-section="sameday-hero"
        data-composition="split-story"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-sd-hero__lead">
          <h1 id="s1-h" className="cr-type-statement">
            {SAME_DAY_COPY.hero_headline}
          </h1>
          <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.hero_support}</p>

          <p className="cr-sd-hero__question">{SAME_DAY_COPY.hero_question}</p>
          <div className="cr-sd-intents">
            <Link href={sendIntent("send")} className="cr-sd-intent">
              <span className="cr-sd-intent__title">{SAME_DAY_COPY.intent_send_title}</span>
              <span className="cr-sd-intent__support">{SAME_DAY_COPY.intent_send_support}</span>
            </Link>
            <Link href={sendIntent("pickup")} className="cr-sd-intent">
              <span className="cr-sd-intent__title">{SAME_DAY_COPY.intent_pickup_title}</span>
              <span className="cr-sd-intent__support">{SAME_DAY_COPY.intent_pickup_support}</span>
            </Link>
          </div>
        </div>

        <div className="cr-sd-hero__media">
          <picture>
            <source
              media="(max-width: 640px)"
              type="image/webp"
              srcSet={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-portrait-390.webp 390w, ${IMG}/mkt-2026-08-consumer-doorstep-handoff-portrait-780.webp 780w`}
              sizes="100vw"
            />
            <img
              src={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp`}
              srcSet={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-800.webp 800w, ${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp 1200w`}
              sizes="(min-width: 900px) 55vw, 100vw"
              width={1200}
              height={800}
              alt="A person receives a small parcel and shopping bag at the front door of a home."
              className="cr-sd-photo"
              fetchPriority="high"
            />
          </picture>
        </div>
      </section>

      {/* ─── 2 ─── sameday-business-crosslink / structured-information-block ─── */}
      {/* A COMPACT callout, and the restraint is the requirement: the brief
          says not to make this a giant visual section. One rule, one question,
          one sentence, one link. It routes on PURPOSE — Same Day for an
          individual delivery, For Business when delivery is part of the
          business — and never on speed, because both products may run
          same-day. No photograph, no panel, no card. */}
      <section
        className="cr-mkt-section cr-sd-crosslink"
        aria-labelledby="s2-h"
        data-couranr-section="sameday-business-crosslink"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s2-h" className="cr-sd-crosslink__heading">
          {SAME_DAY_COPY.crosslink_heading}
        </h2>
        <p className="cr-sd-crosslink__body">{SAME_DAY_COPY.crosslink_body}</p>
        <Link href={business} className="cr-sd-crosslink__cta">
          {SAME_DAY_COPY.crosslink_cta}
          <span aria-hidden="true"> →</span>
        </Link>
      </section>

      {/* ─── 3 ───────────────────────── already-bought / image-narrative ─── */}
      <section
        className="cr-mkt-section cr-sd-editorial"
        aria-labelledby="s3-h"
        data-couranr-section="already-bought"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-sd-editorial__media">
          <picture>
            <source
              media="(max-width: 640px)"
              type="image/webp"
              srcSet={`${IMG}/mkt-2026-08-consumer-dry-cleaning-pickup-portrait-390.webp 390w, ${IMG}/mkt-2026-08-consumer-dry-cleaning-pickup-portrait-780.webp 780w`}
              sizes="100vw"
            />
            <img
              src={`${IMG}/mkt-2026-08-consumer-dry-cleaning-pickup-wide-1280.webp`}
              srcSet={`${IMG}/mkt-2026-08-consumer-dry-cleaning-pickup-wide-640.webp 640w, ${IMG}/mkt-2026-08-consumer-dry-cleaning-pickup-wide-1280.webp 1280w`}
              sizes="(min-width: 900px) 50vw, 100vw"
              width={1280}
              height={853}
              alt="A dry-cleaning worker hands finished garments in protective bags to a customer at the counter."
              className="cr-sd-photo"
            />
          </picture>
        </div>
        <div className="cr-sd-editorial__copy">
          <h2 id="s3-h" className="cr-type-marketing-section">
            {SAME_DAY_COPY.already_bought_headline}
          </h2>
          <p className="cr-mkt-editorial__body cr-type-lead">
            {SAME_DAY_COPY.already_bought_body}
          </p>
          <p className="cr-mkt-editorial__body">{SAME_DAY_COPY.already_bought_close}</p>
          <Link href={sendIntent("pickup")} className="cr-button cr-button--secondary cr-button--lg">
            {SAME_DAY_COPY.already_bought_cta}
          </Link>
        </div>
      </section>

      {/* ─── 4 ────────────────────── send-what-you-have / split-story ─── */}
      {/* Orientation REVERSES from the section above: the contract says the
          desktop editorial sections alternate deliberately, so a reader is not
          scrolling past the same layout twice. */}
      <section
        className="cr-mkt-section cr-sd-editorial cr-sd-editorial--reverse"
        aria-labelledby="s4-h"
        data-couranr-section="send-what-you-have"
        data-composition="split-story"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-sd-editorial__media">
          <picture>
            <source
              media="(max-width: 640px)"
              type="image/webp"
              srcSet={`${IMG}/mkt-2026-08-consumer-send-from-office-portrait-390.webp 390w, ${IMG}/mkt-2026-08-consumer-send-from-office-portrait-780.webp 780w`}
              sizes="100vw"
            />
            <img
              src={`${IMG}/mkt-2026-08-consumer-send-from-office-wide-1280.webp`}
              srcSet={`${IMG}/mkt-2026-08-consumer-send-from-office-wide-640.webp 640w, ${IMG}/mkt-2026-08-consumer-send-from-office-wide-1280.webp 1280w`}
              sizes="(min-width: 900px) 50vw, 100vw"
              width={1280}
              height={853}
              alt="A person at a home-office desk uses a phone beside a sealed document envelope."
              className="cr-sd-photo"
            />
          </picture>
        </div>
        <div className="cr-sd-editorial__copy">
          <h2 id="s4-h" className="cr-type-marketing-section">
            {SAME_DAY_COPY.send_what_you_have_headline}
          </h2>
          <p className="cr-mkt-editorial__body cr-type-lead">
            {SAME_DAY_COPY.send_what_you_have_body}
          </p>
          <p className="cr-mkt-editorial__body">{SAME_DAY_COPY.send_what_you_have_close}</p>
          <Link href={sendIntent("send")} className="cr-button cr-button--secondary cr-button--lg">
            {SAME_DAY_COPY.send_what_you_have_cta}
          </Link>
        </div>
      </section>

      {/* ─── 5 ──────────────────── consumer-breadth / editorial-statement ─── */}
      {/* Typography-led, and the flowing groups are what keeps it that way: the
          contract caps grid-dominant at zero and §19 calls four bordered tiles
          a card cemetery. The disclaimer is NOT decoration — a list of nouns
          with nothing after it reads as an eligibility promise, and the policy
          engine decides eligibility per shipment, after the details. */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="s5-h"
        data-couranr-section="consumer-breadth"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s5-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.breadth_headline}
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.breadth_lead}</p>
        <dl className="cr-sd-breadth">
          {SAME_DAY_COPY.breadth_group_titles.map((title, i) => (
            <div key={title} className="cr-sd-breadth__group">
              <dt className="cr-sd-breadth__term">{title}</dt>
              <dd className="cr-sd-breadth__detail">{SAME_DAY_COPY.breadth_group_bodies[i]}</dd>
            </div>
          ))}
        </dl>
        <p className="cr-sd-breadth__note">{SAME_DAY_COPY.breadth_disclaimer}</p>
      </section>

      {/* ─── 6 ───────── consumer-prohibited / structured-information-block ─── */}
      {/* The categories are RENDERED FROM `PROHIBITED_CLASSES`, the vocabulary
          the policy engine and the /send funnel enforce, through a keyed
          presentation map. Nothing on this page types a category name, and
          `tests/couranr-prohibited-summary.test.ts` fails if a class gains no
          label, lands in no group, or is named here without existing there.
          A hand-typed marketing list would be a second policy that drifts on
          the day the first one changes.

          Ruled rows, not panels. §19.7 permits cards for genuinely discrete
          utility content, but the contract caps grid-dominant at zero for every
          PUB-013 region, so the density comes from the rules and the columns.

          NO policy-document link. The brief asks for one and says to take its
          destination from the legal registry; `lib/legal.ts` has no such entry
          and no canonical screen owns that route, so the choice was a dead
          link, a link to the LEGACY /terms page, or none. The rendered summary
          answers the question on its own. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s6-h"
        data-couranr-section="consumer-prohibited"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s6-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.prohibited_heading}
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.prohibited_body}</p>
        <dl className="cr-sd-policy">
          {PROHIBITED_GROUPS.map((group) => (
            <div key={group.title} className="cr-sd-policy__row">
              <dt className="cr-sd-policy__term">{group.title}</dt>
              <dd className="cr-sd-policy__detail">{groupLabels(group).join(", ")}</dd>
            </div>
          ))}
        </dl>
        <p className="cr-sd-policy__help">{SAME_DAY_COPY.prohibited_help}</p>
      </section>

      {/* ─── 7 ───────────────────────── consumer-handoff / product-proof ─── */}
      {/* EVERY SENTENCE HERE DESCRIBES EVIDENCE THIS BUILD ACTUALLY RECORDS.
          The pickup command requires a shipment photograph before it will move
          a delivery to `picked_up`; each drop-off completion command requires
          the evidence its stored proof method names — a recipient PIN, a
          delivery photograph, or a captured signature (`PROOF_METHODS` in
          lib/couranr/driver/states.ts, enforced in the completion functions).

          WHAT IS DELIBERATELY ABSENT. The brief's progressive paragraph
          described value-tiered custody: documenting the item before packing, a
          numbered tamper-evident seal, recipient identity verification above a
          declared-value threshold. That work is not in this build — it lives on
          an unmerged Trust/Custody branch — so those sentences would be a
          protection claim Couranr cannot honour today. The owner chose to ship
          the rest and omit them. The honesty sentence stays either way: Couranr
          documents, it does not authenticate or appraise.

          The methods are rendered as an ordered handoff, which is what a
          product proof of this flow is — not a pill rail (that device belongs
          to §11's tracking stages) and not a screenshot. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s7-h"
        data-couranr-section="consumer-handoff"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <h2 id="s7-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.handoff_heading}
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.handoff_body}</p>
        <p className="cr-sd-handoff__detail">{SAME_DAY_COPY.handoff_progressive}</p>
        <p className="cr-sd-handoff__honesty">{SAME_DAY_COPY.handoff_honesty}</p>
      </section>

      {/* ─── 8 ───────────────────────── consumer-workflow / workflow-rail ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s8-h"
        data-couranr-section="consumer-workflow"
        data-composition="workflow-rail"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s8-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.workflow_headline}
        </h2>
        <ol className="cr-sd-rail">
          {SAME_DAY_COPY.workflow_labels.map((label, i) => (
            <li key={label} className="cr-sd-rail__step">
              <span className="cr-sd-rail__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="cr-sd-rail__label">{label}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 9 ───────────── consumer-price / structured-information-block ─── */}
      {/* NO SAMPLE AMOUNT, and the reason has not changed: a figure here would
          be a production-authoritative claim a marketing page cannot make.
          The section states WHEN the price appears, which is true of the flow,
          and PRC-005's numbers stay on the business pricing page where a real
          quote backs them. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s9-h"
        data-couranr-section="consumer-price"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s9-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.price_headline}
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.price_body}</p>
      </section>

      {/* ─── 10 ────────────────── consumer-availability / split-story ─── */}
      {/* THE NINE INTERACTION STATES ARE GONE FROM THIS PAGE. They were the
          section — idle / focused / typing / suggestions / selected / checking
          / eligible / review-needed / error, rendered as a ruled sequence — and
          the 2026-09 lock removes them: internal UI mechanics on a marketing
          page tell a visitor nothing about whether Couranr can run their trip.
          They remain PRODUCT requirements on `/send` and nothing there changed.

          No service-area lookup runs here and no boundary is drawn. SVC-002 is
          UNRESOLVED, so this says Couranr CHECKS the trip — never that an
          address is out of area, which is a verdict this page cannot reach. */}
      <section
        className="cr-mkt-split"
        aria-labelledby="s10-h"
        data-couranr-section="consumer-availability"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="s10-h" className="cr-type-marketing-section">
            {SAME_DAY_COPY.availability_headline}
          </h2>
          <p>{MARKETS_PUBLIC_COPY_NEUTRAL}</p>
        </div>
        <div className="cr-sd-availability__body">
          <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.availability_body}</p>
          <Link href={send} className="cr-button cr-button--secondary cr-button--lg">
            {SAME_DAY_COPY.availability_cta}
          </Link>
        </div>
      </section>

      {/* ─── 11 ──────────────────────── consumer-tracking / product-proof ─── */}
      {/* A product NARRATIVE, not live data. Three stage labels from MKT-005,
          rendered as a static sequence: no delivery, no driver, no ETA and no
          token. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s11-h"
        data-couranr-section="consumer-tracking"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <h2 id="s11-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.tracking_headline}
        </h2>
        <ol className="cr-sd-track">
          {SAME_DAY_COPY.tracking_labels.map((label) => (
            <li key={label} className="cr-sd-track__stage">
              {label}
            </li>
          ))}
        </ol>
        <p className="cr-mkt-editorial__body">{SAME_DAY_COPY.tracking_body}</p>
      </section>

      {/* ─── 12 ───────────── consumer-closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing cr-mkt-closing--split"
        aria-labelledby="s12-h"
        data-couranr-section="consumer-closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-closing__copy">
          <h2 id="s12-h" className="cr-mkt-h2-inverse">
            {SAME_DAY_COPY.closing_headline}
          </h2>
          <p className="cr-mkt-closing__body">{SAME_DAY_COPY.closing_support}</p>
        </div>
        <div className="cr-mkt-cta-row">
          <Link href={sendIntent("send")} className="cr-button cr-button--primary cr-button--lg">
            {SAME_DAY_COPY.send_what_you_have_cta}
          </Link>
          <Link href={sendIntent("pickup")} className="cr-button cr-button--inverse cr-button--lg">
            {SAME_DAY_COPY.already_bought_cta}
          </Link>
        </div>
      </section>
    </div>
  );
}
