import type { Metadata } from "next";
import Link from "next/link";
import { MASTER_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { MARKETS_PUBLIC_COPY_NEUTRAL } from "@/lib/couranr/public/governed";
import { routeForScreen } from "@/lib/couranr/navigation";

/**
 * PUB-012 — the Couranr master homepage, at `/`.
 *
 * MKT-004 made Couranr one brand with two entry paths, and this page exists to
 * send a visitor down the right one. It is NOT the Business page with wider
 * copy and it is NOT a consumer catalogue.
 *
 * EXACTLY THREE governed regions, and the contract in `VISUAL_REGISTRY.json`
 * caps grid-dominant at zero. The obvious way to build a two-audience homepage
 * is a row of feature cards; §28 bans that template-filling, and the two
 * audience doors are one editorial hero composition rather than two tiles.
 *
 * Every string here comes from `MASTER_COPY` (MKT-005) and every destination
 * from `routeForScreen` (the screen source). Nothing on this page types a
 * route, a price, a mileage, an operating hour or a market name — the market
 * sentence is `MARKETS_PUBLIC_COPY_NEUTRAL`, which MKT-006 owns.
 */

export const metadata: Metadata = {
  title: "Couranr — local delivery, built around you",
  description: MASTER_COPY.hero_support,
};

export default function Page() {
  const sameDayHref = routeForScreen("PUB-013");
  const businessHref = routeForScreen("PUB-001");

  return (
    <div className="cr-mkt">
      {/* ─── 1 ───────────────────────────── master-hero / split-story ─── */}
      {/* No eyebrow. The fidelity amendment §6 retires the shared marketing
          eyebrow and bans replacing it with a pill, chip or small-caps rule;
          the hierarchy here is the statement type and the whitespace under it. */}
      <section
        className="cr-mkt-section cr-master-hero"
        aria-labelledby="m1-h"
        data-couranr-section="master-hero"
        data-composition="split-story"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-master-hero__lead">
          <h1 id="m1-h" className="cr-type-statement">
            {MASTER_COPY.hero_headline}
          </h1>
          <p className="cr-mkt-editorial__body cr-type-lead">{MASTER_COPY.hero_support}</p>
        </div>

        {/* Two doors, not two cards. Each is a photograph with its copy over
            the same link target, so the whole panel is the affordance.
            Consumer first in source order, which is also mobile order. */}
        <div className="cr-master-doors">
          <Link href={sameDayHref} className="cr-master-door" data-couranr-door="consumer">
            <picture>
              {/* Art direction, not a resize: at 390 a shrunk 3:2 puts both
                  faces under 40px, so the narrow window is a 4:5 crop about
                  the same focal point. `<picture>` rather than next/image
                  because `<source media>` is what expresses that, and
                  next/image cannot. */}
              <source
                media="(max-width: 640px)"
                type="image/webp"
                srcSet="/images/marketing/2026-08/w/mkt-2026-08-consumer-doorstep-handoff-portrait-390.webp 390w, /images/marketing/2026-08/w/mkt-2026-08-consumer-doorstep-handoff-portrait-780.webp 780w"
                sizes="100vw"
              />
              <img
                src="/images/marketing/2026-08/w/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp"
                srcSet="/images/marketing/2026-08/w/mkt-2026-08-consumer-doorstep-handoff-wide-800.webp 800w, /images/marketing/2026-08/w/mkt-2026-08-consumer-doorstep-handoff-wide-1200.webp 1200w"
                sizes="(min-width: 900px) 50vw, 100vw"
                width={1200}
                height={800}
                alt="A person receives a small parcel and shopping bag at the front door of a home."
                className="cr-master-door__img"
                fetchPriority="high"
              />
            </picture>
            <span className="cr-master-door__copy">
              <span className="cr-master-door__title">{MASTER_COPY.consumer_door_title}</span>
              <span className="cr-master-door__support">{MASTER_COPY.consumer_door_support}</span>
            </span>
          </Link>

          <Link href={businessHref} className="cr-master-door" data-couranr-door="business">
            <picture>
              <img
                src="/images/marketing/2026-08/w/mkt-2026-08-gift-stationery-wide-1200.webp"
                srcSet="/images/marketing/2026-08/w/mkt-2026-08-gift-stationery-wide-800.webp 800w, /images/marketing/2026-08/w/mkt-2026-08-gift-stationery-wide-1200.webp 1200w"
                sizes="(min-width: 900px) 50vw, 100vw"
                width={1200}
                height={800}
                alt="Stationery-shop worker helping an older customer choose an item."
                className="cr-master-door__img"
              />
            </picture>
            <span className="cr-master-door__copy">
              <span className="cr-master-door__title">{MASTER_COPY.business_door_title}</span>
              <span className="cr-master-door__support">{MASTER_COPY.business_door_support}</span>
            </span>
          </Link>
        </div>
      </section>

      {/* ─── 2 ────────────────────── master-network / editorial-statement ─── */}
      {/* Typography-led by contract: no icon grid, no feature cards, no
          metrics. TRM-001 and MKT-002 both forbid unverified proof, and there
          is nothing here to prove — this section states what the network is. */}
      <section
        className="cr-mkt-editorial"
        aria-labelledby="m2-h"
        data-couranr-section="master-network"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="m2-h" className="cr-type-marketing-section">
          {MASTER_COPY.network_heading}
        </h2>
        <dl className="cr-master-network">
          <div className="cr-master-network__item">
            <dt className="cr-master-network__term">Individuals</dt>
            <dd className="cr-master-network__desc cr-type-lead">
              {MASTER_COPY.network_individuals}
            </dd>
          </div>
          <div className="cr-master-network__item">
            <dt className="cr-master-network__term">Businesses</dt>
            <dd className="cr-master-network__desc cr-type-lead">
              {MASTER_COPY.network_businesses}
            </dd>
          </div>
        </dl>
      </section>

      {/* ─── 3 ─────────── master-service-area / structured-information-block ─── */}
      {/* Consumer-NEUTRAL coverage, not the business-only service-area copy.
          This shipped reading MARKETS_PUBLIC_COPY, which is MKT-001's sentence
          and literally begins "Local BUSINESS delivery across …" — the exact
          copy the work order names as the thing this region must not be. The
          market names still come from the governed module (MKT-006 now) and are
          not typed here. No radius, no ZIP eligibility, no polygon, no instant
          eligibility and no Maryland coverage: SVC-002 (the boundary) is
          UNRESOLVED, so any of those would be an invented product claim. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="m3-h"
        data-couranr-section="master-service-area"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="m3-h" className="cr-type-marketing-section">
          Where Couranr delivers
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">{MARKETS_PUBLIC_COPY_NEUTRAL}</p>
        <div className="cr-mkt-cta-row">
          <Link href={sameDayHref} className="cr-button cr-button--primary cr-button--lg">
            {MASTER_COPY.consumer_door_title}
          </Link>
          <Link href={businessHref} className="cr-button cr-button--secondary cr-button--lg">
            {MASTER_COPY.business_door_title}
          </Link>
        </div>
      </section>
    </div>
  );
}
