import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import { serviceImageSets } from "@/lib/serviceImages";
import { COURIER_SERVICE_RADIUS_MILES, DOCS_SERVICE_RADIUS_MILES, SERVICE_AREA_NOTE, SERVICE_HUB } from "@/lib/serviceArea";

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

            <h1 className="heroTitle">Local logistics and document support for busy people and small teams.</h1>

            <p className="heroDesc">
              Get same-day courier quotes, reserve verified auto rentals, and submit document requests
              in one account with transparent pricing and live status updates.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/courier/quote">
                Get instant quote →
              </Link>
              <Link className="btn btnGhost" href="#services">
                See services
              </Link>
              <Link className="btn btnGhost" href="/terms">
                Terms
              </Link>
            </div>

            <p className="sectionSub" style={{ marginTop: 8 }}>
              New visitor? Start with a quote. Existing customer? <Link className="mutedLink" href="/portal">Open your portal</Link>.
            </p>

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
          <h2 className="sectionTitle">Who Couranr is for</h2>
          <p className="sectionSub">
            We currently serve local households, professionals, and small businesses that need reliable
            logistics with documented workflows.
          </p>
          <div className="cardGrid">
            <div className="card">
              <div className="cardIcon" aria-hidden="true">🏠</div>
              <h3 className="cardTitle">Busy households</h3>
              <p className="cardDesc">Help with errands, deliveries, and document tasks without juggling multiple apps.</p>
            </div>
            <div className="card">
              <div className="cardIcon" aria-hidden="true">💼</div>
              <h3 className="cardTitle">Professionals on deadlines</h3>
              <p className="cardDesc">Quick courier and docs support when time-sensitive items cannot wait.</p>
            </div>
            <div className="card">
              <div className="cardIcon" aria-hidden="true">🏢</div>
              <h3 className="cardTitle">Small business teams</h3>
              <p className="cardDesc">Recurring operational support with one dashboard and trackable activity history.</p>
            </div>
          </div>
        </section>

        <section className="section" id="services">
          <h2 className="sectionTitle">What we do</h2>
          <p className="sectionSub">
            Straightforward rules, no hidden fees, and everything tracked in your dashboard.
          </p>

          <div className="cardGrid">
            <ServiceCard
              image={serviceImageSets.auto[0]}
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
              image={serviceImageSets.courier[0]}
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
              image={serviceImageSets.docs[0]}
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
          <h2 className="sectionTitle">Service area</h2>
          <p className="sectionSub">{SERVICE_AREA_NOTE}</p>
          <div className="cardGrid">
            <div className="card">
              <h3 className="cardTitle">Courier delivery radius</h3>
              <p className="cardDesc">Up to <strong>{COURIER_SERVICE_RADIUS_MILES} miles</strong> from {" "}
                <strong>{SERVICE_HUB}</strong> for courier deliveries.</p>
            </div>
            <div className="card">
              <h3 className="cardTitle">Document delivery radius</h3>
              <p className="cardDesc">Up to <strong>{DOCS_SERVICE_RADIUS_MILES} miles</strong> from {" "}
                <strong>{SERVICE_HUB}</strong> for document deliveries.</p>
            </div>
            <div className="card">
              <h3 className="cardTitle">Primary coverage</h3>
              <p className="cardDesc">We regularly serve Stafford, Fredericksburg, Woodbridge, and nearby towns.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Transparent pricing snapshot</h2>
          <p className="sectionSub">Quick starting ranges so you can qualify fit before entering full checkout flows.</p>
          <div className="cardGrid">
            <div className="card">
              <h3 className="cardTitle">Courier Delivery</h3>
              <p className="cardDesc">Starts at <strong>$15.00</strong> base (includes first 4 miles), plus distance and options.</p>
              <Link className="cardCta" href="/courier/quote" style={{ color: "var(--gold)", display: "block", marginTop: 10 }}>View exact quote calculator →</Link>
            </div>
            <div className="card">
              <h3 className="cardTitle">Auto Rentals</h3>
              <p className="cardDesc">Daily pricing varies by vehicle class, availability, and verification status.</p>
              <Link className="cardCta" href="/auto/vehicles" style={{ color: "var(--gold)", display: "block", marginTop: 10 }}>Browse vehicles & rates →</Link>
            </div>
            <div className="card">
              <h3 className="cardTitle">Couranr Docs</h3>
              <p className="cardDesc">Task-based pricing with clear scope before payment. No hidden add-ons.</p>
              <Link className="cardCta" href="/docs/pricing" style={{ color: "var(--gold)", display: "block", marginTop: 10 }}>See docs pricing →</Link>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Proof and reliability</h2>
          <p className="sectionSub">Signals that help first-time customers trust the workflow before checkout.</p>
          <div className="cardGrid">
            <div className="card"><h3 className="cardTitle">Documented status trail</h3><p className="cardDesc">Every request follows trackable status updates across intake, processing, and completion.</p></div>
            <div className="card"><h3 className="cardTitle">Evidence-first operations</h3><p className="cardDesc">Photo proof and time-stamped records are used where applicable to reduce disputes.</p></div>
            <div className="card"><h3 className="cardTitle">Human support by email</h3><p className="cardDesc">Questions and exceptions can be handled by support instead of an automated-only flow.</p></div>
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
          <h2 className="sectionTitle">Why Couranr</h2>
          <p className="sectionSub">
            A local operator model designed to be clearer than marketplace-style handoffs.
          </p>
          <div className="aboutGrid">
            <div className="aboutCard">
              <h3 className="aboutTitle">One account, three service lines</h3>
              <p className="aboutDesc">
                Courier, auto, and docs requests are managed in one customer portal with shared history.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Verification + policy gates</h3>
              <p className="aboutDesc">
                Eligibility checks and policy reminders are shown before payment, not after issues appear.
              </p>
            </div>
            <div className="aboutCard">
              <h3 className="aboutTitle">Trackable operational record</h3>
              <p className="aboutDesc">
                Time-stamped updates and evidence workflows create cleaner resolution paths when questions come up.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>

          <div className="faq">
            <FAQItem
              q="What areas do you serve?"
              a={`Courier service is available up to ${COURIER_SERVICE_RADIUS_MILES} miles and document delivery up to ${DOCS_SERVICE_RADIUS_MILES} miles from ${SERVICE_HUB}. We primarily serve Stafford, Fredericksburg, Woodbridge, and surrounding towns.`}
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
  image,
  icon,
  title,
  desc,
  bullets,
  href,
  cta,
}: {
  image: string;
  icon: string;
  title: string;
  desc: string;
  bullets: string[];
  href: string;
  cta: string;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <img
        src={image}
        alt={`${title} service image`}
        style={{ width: "100%", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 12, objectFit: "cover", maxHeight: 180 }}
      />
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
