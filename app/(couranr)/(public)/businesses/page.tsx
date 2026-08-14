import Link from "next/link";
import type { Metadata } from "next";
import { Card, Grid, Heading, Stack, Text } from "@/components/couranr/primitives";
import {
  BUSINESS_CATEGORIES,
  CATEGORY_LABELS,
  GENERAL_CATEGORY,
} from "@/lib/couranr/categories/registry";

/**
 * PUB-009 — supported business categories and merchant-controlled channels.
 *
 * The category registry is VERBATIM from the Master Package's eleven-entry
 * initial registry, and the page states the registry's own rule: a category
 * controls initial recommendations, not eligibility. Registry constraint: do
 * not advertise medical or prohibited categories — none appears. Required
 * states: category tabs (rendered as the category grid) and the
 * general-business fallback (its own card plus the explicit sentence).
 */

export const metadata: Metadata = {
  title: "For businesses — Couranr",
  description:
    "Local delivery for boutiques, florists, bakeries, printers, repair shops and more — through the ordering channels you already control.",
};

/**
 * Master Package "Categories" — the initial registry, all eleven.
 *
 * Rendered FROM `lib/couranr/categories/registry.ts` rather than retyped here.
 * This page and PUB-001 now both show the same eleven, and the registry module
 * is the one the merchant onboarding form, the settings screen and the database
 * check constraint already agree with — so the marketing copy cannot drift into
 * advertising a category the product will not accept.
 */
const CATEGORIES = BUSINESS_CATEGORIES.map((c) => CATEGORY_LABELS[c]);

const CHANNELS = [
  "Website",
  "Phone",
  "Text",
  "Social media",
  "Point of sale",
  "Storefront / in person",
  "Other channels you control",
];

export default function Page() {
  return (
    <div className="cr-mkt">
      <section className="cr-mkt-hero" aria-labelledby="b-h">
        <p className="cr-mkt-eyebrow">For independent local businesses</p>
        <h1 id="b-h" className="cr-mkt-h1">
          Local delivery should not stop at restaurant orders.
        </h1>
        <p className="cr-mkt-sub">
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

      <section className="cr-mkt-section" aria-labelledby="b-cat-h">
        <Heading level={2} id="b-cat-h">
          Supported business categories
        </Heading>
        <Text muted>
          Pick one primary category and up to three secondary ones when you sign up.
          Your category tunes Couranr&apos;s recommendations — presets, packaging
          prompts, proof defaults — <strong>never your eligibility</strong>.
        </Text>
        <Grid columns={3}>
          {CATEGORIES.map((c) => (
            <Card
              key={c}
              className={
                c === CATEGORY_LABELS[GENERAL_CATEGORY] ? "cr-mkt-payer--merchant" : undefined
              }
            >
              <Text size="sm">{c}</Text>
            </Card>
          ))}
        </Grid>
        <Text muted size="sm">
          Not on the list? <strong>{CATEGORY_LABELS[GENERAL_CATEGORY]}</strong> is a first-class
          choice, not a waiting room — every Couranr capability works without a
          specialty category.
        </Text>
      </section>

      <section className="cr-mkt-section" aria-labelledby="b-chan-h">
        <Heading level={2} id="b-chan-h">
          Your channels stay yours
        </Heading>
        <Text muted>
          Couranr adds delivery to the ordering channels you already run — it never
          becomes a marketplace between you and your customer:
        </Text>
        <ul className="cr-mkt-chips" aria-label="Merchant-controlled ordering channels">
          {CHANNELS.map((c) => (
            <li key={c} className="cr-mkt-chip">
              {c}
            </li>
          ))}
        </ul>
      </section>

      <section className="cr-mkt-closing" aria-labelledby="b-close-h">
        <h2 id="b-close-h" className="cr-mkt-h2-inverse">
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
