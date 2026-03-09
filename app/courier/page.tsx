"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";
import { serviceImageSets } from "@/lib/serviceImages";

export default function CourierPage() {
  const [miles, setMiles] = useState<number>(8);
  const [priority, setPriority] = useState<"standard" | "rush">("standard");

  const pricing = useMemo(() => {
    const safeMiles = Number.isFinite(miles) ? Math.max(1, miles) : 1;
    const result = computeDeliveryPrice({
      miles: safeMiles,
      weightLbs: 1,
      stops: 0,
      rush: priority === "rush",
      signature: false,
    });

    return {
      miles: safeMiles,
      breakdown: result.breakdown,
      total: result.breakdown.total,
    };
  }, [miles, priority]);

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section
          className="hero heroWithImage"
          style={{
            backgroundImage: `linear-gradient(120deg, rgba(7, 10, 17, 0.74), rgba(7, 10, 17, 0.48)), url(${serviceImageSets.courier[0]})`,
          }}
        >
          <div className="heroCard heroCardOverlay">
            <div className="badgeRow">
              <span className="badge">Same-day options</span>
              <span className="badge ghost">Status updates</span>
            </div>

            <h1 className="heroTitle">Courier delivery, kept simple.</h1>
            <p className="heroDesc">
              Request a pickup, get clear pricing, and track updates. Designed
              for local runs where speed and proof matter.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/courier/quote">
                Get a full quote →
              </Link>
              <Link className="btn btnGhost" href="/portal">
                Customer portal
              </Link>
              <Link className="btn btnGhost" href="/terms">
                Terms
              </Link>
              <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                Email support
              </a>
            </div>

            <div className="heroMiniGrid" aria-label="Courier flow">
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🧾</span>
                  <span className="miniTitle">Request</span>
                </div>
                <p className="miniDesc">Share pickup + drop-off details.</p>
              </div>

              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🚚</span>
                  <span className="miniTitle">Deliver</span>
                </div>
                <p className="miniDesc">
                  A driver is assigned based on availability.
                </p>
              </div>

              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">📸</span>
                  <span className="miniTitle">Proof</span>
                </div>
                <p className="miniDesc">
                  Photo proof may be available when applicable.
                </p>
              </div>
            </div>

            <p className="finePrint">
              Delivery times are estimates and can be affected by traffic,
              weather, access issues, and recipient availability. Prohibited
              items are not accepted.
            </p>
          </div>
        </section>

        <section className="section" id="estimate">
          <h2 className="sectionTitle">Quick estimate (optional)</h2>
          <p className="sectionSub">
            For an exact quote with address autocomplete and checkout flow, use
            the full quote. This quick estimate is only for planning.
          </p>

          <div className="cardGrid">
            <div className="card">
              <div className="cardIcon" aria-hidden="true">
                🧮
              </div>
              <h3 className="cardTitle">Estimate inputs</h3>
              <p className="cardDesc">Adjust miles and speed preference.</p>

              <div className="field">
                <div className="label">Estimated miles</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={300}
                  value={miles}
                  onChange={(e) => setMiles(Number(e.target.value || 0))}
                />
              </div>

              <div className="field">
                <div className="label">Speed</div>
                <select
                  className="input"
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "standard" | "rush")
                  }
                >
                  <option value="standard">Standard</option>
                  <option value="rush">Rush / priority</option>
                </select>
              </div>

              <p className="helpText">
                For special items or multi-stop routes, email{" "}
                <a className="mutedLink" href="mailto:couranr@couranrauto.com">
                  couranr@couranrauto.com
                </a>
                .
              </p>
            </div>

            <div className="card">
              <div className="cardIcon" aria-hidden="true">
                💰
              </div>
              <h3 className="cardTitle">Estimated total</h3>
              <p className="cardDesc">Based on your selections:</p>

              <ul className="cardList">
                <li>
                  Base: ${pricing.breakdown.base.toFixed(2)} (includes first{" "}
                  {pricing.breakdown.includedMiles} miles)
                </li>
                <li>
                  Distance: {pricing.miles} miles →{" "}
                  {pricing.breakdown.extraMiles} billable × $1.75 = $
                  {pricing.breakdown.extraMilesFee.toFixed(2)}
                </li>
                {pricing.breakdown.rushFee > 0 ? (
                  <li>Rush fee: +${pricing.breakdown.rushFee.toFixed(2)}</li>
                ) : (
                  <li>Rush fee: $0.00</li>
                )}
              </ul>

              <div style={{ marginTop: 8, fontWeight: 900, fontSize: 22 }}>
                ${pricing.total.toFixed(2)}
              </div>

              <div className="contactRow" style={{ marginTop: 12 }}>
                <Link className="btn btnGold" href="/courier/quote">
                  Start full quote →
                </Link>
                <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                  Email request
                </a>
              </div>

              <p className="finePrint">
                Quick estimate assumes 1 lb package, no extra stops, and no
                signature service. No illegal, hazardous, or restricted items.
                You’re responsible for accurate pickup/drop-off info and
                packaging where applicable.
              </p>
            </div>

            <div className="card">
              <div className="cardIcon" aria-hidden="true">
                🚫
              </div>
              <h3 className="cardTitle">Prohibited items</h3>
              <p className="cardDesc">We do not accept deliveries of:</p>
              <ul className="cardList">
                <li>Illegal items</li>
                <li>Hazardous materials</li>
                <li>Weapons and restricted items</li>
                <li>Anything unsafe to transport</li>
              </ul>
              <p className="finePrint">If unsure, email us before requesting.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Coverage & service window</h2>
          <p className="sectionSub">
            Local routes with availability based on driver capacity, timing, and
            address access conditions.
          </p>

          <div className="cardGrid">
            <div className="card">
              <h3 className="cardTitle">Service area</h3>
              <p className="cardDesc">
                Coverage is currently local/regional. Use the quote page to
                validate pickup/drop-off eligibility.
              </p>
            </div>

            <div className="card">
              <h3 className="cardTitle">Scheduling</h3>
              <p className="cardDesc">
                Same-day options may be available based on request time, route
                load, and item constraints.
              </p>
            </div>

            <div className="card">
              <h3 className="cardTitle">Best use cases</h3>
              <p className="cardDesc">
                Time-sensitive local handoffs, office-to-office runs, and
                structured proof-required deliveries.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>
          <div className="faq">
            <FAQItem
              q="Do you guarantee delivery times?"
              a="No—times are estimates. Traffic, weather, access issues, and recipient availability can affect timing."
            />
            <FAQItem
              q="Do you provide proof?"
              a="Photo proof may be available when applicable (depending on delivery type and location)."
            />
            <FAQItem
              q="How do I request a special route or multi-stop?"
              a="Email us with pickup and drop-off details plus your preferred time window at couranr@couranrauto.com. Coverage depends on route, availability, and service-area eligibility."
            />
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="faqItem">
      <summary className="faqQ">{q}</summary>
      <div className="faqA">{a}</div>
    </details>
  );
}