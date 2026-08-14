import Link from "next/link";
import type { Metadata } from "next";
import { Text } from "@/components/couranr/primitives";
import {
  IconChat,
  IconGlobe,
  IconPhone,
  IconPlusCircle,
  IconShare,
  IconStore,
  IconTerminal,
} from "@/components/couranr/marketing/MarketingIcons";
import {
  BUSINESS_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_PURPOSE_COPY,
  CATEGORY_REGISTRY_VERSION,
  GENERAL_CATEGORY,
  MAX_SECONDARY_CATEGORIES,
} from "@/lib/couranr/categories/registry";

/**
 * PUB-009 — supported business categories and merchant-controlled channels.
 *
 * The category registry is rendered FROM `lib/couranr/categories/registry.ts`,
 * the same module the onboarding form, the settings screen and the database
 * check constraint agree with. Registry constraint: do not advertise medical or
 * prohibited categories — none appears. Required states: category tabs
 * (rendered as the category grid) and the general-business fallback (marked in
 * the grid plus its own section).
 *
 * COMPOSITION is governed by §27.1 — six sections, one grid-dominant.
 *
 * MKT-002: "The supporting pages deepen the homepage rather than repeat it."
 * PUB-001 now renders these eleven too, so this page carries what the homepage
 * does not: the selection mechanics (one primary, up to three secondary,
 * version-stamped) and the recommendation-not-eligibility rule stated in full.
 * The seven channels are here because the registry names them as this screen's
 * purpose, but framed as what Couranr does NOT take rather than as a second
 * list of the same seven chips.
 */

export const metadata: Metadata = {
  title: "For businesses — Couranr",
  description:
    "Local delivery for boutiques, florists, bakeries, printers, repair shops and more — through the ordering channels you already control.",
};

const CHANNELS = [
  { label: "Website", Icon: IconGlobe },
  { label: "Phone", Icon: IconPhone },
  { label: "Text", Icon: IconChat },
  { label: "Social media", Icon: IconShare },
  { label: "Point of sale", Icon: IconTerminal },
  { label: "Storefront / in person", Icon: IconStore },
  { label: "Other channels you control", Icon: IconPlusCircle },
];

/**
 * What a category does and does not do. Every line is the Master Package's own
 * rule; none of them is a capability claim, because a category grants none.
 */
const CATEGORY_RULES = [
  {
    label: "One primary category",
    body: "The one that describes your business best. It is the only one Couranr treats as your default.",
  },
  {
    label: `Up to ${MAX_SECONDARY_CATEGORIES} secondary categories`,
    body: "For businesses that genuinely do more than one thing. A secondary cannot repeat your primary.",
  },
  {
    label: "Change it whenever you like",
    body: `Your selection is stamped with the registry version it was made under (${CATEGORY_REGISTRY_VERSION}), so a later edition can be told apart from a change you made.`,
  },
  {
    label: "It never gates anything",
    body: "Not what you can send, not what it costs, not whether Couranr will carry it. Your category shapes recommendations, never your eligibility — a florist and a furniture shop have identical rights.",
  },
];

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* ─── 1 ────────────────── businesses-hero / editorial-statement ─── */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--hero"
        aria-labelledby="b1-h"
        data-couranr-section="businesses-hero"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <p className="cr-mkt-eyebrow">For independent local businesses</p>
        <h1 id="b1-h" className="cr-type-statement">
          Local delivery should not stop at restaurant orders.
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
          Couranr delivers for the rest of your main street — storefronts, home
          businesses, sole proprietors, social-media sellers acting as businesses,
          service providers, and general local businesses.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--secondary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      {/* ─── 2 ────────── category-system / structured-information-block ─── */}
      {/* The one grid-dominant section §27.1 allows this page. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="b2-h"
        data-couranr-section="category-system"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="true"
        data-product-proof="false"
      >
        <h2 id="b2-h" className="cr-type-marketing-section">
          Supported business categories
        </h2>
        <Text muted className="cr-type-lead">
          All {BUSINESS_CATEGORIES.length}, in full. There is no waiting list and no
          application — these are the choices in the sign-up form.
        </Text>
        <ul className="cr-mkt-categories" aria-label="Supported business categories">
          {BUSINESS_CATEGORIES.map((c) => (
            <li
              key={c}
              className={
                c === GENERAL_CATEGORY
                  ? "cr-mkt-categories__item cr-mkt-categories__item--general"
                  : "cr-mkt-categories__item"
              }
            >
              {CATEGORY_LABELS[c]}
            </li>
          ))}
        </ul>
      </section>

      {/* ─── 3 ──────────────────────────── category-rule / split-story ─── */}
      <section
        className="cr-mkt-split"
        aria-labelledby="b3-h"
        data-couranr-section="category-rule"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="b3-h" className="cr-type-marketing-section">
            What a category actually does
          </h2>
          <Text muted className="cr-type-lead">
            {CATEGORY_PURPOSE_COPY}
          </Text>
        </div>
        <dl className="cr-mkt-schedule">
          {CATEGORY_RULES.map((r) => (
            <div key={r.label} className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
              <dt>{r.label}</dt>
              <dd>{r.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ─── 4 ──────────────────── channels / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-band"
        aria-labelledby="b4-h"
        data-couranr-section="channels"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-band__inner cr-mkt-band__inner--stacked">
          <div className="cr-mkt-band__copy">
            <h2 id="b4-h" className="cr-mkt-band__h2 cr-type-marketing-section">
              Your channels stay yours
            </h2>
            <p className="cr-mkt-band__body">
              Couranr adds delivery to the ordering channels you already run. It never
              becomes a marketplace between you and your customer, never takes a cut
              of the product sale, and never contacts your customer about anything but
              their delivery.
            </p>
            <p className="cr-mkt-band__note">
              You keep the sale, the payment relationship and the customer
              relationship. <Link href="/how-it-works">See how a delivery works →</Link>
            </p>
          </div>
          <ul className="cr-mkt-channelstrip cr-mkt-channelstrip--inverse" aria-label="Merchant-controlled ordering channels">
            {CHANNELS.map(({ label, Icon }) => (
              <li key={label} className="cr-mkt-channelstrip__item">
                <span className="cr-mkt-channelstrip__icon">
                  <Icon />
                </span>
                <span className="cr-mkt-channelstrip__label">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── 5 ────────────────────── fallback / editorial-statement ─── */}
      {/* Registry-required state: the general-business fallback. */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="b5-h"
        data-couranr-section="fallback"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="b5-h" className="cr-type-statement">
          Not on the list? That is a category too.
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">
          <strong>{CATEGORY_LABELS[GENERAL_CATEGORY]}</strong> is a first-class choice,
          not a waiting room. Every Couranr capability works without a specialty
          category, and nothing on this page is a prerequisite for anything.
        </p>
      </section>

      {/* ─── 6 ─────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="b6-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="b6-h" className="cr-mkt-h2-inverse cr-type-statement">
          Whatever you sell, your customers can ask for delivery.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/how-it-works" className="cr-button cr-button--inverse cr-button--lg">
            See how it works
          </Link>
        </div>
      </section>
    </div>
  );
}
