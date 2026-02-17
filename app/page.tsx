// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="home">
      <div className="homeBackdrop" aria-hidden="true" />

      <section className="hero">
        <div className="container">
          <div className="heroGrid">
            <div className="heroLeft">
              <div className="pillRow">
                <span className="pill">Auto • Fast • Trusted</span>
                <span className="pill ghost">One platform</span>
              </div>

              <h1 className="heroTitle">
                Local services powered by one OS
              </h1>

              <p className="heroDesc">
                Delivery, document help, and auto services — built for speed, clarity, and trust.
              </p>

              <div className="heroActions">
                <Link className="btn btnPrimary" href="/courier">
                  Get a delivery quote
                </Link>
                <Link className="btn btnSecondary" href="/auto">
                  Browse vehicles
                </Link>
                <Link className="btn btnGhost" href="/docs">
                  Document services
                </Link>
              </div>

              <div className="microTrust">
                <span className="microItem">Clear pricing</span>
                <span className="microDot">•</span>
                <span className="microItem">Fast flow</span>
                <span className="microDot">•</span>
                <span className="microItem">Manage in one portal</span>
              </div>
            </div>

            <aside className="quickCard">
              <div className="quickTitle">Quick start</div>
              <p className="quickDesc">
                Pick a service and move fast. It’s simple to confirm details and track progress.
              </p>

              <div className="quickLinks">
                <Link className="quickLink" href="/courier">
                  <span className="quickIcon" aria-hidden="true">🚚</span>
                  <span className="quickText">Courier delivery</span>
                  <span className="quickArrow" aria-hidden="true">›</span>
                </Link>

                <Link className="quickLink" href="/auto">
                  <span className="quickIcon" aria-hidden="true">🚗</span>
                  <span className="quickText">Auto rentals</span>
                  <span className="quickArrow" aria-hidden="true">›</span>
                </Link>

                <Link className="quickLink" href="/docs">
                  <span className="quickIcon" aria-hidden="true">📄</span>
                  <span className="quickText">
                    Document services <span className="quickSoon">Coming soon</span>
                  </span>
                  <span className="quickArrow" aria-hidden="true">›</span>
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="sectionHead">
            <div>
              <div className="kicker">Services</div>
              <h2 className="h2">Pick what you need</h2>
              <p className="p">
                Simple flows. Clear pricing. Track everything after checkout.
              </p>
            </div>

            <Link className="btn btnSecondary" href="/signup">
              Create account
            </Link>
          </div>

          <div className="serviceGrid">
            <ServiceCard
              icon="🚚"
              title="Courier Delivery"
              desc="Same-day and scheduled local deliveries with transparent pricing."
              href="/courier"
              cta="Get a quote"
            />
            <ServiceCard
              icon="📄"
              title="Document Services"
              desc="Print, scan, notarize, and deliver important documents securely."
              href="/docs"
              cta="View services"
            />
            <ServiceCard
              icon="🚗"
              title="Auto Services"
              desc="Affordable rentals and fleet solutions for work and personal needs."
              href="/auto"
              cta="Browse vehicles"
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="howCard">
            <div className="kicker">How it works</div>
            <h2 className="h2">Request → confirm → track</h2>

            <div className="steps">
              <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
              <Step n="2" title="Confirm details" desc="Review price and requirements. Upload anything needed." />
              <Step n="3" title="Track & manage" desc="See status, receipts, and next steps in one place." />
            </div>

            <div className="howActions">
              <Link className="btn btnPrimary" href="/courier">
                Start with Courier
              </Link>
              <Link className="btn btnGhost" href="/auto">
                Or browse Auto
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section sectionBottom">
        <div className="container">
          <div className="finalCta">
            <div>
              <h2 className="h2">Ready to start?</h2>
              <p className="p">Create an account to save progress and manage everything in one portal.</p>
            </div>
            <div className="finalActions">
              <Link className="btn btnPrimary" href="/signup">
                Create account
              </Link>
              <Link className="btn btnSecondary" href="/courier">
                Get a quote
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ServiceCard({
  icon,
  title,
  desc,
  href,
  cta,
}: {
  icon: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="card interactiveCard">
      <div className="cardTop">
        <div className="cardIcon" aria-hidden="true">{icon}</div>
        <h3 className="cardTitle">{title}</h3>
        <p className="cardDesc">{desc}</p>
      </div>

      <Link className="cardCta" href={href}>
        {cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="stepCard">
      <div className="stepHead">
        <span className="stepNum" aria-hidden="true">{n}</span>
        <div className="stepTitle">{title}</div>
      </div>
      <p className="stepDesc">{desc}</p>
    </div>
  );
}