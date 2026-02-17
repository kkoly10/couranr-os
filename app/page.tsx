// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      <header className="homeHero">
        <div className="badgeRow">
          <span className="badge">Local • Fast • Trusted</span>
          <span className="badge ghost">One platform</span>
        </div>

        <h1 className="heroTitle">
          Local services powered by one OS
          <span className="heroTitleDot">•</span>
          <span className="heroTitleSub">Couranr</span>
        </h1>

        <p className="heroDesc">
          Delivery, document help, and auto services — built for speed, clarity, and trust.
        </p>

        <div className="heroActions">
          <Link className="btn btn-primary" href="/courier">
            Start with Courier
          </Link>
          <Link className="btn btn-secondary" href="/auto">
            Browse vehicles
          </Link>
          <Link className="btn btn-ghost" href="/docs">
            Docs (coming soon)
          </Link>
        </div>
      </header>

      <section className="section">
        <div className="kicker">Quick start</div>
        <h2 className="h2" style={{ marginTop: 10 }}>
          Pick a service and move fast
        </h2>
        <p className="p">
          Simple flows. Clear pricing. Track everything after checkout.
        </p>

        <div className="cardGrid" style={{ marginTop: 18 }}>
          <ServiceCard
            icon="🚚"
            title="Courier Delivery"
            description="Same-day and scheduled local deliveries with transparent pricing."
            href="/courier"
            cta="Get a quote"
          />
          <ServiceCard
            icon="🚗"
            title="Auto Rentals"
            description="Affordable rentals and flexible options for work or personal use."
            href="/auto"
            cta="Browse vehicles"
          />
          <ServiceCard
            icon="📄"
            title="Document Services"
            description="Print, scan, notarize, and deliver documents securely. (Coming soon)"
            href="/docs"
            cta="View services"
          />
        </div>
      </section>

      <section className="section">
        <div className="card cardSoft">
          <div className="kicker">How it works</div>
          <h2 className="h2" style={{ marginTop: 10 }}>
            Request → confirm → track
          </h2>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <Step n="1" title="Start a request" desc="Choose Courier or Auto and answer a few quick questions." />
            <Step n="2" title="Confirm details" desc="Review price and requirements. Upload anything needed." />
            <Step n="3" title="Track & manage" desc="See status, receipts, and next steps in one place." />
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/courier">
              Get a courier quote
            </Link>
            <Link className="btn btn-secondary" href="/auto">
              Browse vehicles
            </Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 12 }}>
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 className="h2">Ready to start?</h2>
            <p className="p">
              Create an account to save progress and manage everything in one portal.
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/signup">
              Create account
            </Link>
            <Link className="btn btn-secondary" href="/courier">
              Get a quote
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
            background: "rgba(212,175,55,0.14)",
            border: "1px solid rgba(212,175,55,0.28)",
            fontWeight: 950,
          }}
        >
          {n}
        </span>
        <div style={{ fontWeight: 950 }}>{title}</div>
      </div>
      <p style={{ marginTop: 10, marginBottom: 0, color: "rgba(71,85,105,0.95)" }}>{desc}</p>
    </div>
  );
}