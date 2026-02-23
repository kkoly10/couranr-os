"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { calculateCourierTotal, COURIER_PRICING } from "@/lib/delivery/pricing";

export default function CourierPage() {
  const [miles, setMiles] = useState<number>(8);
  const [priority, setPriority] = useState<"standard" | "rush">("standard");

  // ✅ Uses the shared pricing logic
  const pricing = useMemo(() => {
    try {
      return calculateCourierTotal({
        miles,
        weightLbs: 1, // Dummy weight for quick estimate
        stops: 0,
        rush: priority === "rush",
        signature: false,
      });
    } catch {
      return null;
    }
  }, [miles, priority]);

  const totalStr = pricing ? (pricing.amountCents / 100).toFixed(2) : "0.00";

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Same-day options</span>
              <span className="badge ghost">Status updates</span>
            </div>

            <h1 className="heroTitle">Courier delivery, kept simple.</h1>
            <p className="heroDesc">
              Request a pickup, get clear pricing, and track updates. Designed for local
              runs where speed and proof matter.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/courier/quote">
                Get a full quote →
              </Link>
              <Link className="btn btnGhost" href="/portal">
                Customer portal
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
                <p className="miniDesc">A driver is assigned based on availability.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">📸</span>
                  <span className="miniTitle">Proof</span>
                </div>
                <p className="miniDesc">Photo proof may be available when applicable.</p>
              </div>
            </div>

            <p className="finePrint">
              Delivery times are estimates and can be affected by traffic, weather, access issues,
              and recipient availability. Prohibited items are not accepted.
            </p>
          </div>
        </section>

        {/* Optional quick estimate for browsing */}
        <section className="section" id="estimate">
          <h2 className="sectionTitle">Quick estimate (optional)</h2>
          <p className="sectionSub">
            For an exact quote with address autocomplete and checkout flow, use the full quote.
            This quick estimate is only for planning.
          </p>

          <div className="cardGrid">
            <div className="card">
              <div className="cardIcon" aria-hidden="true">🧮</div>
              <h3 className="cardTitle">Estimate inputs</h3>
              <p className="cardDesc">Adjust miles and speed preference.</p>

              <div className="field">
                <div className="label">Estimated miles</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={COURIER_PRICING.MAX_MILES}
                  value={miles}
                  onChange={(e) => setMiles(Number(e.target.value || 0))}
                />
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">Speed</div>
                <select
                  className="input"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as "standard" | "rush")}
                >
                  <option value="standard">Standard</option>
                  <option value="rush">Rush / priority</option>
                </select>
              </div>

              <p className="helpText">
                For special items or multi-stop routes, email{" "}
                <a className="mutedLink" href="mailto:couranr@couranrauto.com">
                  couranr@couranrauto.com
                </a>.
              </p>
            </div>

            <div className="card">
              <div className="cardIcon" aria-hidden="true">💰</div>
              <h3 className="cardTitle">Estimated total</h3>
              <p className="cardDesc">Based on your selections:</p>

              <ul className="cardList">
                <li>Base: ${COURIER_PRICING.BASE_FEE.toFixed(2)}</li>
                <li>
                  ${COURIER_PRICING.PER_MILE.toFixed(2)}/mile × {miles} miles
                </li>
                {priority === "rush" ? (
                  <li>Rush fee: +${COURIER_PRICING.RUSH_FEE}</li>
                ) : (
                  <li>Rush fee: $0</li>
                )}
              </ul>

              <div style={{ marginTop: 8, fontWeight: 900, fontSize: 22 }}>
                ${totalStr}
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
                No illegal/hazardous/restricted items. You’re responsible for accurate
                pickup/drop-off info and packaging where applicable.
              </p>
            </div>

            <div className="card">
              <div className="cardIcon" aria-hidden="true">🚫</div>
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

        {/* ✅ RESTORED "What you can expect" Section */}
        <section className="section">
          <h2 className="sectionTitle">What you can expect</h2>
          <p className="sectionSub">A simple flow with clear rules and strong documentation.</p>

          <div className="cardGrid">
            <InfoCard
              icon="✅"
              title="Clear eligibility"
              desc="Basic requirements are confirmed before pickup to avoid surprises."
              bullets={["Account verification", "Accurate info required", "Fraud prevention checks"]}
            />
            <InfoCard
              icon="🧠"
              title="Straightforward rules"
              desc="No confusion—key restrictions are shown in the flow and agreement."
              bullets={["No unauthorized drivers", "No illegal activity", "Return expectations"]}
            />
            <InfoCard
              icon="🛡️"
              title="Reduced disputes"
              desc="Documentation and portal history help resolve issues professionally."
              bullets={["Photos when applicable", "Receipts + records", "Support trail"]}
            />
          </div>
        </section>

        {/* ✅ RESTORED FAQ Section */}
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
              a="Email us with pickup/drop-off details and time window: couranr@couranrauto.com."
            />
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function InfoCard({ icon, title, desc, bullets }: { icon: string; title: string; desc: string; bullets: string[]; }) {
  return (
    <div className="card">
      <div className="cardIcon" aria-hidden="true">{icon}</div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <ul className="cardList">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
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
