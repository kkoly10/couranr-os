import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function HomePage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        {/* HERO */}
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge ghost">One platform</span>
            </div>

            <h1 className="heroTitle">Local services, powered by one OS.</h1>

            <p className="heroDesc">
              Courier delivery, document help, and auto rentals — with simple checkout
              and one portal to manage everything after.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/courier">
                Start a delivery quote →
              </Link>
              <Link className="btn btnGhost" href="/auto">
                Browse vehicles
              </Link>
              <Link className="btn btnGhost" href="/login">
                Customer portal
              </Link>
            </div>

            <div className="heroMiniGrid" aria-label="Quick flows">
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🚚</span>
                  <span className="miniTitle">Courier</span>
                </div>
                <p className="miniDesc">
                  Get a quote → schedule → track delivery with photo proof.
                </p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🚗</span>
                  <span className="miniTitle">Auto</span>
                </div>
                <p className="miniDesc">
                  Browse vehicles → verify → pay → manage your rental in the portal.
                </p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">📄</span>
                  <span className="miniTitle">Docs</span>
                </div>
                <p className="miniDesc">
                  Document help + appointments (immigration/DMV support).
                </p>
              </div>
            </div>

            <p className="finePrint">
              Couranr Docs provides administrative/document assistance only — not legal
              advice, not a government agency, and no outcome is guaranteed.
            </p>
          </div>
        </section>

        {/* SERVICES */}
        <section className="section">
          <h2 className="sectionTitle">Pick what you need</h2>
          <p className="sectionSub">
            Clear pricing. Simple flows. Track everything after checkout.
          </p>

          <div className="cardGrid">
            <ServiceCard
              icon="🚚"
              title="Courier Delivery"
              desc="Same-day and scheduled local delivery with transparent pricing, tracking, and proof-of-pickup/drop-off."
              bullets={[
                "Real-time status updates",
                "Photo proof (when applicable)",
                "Clear prohibited-item rules",
              ]}
              href="/courier"
              cta="Get a quote"
            />

            <ServiceCard
              icon="🚗"
              title="Auto Rentals"
              desc="Browse vehicles, verify quickly, pay securely, and manage your rental in one place."
              bullets={[
                "Verification before handoff",
                "Damage documentation + history",
                "Policies shown before payment",
              ]}
              href="/auto"
              cta="Browse vehicles"
            />

            <ServiceCard
              icon="📄"
              title="Couranr Docs"
              desc="Document help, printing/scanning, and appointment-based paperwork assistance (including immigration/DMV support)."
              bullets={[
                "Administrative help only (no legal advice)",
                "Appointment-based support",
                "Clear disclaimers + customer responsibility",
              ]}
              href="/docs"
              cta="Learn more"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="section">
          <h2 className="sectionTitle">How it works</h2>

          <div className="steps">
            <div className="step">
              <div className="stepNum">1</div>
              <h3 className="stepTitle">Choose a service</h3>
              <p className="stepDesc">
                Courier, Auto, or Docs — each has a clear flow and checkout.
              </p>
            </div>

            <div className="step">
              <div className="stepNum">2</div>
              <h3 className="stepTitle">Verify + confirm</h3>
              <p className="stepDesc">
                Verification may be required for safety and fraud prevention.
              </p>
            </div>

            <div className="step">
              <div className="stepNum">3</div>
              <h3 className="stepTitle">Manage everything in one portal</h3>
              <p className="stepDesc">
                Track delivery status, view rental info, upload photos, and keep history.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>

          <div className="faq">
            <FAQItem
              q="Is Couranr Docs a law firm or legal service?"
              a="No. Couranr Docs provides administrative/document assistance only (help organizing information, typing forms, printing/scanning, appointment coordination). We do not provide legal advice and we do not guarantee approvals."
            />
            <FAQItem
              q="Do you guarantee delivery times?"
              a="We provide estimated windows and status updates, but traffic, weather, access issues, and recipient availability can affect timing."
            />
            <FAQItem
              q="What items can’t be delivered?"
              a="Illegal items, hazardous materials, weapons, and restricted items are not accepted. Specific restrictions may be shown during checkout."
            />
            <FAQItem
              q="Why do you ask for ID verification?"
              a="To reduce fraud, protect customers and assets, and support dispute resolution and safety."
            />
          </div>

          <p className="finePrint">
            This site provides general information. Final rules, pricing, and eligibility
            are shown at checkout and inside your portal.
          </p>
        </section>

        {/* ABOUT */}
        <section className="section">
          <h2 className="sectionTitle">About Couranr</h2>
          <div className="aboutGrid">
            <div className="aboutCard">
              <h3 className="aboutTitle">Built for clarity</h3>
              <p className="aboutDesc">
                One domain. Three focused services. Straightforward pricing and policies.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Built for trust</h3>
              <p className="aboutDesc">
                Verification, documentation, and tracking are designed to reduce disputes.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Built for speed</h3>
              <p className="aboutDesc">
                Quick checkout + portal management so customers can move fast.
              </p>
            </div>
          </div>
        </section>

        {/* CONTACT (no form — email only) */}
        <section className="section">
          <h2 className="sectionTitle">Contact</h2>
          <p className="sectionSub">
            For general questions, email us. For active bookings, use the customer portal.
          </p>

          <div className="contactRow">
            <span className="emailPill">
              ✉️{" "}
              <a className="mutedLink" href="mailto:couranr@couranrauto.com">
                couranr@couranrauto.com
              </a>
            </span>

            <Link className="btn btnGhost" href="/login">
              Open customer portal
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function ServiceCard({
  icon,
  title,
  desc,
  bullets,
  href,
  cta,
}: {
  icon: string;
  title: string;
  desc: string;
  bullets: string[];
  href: string;
  cta: string;
}) {
  return (
    <div className="card">
      <div className="cardIcon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <ul className="cardList">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <Link className="cardCta" href={href}>
        {cta} →
      </Link>
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