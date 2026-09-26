import type { Metadata } from "next";
import Link from "next/link";
import { MASTER_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { MARKETS_PUBLIC_COPY_NEUTRAL } from "@/lib/couranr/public/governed";
import { routeForScreen } from "@/lib/couranr/navigation";

/**
 * PUB-012 — the sales-led Couranr master homepage.
 *
 * MKT-007 replaces the old three-region product router with a homepage that
 * answers the questions a first customer actually asks: can Couranr pick up an
 * arranged purchase, what do I have to arrange myself, how does pickup work,
 * and where does Couranr for Business fit?
 *
 * The page still obeys MKT-004's two-path brand. It creates no marketplace,
 * merchandise checkout, seller-payment flow or second delivery engine.
 */
export const metadata: Metadata = {
  title: "Couranr — local pickup and delivery",
  description: MASTER_COPY.hero_support,
};

const IMG = "/images/marketing/2026-08/w";

export default function Page() {
  const send = routeForScreen("PUB-004");
  const business = routeForScreen("PUB-001");
  const sameDay = routeForScreen("PUB-013");
  const sendIntent = (intent: "send" | "pickup") => `${send}?intent=${intent}`;

  return (
    <div className="cr-mkt">
      <section
        className="cr-mkt-section cr-master-sales-hero"
        aria-labelledby="m1-h"
        data-couranr-section="master-hero"
        data-composition="split-story"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-master-sales-hero__lead">
          <h1 id="m1-h" className="cr-type-statement">{MASTER_COPY.hero_headline}</h1>
          <p className="cr-mkt-editorial__body cr-type-lead">{MASTER_COPY.hero_support}</p>
          <p className="cr-master-sales-hero__boundary">{MASTER_COPY.hero_boundary}</p>
          <div className="cr-mkt-cta-row cr-master-sales-hero__actions">
            <Link
              href={sendIntent("pickup")}
              className="cr-button cr-button--primary cr-button--lg"
              data-couranr-primary-action="pickup"
            >
              {MASTER_COPY.hero_pickup_cta}
            </Link>
            <Link
              href={sendIntent("send")}
              className="cr-button cr-button--secondary cr-button--lg"
              data-couranr-primary-action="send"
            >
              {MASTER_COPY.hero_send_cta}
            </Link>
          </div>
          <p className="cr-master-sales-hero__business">
            {MASTER_COPY.hero_business_prompt}{" "}
            <Link href={business} data-couranr-business-cta="hero">
              {MASTER_COPY.hero_business_cta} <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>

        <picture className="cr-master-sales-hero__media">
          <source
            media="(max-width: 640px)"
            type="image/webp"
            srcSet={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-portrait-390.webp 390w, ${IMG}/mkt-2026-08-consumer-doorstep-handoff-portrait-780.webp 780w`}
            sizes="100vw"
          />
          <img
            src={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp`}
            srcSet={`${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-800.webp 800w, ${IMG}/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp 1200w`}
            sizes="(min-width: 900px) 48vw, 100vw"
            width={1200}
            height={800}
            alt="A person receives a small parcel and shopping bag at the front door of a home."
            className="cr-master-sales-hero__img"
            fetchPriority="high"
          />
        </picture>
      </section>

      <section
        className="cr-mkt-section"
        aria-labelledby="m2-h"
        data-couranr-section="master-use-cases"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="true"
        data-product-proof="false"
      >
        <h2 id="m2-h" className="cr-type-marketing-section">{MASTER_COPY.use_cases_heading}</h2>
        <div className="cr-master-usecases">
          <article className="cr-master-usecase cr-master-usecase--marketplace">
            <div className="cr-master-usecase__copy">
              <h3>{MASTER_COPY.marketplace_title}</h3>
              <p>{MASTER_COPY.marketplace_body}</p>
              <p className="cr-master-usecase__boundary">{MASTER_COPY.marketplace_boundary}</p>
              <Link href={sendIntent("pickup")} className="cr-master-usecase__link">
                {MASTER_COPY.hero_pickup_cta} <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="cr-master-route-story" aria-label="Seller to Couranr to you">
              <span>Seller</span><span aria-hidden="true">→</span>
              <strong>{MASTER_COPY.route_story_brand}</strong><span aria-hidden="true">→</span>
              <span>You</span>
            </div>
          </article>
          <article className="cr-master-usecase">
            <h3>{MASTER_COPY.ready_title}</h3>
            <p>{MASTER_COPY.ready_body}</p>
            <Link href={sendIntent("pickup")} className="cr-master-usecase__link">
              {MASTER_COPY.hero_pickup_cta} <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="cr-master-usecase">
            <h3>{MASTER_COPY.send_title}</h3>
            <p>{MASTER_COPY.send_body}</p>
            <Link href={sendIntent("send")} className="cr-master-usecase__link">
              {MASTER_COPY.hero_send_cta} <span aria-hidden="true">→</span>
            </Link>
          </article>
        </div>
      </section>

      <section
        className="cr-mkt-section"
        aria-labelledby="m3-h"
        data-couranr-section="master-workflow"
        data-composition="workflow-rail"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="m3-h" className="cr-type-marketing-section">{MASTER_COPY.workflow_heading}</h2>
        <ol className="cr-master-workflow">
          {MASTER_COPY.workflow_titles.map((title, i) => (
            <li key={title} className="cr-master-workflow__step">
              <span className="cr-master-workflow__n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{MASTER_COPY.workflow_bodies[i]}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="cr-master-workflow__example">{MASTER_COPY.workflow_example}</p>
      </section>

      <section
        className="cr-mkt-section cr-master-business"
        aria-labelledby="m4-h"
        data-couranr-section="master-business"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-master-business__media">
          <img
            src={`${IMG}/mkt-2026-08-gift-stationery-wide-1200.webp`}
            srcSet={`${IMG}/mkt-2026-08-gift-stationery-wide-400.webp 400w, ${IMG}/mkt-2026-08-gift-stationery-wide-800.webp 800w, ${IMG}/mkt-2026-08-gift-stationery-wide-1200.webp 1200w`}
            sizes="(min-width: 900px) 48vw, 100vw"
            width={1200}
            height={800}
            alt="Stationery-shop worker helping an older customer choose an item."
            className="cr-master-business__img"
          />
        </div>

        <div className="cr-master-business__copy">
          <h2 id="m4-h" className="cr-type-marketing-section">{MASTER_COPY.business_heading}</h2>
          <p className="cr-mkt-editorial__body cr-type-lead">{MASTER_COPY.business_body}</p>
          <ul className="cr-master-business__points">
            {MASTER_COPY.business_points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <Link
            href={business}
            className="cr-button cr-button--secondary cr-button--lg"
            data-couranr-business-cta="section"
          >
            {MASTER_COPY.business_cta}
          </Link>
        </div>
      </section>

      <section
        className="cr-mkt-split"
        aria-labelledby="m5-h"
        data-couranr-section="master-service-check"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="m5-h" className="cr-type-marketing-section">{MASTER_COPY.check_heading}</h2>
          <p>{MARKETS_PUBLIC_COPY_NEUTRAL}</p>
        </div>
        <div className="cr-master-check__body">
          <p className="cr-type-lead">{MASTER_COPY.check_body}</p>
          <p>{MASTER_COPY.check_payment}</p>
          <div className="cr-mkt-cta-row">
            <Link href={send} className="cr-button cr-button--primary cr-button--lg">
              {MASTER_COPY.check_cta}
            </Link>
            <Link href={sameDay} className="cr-button cr-button--ghost cr-button--lg">
              Learn about Same Day
            </Link>
          </div>
        </div>
      </section>

      <section
        className="cr-mkt-section"
        aria-labelledby="m6-h"
        data-couranr-section="master-handoff"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <h2 id="m6-h" className="cr-type-marketing-section">{MASTER_COPY.handoff_heading}</h2>
        <div className="cr-master-handoff">
          <div className="cr-master-handoff__item">
            <span className="cr-master-handoff__n" aria-hidden="true">01</span>
            <h3>Pickup verification</h3>
            <p>{MASTER_COPY.handoff_pickup}</p>
          </div>
          <div className="cr-master-handoff__item">
            <span className="cr-master-handoff__n" aria-hidden="true">02</span>
            <h3>Shipment evidence</h3>
            <p>{MASTER_COPY.handoff_evidence}</p>
          </div>
          <div className="cr-master-handoff__item">
            <span className="cr-master-handoff__n" aria-hidden="true">03</span>
            <h3>Recipient handoff</h3>
            <p>{MASTER_COPY.handoff_recipient}</p>
          </div>
        </div>
        <p className="cr-master-handoff__honesty">{MASTER_COPY.handoff_honesty}</p>
      </section>

      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="m7-h"
        data-couranr-section="master-faq"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="m7-h" className="cr-type-marketing-section">{MASTER_COPY.faq_heading}</h2>
        <div className="cr-master-faq">
          {MASTER_COPY.faq_questions.map((question, i) => (
            <details key={question} className="cr-master-faq__item">
              <summary>{question}</summary>
              <p>{MASTER_COPY.faq_answers[i]}</p>
            </details>
          ))}
        </div>
      </section>

      <section
        className="cr-mkt-closing"
        aria-labelledby="m8-h"
        data-couranr-section="master-closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-closing__copy">
          <h2 id="m8-h" className="cr-mkt-h2-inverse">{MASTER_COPY.closing_headline}</h2>
          <p className="cr-mkt-closing__body">{MASTER_COPY.closing_support}</p>
        </div>
        <div className="cr-mkt-cta-row cr-master-closing__actions">
          <Link href={sendIntent("pickup")} className="cr-button cr-button--primary cr-button--lg">
            {MASTER_COPY.hero_pickup_cta}
          </Link>
          <Link href={sendIntent("send")} className="cr-button cr-button--inverse cr-button--lg">
            {MASTER_COPY.hero_send_cta}
          </Link>
          <Link href={business} className="cr-master-closing__business" data-couranr-business-cta="closing">
            {MASTER_COPY.hero_business_cta} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
