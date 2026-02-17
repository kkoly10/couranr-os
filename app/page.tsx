// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      {/* HERO */}
      <section className="hero">
        <div className="heroLeft">
          <div className="kickerRow">
            <span className="kickerPill">Local • Fast • Trusted</span>
            <span className="kickerPill ghost">One platform</span>
          </div>

          <h1 className="h1">
            Local services,
            <br />
            powered by one OS.
          </h1>

          <p className="lead">
            Courier delivery, document help, and auto rentals — with a simple flow and a portal to manage everything
            after checkout.
          </p>

          <div className="heroActions">
            <Link className="btn btn-gold" href="/courier">
              Start a delivery quote
            </Link>
            <Link className="btn btn-outline" href="/auto">
              Browse vehicles
            </Link>
            <Link className="btn btn-link" href="/login">
              Customer portal
            </Link>
          </div>

          <div className="microRow">
            <span className="microItem">Clear pricing</span>
            <span className="microDot">•</span>
            <span className="microItem">Fast flow</span>
            <span className="microDot">•</span>
            <span className="microItem">Manage in one portal</span>
          </div>
        </div>

        {/* Right side “preview card” (clean tech vibe, no images needed) */}
        <div className="heroRight">
          <div className="previewCard">
            <div className="previewTop">
              <div className="previewTitle">Quick start</div>
              <div className="previewSub">Pick a service and move fast</div>
            </div>

            <div className="previewList">
              <Link className="previewLink" href="/courier">
                <span className="previewIcon" aria-hidden="true">
                  🚚
                </span>
                <span className="previewText">
                  <span className="previewName">Courier delivery</span>
                  <span className="previewDesc">Get a quote → schedule → track</span>
                </span>
                <span className="previewChevron" aria-hidden="true">
                  ›
                </span>
              </Link>

              <Link className="previewLink" href="/auto">
                <span className="previewIcon" aria-hidden="true">
                  🚗
                </span>
                <span className="previewText">
                  <span className="previewName">Auto rentals</span>
                  <span className="previewDesc">Browse vehicles → verify → pay</span>
                </span>
                <span className="previewChevron" aria-hidden="true">
                  ›
                </span>
              </Link>

              <Link className="previewLink disabled" href="/docs" aria-disabled="true">
                <span className="previewIcon" aria-hidden="true">
                  📄
                </span>
                <span className="previewText">
                  <span className="previewName">Document services</span>
                  <span className="previewDesc">Coming soon</span>
                </span>
                <span className="previewTag">Soon</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="section">
        <div className="sectionHead">
          <div>
            <div className="eyebrow">Services</div>
            <h2 className="h2">Pick what you need</h2>
            <p className="p">
              Simple flows. Clear pricing. Track everything after checkout.
            </p>
          </div>
        </div>

        <div className="grid3">
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
            muted
          />
          <ServiceCard
            icon="🚗"
            title="Auto Services"
            desc="Affordable rentals and fleet solutions for work and personal needs."
            href="/auto"
            cta="Browse vehicles"
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="how">
          <div>
            <div className="eyebrow">How it works</div>
            <h2 className="h2">Request → confirm → track</h2>
            <p className="p">
              A clean flow from request to completion, with updates in your portal.
            </p>
          </div>

          <div className="howGrid">
            <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
            <Step n="2" title="Confirm details" desc="Review price and requirements. Upload anything needed." />
            <Step n="3" title="Track & manage" desc="See status, receipts, and next steps in one place." />
          </div>

          <div className="howActions">
            <Link className="btn btn-gold" href="/courier">
              Start with Courier
            </Link>
            <Link className="btn btn-outline" href="/auto">
              Or browse Auto
            </Link>
          </div>
        </div>
      </section>

      {/* SINGLE PORTAL CTA (only one on page) */}
      <section className="section sectionLast">
        <div className="cta">
          <div>
            <h2 className="h2">Ready to start?</h2>
            <p className="p">
              Create an account to save progress and manage everything in one portal.
            </p>
          </div>

          <div className="ctaActions">
            <Link className="btn btn-gold" href="/signup">
              Create account
            </Link>
            <Link className="btn btn-outline" href="/login">
              Log in
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function ServiceCard({
  icon,
  title,
  desc,
  href,
  cta,
  muted,
}: {
  icon: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  muted?: boolean;
}) {
  return (
    <div className={`card ${muted ? "cardMuted" : ""}`}>
      <div className="cardTop">
        <div className="cardIcon" aria-hidden="true">
          {icon}
        </div>
        <h3 className="h3">{title}</h3>
        <p className="p">{desc}</p>
      </div>

      <Link className="cardCta" href={href}>
        {cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="step">
      <div className="stepTop">
        <span className="stepNum" aria-hidden="true">
          {n}
        </span>
        <div className="stepTitle">{title}</div>
      </div>
      <div className="stepDesc">{desc}</div>
    </div>
  );
}