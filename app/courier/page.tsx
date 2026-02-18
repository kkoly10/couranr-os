"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";

export default function CourierPage() {
  const [miles, setMiles] = useState<number>(8);
  const [priority, setPriority] = useState<"standard" | "rush">("standard");

  // EDIT THESE CONSTANTS ANYTIME
  const pricing = useMemo(() => {
    const base = 18; // base fee
    const perMile = 1.65; // per mile
    const rushFee = priority === "rush" ? 12 : 0;
    const raw = base + miles * perMile + rushFee;
    const min = 28;
    const total = Math.max(min, Math.round(raw));
    return { base, perMile, rushFee, total };
  }, [miles, priority]);

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
              <a className="btn btnGold" href="#estimate">
                Get an estimate →
              </a>
              <Link className="btn btnGhost" href="/login">
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

        <section className="section" id="estimate">
          <h2 className="sectionTitle">Quick estimate</h2>
          <p className="sectionSub">
            This is an estimate for planning. Final pricing may be confirmed after details are reviewed.
          </p>

          <div className="cardGrid">
            <div className="card">
              <div className="cardIcon" aria-hidden="true">
                🧮
              </div>
              <h3 className="cardTitle">Estimate inputs</h3>
              <p className="cardDesc">
                Adjust miles and speed preference.
              </p>

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
                  onChange={(e) => setPriority(e.target.value as any)}
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
              <p className="cardDesc">
                Based on your selections:
              </p>

              <ul className="cardList">
                <li>Base: ${pricing.base}</li>
                <li>${pricing.perMile.toFixed(2)}/mile × {miles} miles</li>
                {pricing.rushFee > 0 ? <li>Rush fee: +${pricing.rushFee}</li> : <li>Rush fee: $0</li>}
              </ul>

              <div style={{ marginTop: 8, fontWeight: 900, fontSize: 22 }}>
                ${pricing.total}
              </div>

              <div className="contactRow" style={{ marginTop: 12 }}>
                <Link className="btn btnGold" href="/login">
                  Continue in portal →
                </Link>
                <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                  Email request
                </a>
              </div>

              <p className="finePrint">
                No illegal/hazardous/restricted items. You’re responsible for accurate pickup/drop-off info
                and packaging where applicable.
              </p>
            </div>

            <div className="card">
              <div className="cardIcon" aria-hidden="true">
                🚫
              </div>
              <h3 className="cardTitle">Prohibited items</h3>
              <p className="cardDesc">
                We do not accept deliveries of:
              </p>
              <ul className="cardList">
                <li>Illegal items</li>
                <li>Hazardous materials</li>
                <li>Weapons and restricted items</li>
                <li>Anything unsafe to transport</li>
              </ul>
              <p className="finePrint">
                If unsure, email us before requesting.
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
              a="Email us with pickup/drop-off details and time window: couranr@couranrauto.com."
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