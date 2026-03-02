import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function HomePage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge ghost">One platform</span>
            </div>

            <h1 className="heroTitle">Local services, managed in one place.</h1>

            <p className="heroDesc">
              Book confidently with clear pricing, strong verification, and a single customer
              portal for tracking every request from start to finish.
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

            <div className="trustBar" aria-label="Trust signals">
              <span className="trustPill">Secure checkout</span>
              <span className="trustPill">Identity verification</span>
              <span className="trustPill">Photo proof workflows</span>
              <span className="trustPill">Live status tracking</span>
            </div>

            <p className="finePrint">
              Couranr Docs provides administrative/document assistance only — not legal advice,
              not a government agency, and no outcome is guaranteed.
            </p>
          </div>
        </section>

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
                Track driver status, unlock rental lockboxes, and upload photos all from your
                dashboard.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Operational Controls</h2>
          <p className="sectionSub">
            Designed for individuals, teams, and business operations that need reliability.
          </p>
          <div className="aboutGrid">
            <div className="aboutCard">
              <h3 className="aboutTitle">Audit-friendly records</h3>
              <p className="aboutDesc">
                Time-stamped status updates and photo verification help create clean service
                records.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Policy-first workflows</h3>
              <p className="aboutDesc">
                Eligibility checks, prohibited-item rules, and service policies are surfaced before
                completion.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Scalable support model</h3>
              <p className="aboutDesc">
                Built to support routine requests and higher-volume operations through a single
                portal.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>

          <div className="faq">
            <FAQItem
              q="What areas do you serve?"
              a="Service availability depends on route coverage and scheduling windows. You can confirm availability during quote and checkout flows."
            />
            <FAQItem
              q="Do you provide guaranteed delivery times?"
              a="We provide estimated windows and active tracking, but traffic, weather, access restrictions, and recipient readiness can affect timing."
            />
            <FAQItem
              q="How is identity and account security handled?"
              a="We use account-based authentication and verification controls where required to help reduce fraud and protect customer activity."
            />
            <FAQItem
              q="Is Couranr Docs a legal service?"
              a="No. Couranr Docs provides administrative/document assistance only and does not provide legal advice or guarantee outcomes."
            />
            <FAQItem
              q="Can businesses request recurring or bulk support?"
              a="Yes. Businesses can use the same platform for recurring requests and operational support, with clear workflow visibility for each order."
            />
          </div>

          <p className="finePrint" style={{ marginTop: "16px" }}>
            This site provides general information. Final rules, pricing, and eligibility are shown
            at checkout and inside your portal.
          </p>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Support</h2>
          <p className="sectionSub">
            Structured support for new inquiries and active customer requests.
          </p>

          <div className="cardGrid supportGrid">
            <div className="card">
              <h3 className="cardTitle">General inquiries</h3>
              <p className="cardDesc">
                For pricing, service questions, or pre-booking support.
              </p>
              <ul className="cardList">
                <li>
                  Email: <a className="mutedLink" href="mailto:couranr@couranrauto.com">couranr@couranrauto.com</a>
                </li>
                <li>Typical response: within 1 business day</li>
                <li>Best for first-time requests</li>
              </ul>
              <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                Contact support
              </a>
            </div>

            <div className="card">
              <h3 className="cardTitle">Active customers</h3>
              <p className="cardDesc">
                For live booking updates, uploads, and order tracking.
              </p>
              <ul className="cardList">
                <li>Track requests in real time</li>
                <li>Upload required verification files</li>
                <li>Manage ongoing orders in one portal</li>
              </ul>
              <Link className="btn btnGold" href="/portal">
                Open customer portal
              </Link>
            </div>
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
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="cardIcon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <ul className="cardList" style={{ flexGrow: 1 }}>
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <Link
        className="cardCta"
        href={href}
        style={{ color: "var(--gold)", paddingTop: "14px", marginTop: "10px", display: "block" }}
      >
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
