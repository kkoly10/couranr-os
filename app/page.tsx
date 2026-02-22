import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function HomePage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        {/* 1. HERO */}
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge ghost">One platform</span>
            </div>

            <h1 className="heroTitle">Local services, managed in one place.</h1>

            <p className="heroDesc">
              Auto rentals, courier delivery, and document assistance. Clear upfront pricing, strict verification for safety, and one seamless portal to track it all.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/auto/vehicles">
                Browse vehicles →
              </Link>
              <Link className="btn btnGhost" href="/courier/quote">
                Start a delivery quote
              </Link>
              <Link className="btn btnGhost" href="/portal">
                Customer portal
              </Link>
            </div>

            <p className="finePrint">
              Couranr Docs provides administrative/document assistance only — not legal
              advice, not a government agency, and no outcome is guaranteed.
            </p>
          </div>
        </section>

        {/* 2. SERVICES (The single source of truth for what you do) */}
        <section className="section">
          <h2 className="sectionTitle">What we do</h2>
          <p className="sectionSub">
            Straightforward rules, no hidden fees, and everything tracked in your dashboard.
          </p>

          <div className="cardGrid">
            <ServiceCard
              icon="🚗"
              title="Auto Rentals"
              desc="Browse vehicles, verify your ID, pay securely, and manage your rental in one place."
              bullets={[
                "Secure ID & selfie verification",
                "Damage documentation + history",
                "Policies shown before payment",
              ]}
              href="/auto/vehicles"
              cta="Browse vehicles"
            />

            <ServiceCard
              icon="🚚"
              title="Courier Delivery"
              desc="Same-day and scheduled local delivery with transparent pricing and live tracking."
              bullets={[
                "Real-time status updates",
                "Photo proof of pickup & drop-off",
                "Clear prohibited-item rules",
              ]}
              href="/courier/quote"
              cta="Get a quote"
            />

            <ServiceCard
              icon="📄"
              title="Couranr Docs"
              desc="Document help, printing/scanning, and appointment-based paperwork assistance."
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

        {/* 3. HOW IT WORKS */}
        <section className="section">
          <h2 className="sectionTitle">Built for Trust & Clarity</h2>

          <div className="steps">
            <div className="step">
              <div className="stepNum">1</div>
              <h3 className="stepTitle">Choose & Book</h3>
              <p className="stepDesc">
                Choose your service. Our upfront pricing and clear agreements mean no surprises.
              </p>
            </div>

            <div className="step">
              <div className="stepNum">2</div>
              <h3 className="stepTitle">Verify Identity</h3>
              <p className="stepDesc">
                We utilize strict ID and selfie verification to protect our assets and prevent fraud.
              </p>
            </div>

            <div className="step">
              <div className="stepNum">3</div>
              <h3 className="stepTitle">Manage in the Portal</h3>
              <p className="stepDesc">
                Track driver status, unlock rental lockboxes, and upload photos all from your dashboard.
              </p>
            </div>
          </div>
        </section>

        {/* 4. FAQ */}
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
              q="Why do you ask for ID verification?"
              a="To reduce fraud, protect customers and assets, and strictly enforce our rental and delivery policies."
            />
          </div>

          <p className="finePrint" style={{ marginTop: '16px' }}>
            This site provides general information. Final rules, pricing, and eligibility
            are shown at checkout and inside your portal.
          </p>
        </section>

        {/* 5. CONTACT (Restored!) */}
        <section className="section">
          <h2 className="sectionTitle">Contact</h2>
          <p className="sectionSub">
            For general questions, email us. For active bookings, use the customer portal.
          </p>

          <div className="contactRow">
            <span className="emailPill" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "14px", border: "1px solid var(--border)", background: "#fff", fontWeight: 700 }}>
              ✉️{" "}
              <a className="mutedLink" style={{ color: "var(--text)" }} href="mailto:couranr@couranrauto.com">
                couranr@couranrauto.com
              </a>
            </span>

            <Link className="btn btnGhost" href="/portal">
              Open customer portal
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function ServiceCard({ icon, title, desc, bullets, href, cta }: { icon: string; title: string; desc: string; bullets: string[]; href: string; cta: string; }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="cardIcon" aria-hidden="true">{icon}</div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <ul className="cardList" style={{ flexGrow: 1 }}>
        {bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>
      <Link className="cardCta" href={href} style={{ color: "var(--gold)", paddingTop: "14px", marginTop: "10px", display: "block" }}>
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
