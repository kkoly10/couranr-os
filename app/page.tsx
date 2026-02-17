// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <div className="topbarInner">
          <Link href="/" className="brand" aria-label="Couranr home">
            <span className="brandMark" aria-hidden="true">
              <span className="brandMarkC">C</span>
              <span className="brandMarkDot" />
            </span>
            <span className="brandWord">Couranr</span>
          </Link>

          <nav className="topbarLinks" aria-label="Primary navigation">
            <Link className="toplink" href="/courier">Courier</Link>
            <Link className="toplink" href="/docs">Docs</Link>
            <Link className="toplink" href="/auto">Auto</Link>
          </nav>

          <div className="topbarActions">
            <Link className="toplink" href="/login">Log in</Link>
            <Link className="btn btnPrimary" href="/signup">Create account</Link>
          </div>
        </div>
      </header>

      <main className="home">
        <div className="bgGlow" aria-hidden="true" />

        {/* HERO (revised statement) */}
        <section className="homeHero">
          <div className="badgeRow">
            <span className="badge">Local • Fast • Trusted</span>
            <span className="badge ghost">One portal</span>
          </div>

          <h1 className="heroTitle">One portal for local services.</h1>

          <p className="heroDesc">
            Courier, docs, and auto — request in minutes, then track everything in one place.
          </p>

          <div className="heroActions">
            <Link className="btn btnPrimary" href="/courier">Get a delivery quote</Link>
            <Link className="btn btnSecondary" href="/auto">Browse vehicles</Link>
            <Link className="btn btnGhost" href="/docs">Docs (coming soon)</Link>
          </div>
        </section>

        {/* QUICK START */}
        <section className="section">
          <div className="kicker">Quick start</div>
          <h2 className="h2" style={{ marginTop: 10 }}>Pick a service and move fast</h2>
          <p className="p">
            Simple flows, clear pricing, and one portal to manage everything after checkout.
          </p>

          <div className="cardGrid">
            <Card
              icon="🚚"
              title="Courier delivery"
              description="Same-day and scheduled local deliveries with transparent pricing."
              href="/courier"
              cta="Get a quote"
            />
            <Card
              icon="🚗"
              title="Auto rentals"
              description="Affordable rentals and fleet solutions for work and personal needs."
              href="/auto"
              cta="Browse vehicles"
            />
            <Card
              icon="📄"
              title="Document services"
              description="Print, scan, notarize, and deliver important documents securely."
              href="/docs"
              cta="View services"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="section">
          <div className="card cardSoft">
            <div className="kicker">How it works</div>
            <h2 className="h2" style={{ marginTop: 10 }}>Request → confirm → track</h2>
            <p className="p">
              A clean flow from first request to completion, with updates in one place.
            </p>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
              <Step n="2" title="Confirm details" desc="Review price and requirements. Upload anything needed." />
              <Step n="3" title="Track & manage" desc="See status, receipts, and next steps in one place." />
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn btnPrimary" href="/courier">Start with Courier</Link>
              <Link className="btn btnSecondary" href="/auto">Or browse Auto</Link>
            </div>
          </div>
        </section>

        {/* SINGLE FINAL CTA (no extra login spam) */}
        <section className="section" style={{ paddingBottom: 24 }}>
          <div className="card">
            <h2 className="h2">Ready to start?</h2>
            <p className="p">Create an account to save progress and manage everything in one portal.</p>

            <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn btnPrimary" href="/signup">Create account</Link>
              <Link className="btn btnSecondary" href="/courier">Get a quote</Link>
            </div>
          </div>
        </section>
      </main>
    </>
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
        <div className="cardIcon" aria-hidden="true">{icon}</div>
        <h3 className="cardTitle">{title}</h3>
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
    <div className="card" style={{ background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background: "rgba(201,162,39,0.14)",
            border: "1px solid rgba(201,162,39,0.28)",
            fontWeight: 950,
          }}
        >
          {n}
        </span>
        <div style={{ fontWeight: 950 }}>{title}</div>
      </div>
      <p style={{ marginTop: 10, color: "rgba(71,85,105,0.95)" }}>{desc}</p>
    </div>
  );
}