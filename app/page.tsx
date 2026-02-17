// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      {/* Marketing top bar (SAFE: no admin links, no auth logic) */}
      <header className="topbar">
        <div className="topbarInner">
          <Link href="/" className="brand">
            <span className="brandMark">C</span>
            <span className="brandText">
              Couranr <span className="brandDot">•</span>
            </span>
          </Link>

          <nav className="topnav" aria-label="Primary navigation">
            <Link className="topnavLink" href="/courier">
              Courier
            </Link>
            <Link className="topnavLink" href="/docs">
              Docs
            </Link>
            <Link className="topnavLink" href="/auto">
              Auto
            </Link>
          </nav>

          <div className="topbarActions">
            <Link className="btn btnGhost btnSm" href="/login">
              Log in
            </Link>
            <Link className="btn btnPrimary btnSm" href="/signup">
              Create account
            </Link>
          </div>
        </div>
      </header>

      {/* HERO (Option B: split hero with “panel” on the right) */}
      <section className="hero cardSoft">
        <div className="heroGrid">
          <div className="heroLeft">
            <div className="badgeRow">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge ghost">One platform</span>
            </div>

            <h1 className="heroTitle">
              Couranr
              <span className="heroTitleDot">•</span>
              <span className="heroTitleSub">Local services powered by one OS</span>
            </h1>

            <p className="heroDesc">
              Delivery, document help, and auto services — built for speed, clarity, and trust.
            </p>

            <div className="heroActions">
              <Link className="btn btnPrimary" href="/courier">
                Get a delivery quote <span aria-hidden="true">→</span>
              </Link>
              <Link className="btn btnSecondary" href="/auto">
                Browse vehicles
              </Link>
              <Link className="btn btnGhost" href="/login">
                Customer portal
              </Link>
            </div>
          </div>

          <div className="heroRight">
            <div className="heroPanel">
              <div className="panelKicker">Quick start</div>

              <div className="panelCard">
                <div className="panelTitle">Courier delivery</div>
                <div className="panelDesc">Get a quote, checkout, track status.</div>
                <Link className="panelLink" href="/courier">
                  Start quote <span aria-hidden="true">→</span>
                </Link>
              </div>

              <div className="panelCard">
                <div className="panelTitle">Auto rentals</div>
                <div className="panelDesc">Browse cars, verify, sign, pay.</div>
                <Link className="panelLink" href="/auto">
                  Browse cars <span aria-hidden="true">→</span>
                </Link>
              </div>

              <div className="panelCard">
                <div className="panelTitle">Docs services</div>
                <div className="panelDesc">Print/scan + delivery options.</div>
                <Link className="panelLink" href="/docs">
                  View docs <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="section">
        <div className="sectionHeader">
          <div>
            <div className="kicker">What you can do</div>
            <h2 className="h2">Pick a service and move fast</h2>
            <p className="p">Simple flows. Clear pricing. A portal to manage everything after checkout.</p>
          </div>

          <Link className="btn btnSecondary" href="/signup">
            Create account
          </Link>
        </div>

        <div className="cardGrid">
          <Card
            icon="🚚"
            title="Courier Delivery"
            description="Same-day and scheduled local deliveries with transparent pricing."
            href="/courier"
            cta="Get a quote"
          />
          <Card
            icon="📄"
            title="Document Services"
            description="Print, scan, notarize, and deliver documents securely."
            href="/docs"
            cta="View services"
          />
          <Card
            icon="🚗"
            title="Auto Services"
            description="Affordable rentals and fleet solutions."
            href="/auto"
            cta="Browse vehicles"
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="card cardSoft">
          <div className="kicker">How it works</div>
          <h2 className="h2">A clean flow from request → confirmation</h2>

          <div className="steps">
            <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
            <Step n="2" title="Confirm details" desc="Review the price and requirements. Upload anything needed." />
            <Step n="3" title="Track & manage" desc="Log in anytime to see status, receipts, and next steps." />
          </div>

          <div className="ctaRow">
            <Link className="btn btnPrimary" href="/login">
              Go to customer portal
            </Link>
            <Link className="btn btnGhost" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="section sectionLast">
        <div className="card ctaCard">
          <div>
            <h2 className="h2">Already started something?</h2>
            <p className="p">Log in to complete verification, sign agreements, and manage orders.</p>
          </div>

          <div className="ctaRow">
            <Link className="btn btnPrimary" href="/login">
              Log in
            </Link>
            <Link className="btn btnSecondary" href="/signup">
              Create account
            </Link>
          </div>
        </div>

        <footer className="miniFooter">
          <div>© {new Date().getFullYear()} Couranr</div>
          <div className="miniFooterLinks">
            <Link href="/privacy">Privacy</Link>
            <span aria-hidden="true">•</span>
            <Link href="/terms">Terms</Link>
          </div>
        </footer>
      </section>
    </main>
  );
}

function Card({
  icon,
  title,
  description,
  href,
  cta,
}: {
  icon: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="card interactiveCard">
      <div>
        <div className="cardIcon" aria-hidden="true">
          {icon}
        </div>
        <h2 className="cardTitle">{title}</h2>
        <p className="cardDesc">{description}</p>
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
      <div className="stepTop">
        <span className="stepNum">{n}</span>
        <div className="stepTitle">{title}</div>
      </div>
      <p className="stepDesc">{desc}</p>
    </div>
  );
}