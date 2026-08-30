import type { Metadata } from "next";
import Link from "next/link";
import { SAME_DAY_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { MARKETS_PUBLIC_COPY_NEUTRAL } from "@/lib/couranr/public/governed";
import { routeForScreen } from "@/lib/couranr/navigation";

/**
 * PUB-013 — Couranr Same Day, at `/sameday`.
 *
 * The consumer entry path MKT-004 added. Nine governed regions, and the
 * contract's floors are the inverse of the business family's: three image-led
 * sections and one product proof are REQUIRED, because a page asking a person
 * to hand over something they own has to show the handover rather than
 * describe it.
 *
 * WHAT THIS PAGE MUST NOT DO, and each is a decision rather than taste:
 *   - no fake price. The Same Day backend is unwired, so `consumer-price`
 *     states that price comes before the request and shows no amount.
 *   - no live tracking data. `consumer-tracking` is a three-stage product
 *     story, not a delivery.
 *   - no marketplace, catalogue, menu or storefront — MKT-004's consumer
 *     guardrail. For collection the item is already bought elsewhere.
 *   - no generic consumer sign-in. Customer accounts are optional at MVP.
 *   - no radius, ZIP eligibility or polygon: SVC-002 is UNRESOLVED.
 *
 * Every string comes from `SAME_DAY_COPY` (MKT-005); every destination from the
 * screen source. The market sentence is MKT-006's consumer-neutral one,
 * imported not typed — MKT-001's begins "Local BUSINESS delivery across …",
 * which is the wrong product to describe to a person on this page.
 */

export const metadata: Metadata = {
  title: "Couranr Same Day — local delivery, today",
  description: SAME_DAY_COPY.hero_support,
};

const IMG = "/images/marketing/2026-08/w";

export default function Page() {
  const send = routeForScreen("PUB-004");
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

      {/* ─── 2 ───────────────────────── already-bought / image-narrative ─── */}
      <section
        className="cr-mkt-section cr-sd-editorial"
        aria-labelledby="s2-h"
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
          <h2 id="s2-h" className="cr-type-marketing-section">
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

      {/* ─── 3 ────────────────────── send-what-you-have / split-story ─── */}
      {/* Orientation REVERSES from the section above: the contract says the
          desktop editorial sections alternate deliberately, so a reader is not
          scrolling past the same layout twice. */}
      <section
        className="cr-mkt-section cr-sd-editorial cr-sd-editorial--reverse"
        aria-labelledby="s3-h"
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
          <h2 id="s3-h" className="cr-type-marketing-section">
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

      {/* ─── 4 ──────────────────── consumer-breadth / editorial-statement ─── */}
      {/* Editorial text, NOT bordered cards. The contract caps grid-dominant at
          zero and §19 calls the alternative a card cemetery. */}
      <section
        className="cr-mkt-editorial"
        aria-labelledby="s4-h"
        data-couranr-section="consumer-breadth"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s4-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.breadth_headline}
        </h2>
        <ul className="cr-sd-breadth">
          {SAME_DAY_COPY.breadth_labels.map((label) => (
            <li key={label} className="cr-sd-breadth__item">
              {label}
            </li>
          ))}
        </ul>
      </section>

      {/* ─── 5 ───────────────────────── consumer-workflow / workflow-rail ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s5-h"
        data-couranr-section="consumer-workflow"
        data-composition="workflow-rail"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s5-h" className="cr-type-marketing-section">
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

      {/* ─── 6 ───────────── consumer-price / structured-information-block ─── */}
      {/* NO SAMPLE AMOUNT. The Same Day backend is unwired, so any figure here
          would be a production-authoritative claim with nothing behind it. The
          section states WHEN the price appears, which is a true statement about
          the flow, and PRC-001's numbers stay on the business pricing page
          where a real quote backs them. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s6-h"
        data-couranr-section="consumer-price"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s6-h" className="cr-type-marketing-section">
          {SAME_DAY_COPY.price_headline}
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{SAME_DAY_COPY.price_body}</p>
      </section>

      {/* ─── 7 ─────────────────── consumer-availability / split-story ─── */}
      {/* THE NINE STATES ARE THE SECTION. The work order asks this region to
          "present the full address/availability interaction story" and names
          every state: idle / focused / typing / suggestions / selected /
          checking / eligible / review-needed / error. This shipped as two prose
          paragraphs that DESCRIBED checking and depicted none of them — zero of
          the nine appeared in the rendered HTML. Prose about an interaction is
          not the interaction story.

          Rendered as a static ordered sequence, in the same ruled language as
          the workflow rail above and the tracking stages below, because that is
          what the rest of the page already uses to tell a sequence. No mock
          address field and no sample suggestion list: an invented address is
          fabricated product data, which this page bans elsewhere and would be
          banning here for the same reason.

          No service-area lookup runs and no boundary is drawn. SVC-002 is
          UNRESOLVED, so "eligible" says Couranr can run the trip and
          "review-needed" says the address is captured — never that it is out of
          area, which is a verdict nothing here is entitled to reach. */}
      <section
        className="cr-mkt-split cr-sd-availability"
        aria-labelledby="s7-h"
        data-couranr-section="consumer-availability"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="s7-h" className="cr-type-marketing-section">
            {SAME_DAY_COPY.availability_headline}
          </h2>
          <p>{MARKETS_PUBLIC_COPY_NEUTRAL}</p>
        </div>
        <ol className="cr-sd-states">
          {SAME_DAY_COPY.availability_state_order.map((state, i) => (
            <li key={state} className="cr-sd-state" data-couranr-address-state={state}>
              <span className="cr-sd-state__label">
                {SAME_DAY_COPY.availability_state_labels[i]}
              </span>
              <span className="cr-sd-state__caption">
                {SAME_DAY_COPY.availability_state_captions[i]}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 8 ───────────────────────── consumer-tracking / product-proof ─── */}
      {/* A product NARRATIVE, not live data. Three stage labels from MKT-005,
          rendered as a static sequence: no delivery, no driver, no ETA and no
          token. The contract's one product-proof floor is satisfied here. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s8-h"
        data-couranr-section="consumer-tracking"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <h2 id="s8-h" className="cr-type-marketing-section">
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

      {/* ─── 9 ────────────── consumer-closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing cr-mkt-closing--split"
        aria-labelledby="s9-h"
        data-couranr-section="consumer-closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-closing__copy">
          <h2 id="s9-h" className="cr-mkt-h2-inverse">
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
