// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      <header className="homeHero cardSoft">
        <div className="badgeRow">
          <span className="badge">Local • Fast • Trusted</span>
          <span className="badge ghost">Clean tech</span>
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
          <Link className="btn btn-gold" href="/courier">
            Get a delivery quote →
          </Link>
          <Link className="btn btn-secondary" href="/auto">
            Browse vehicles
          </Link>
          <Link className="btn btn-ghost" href="/login">
            Log in
          </Link>
        </div>
      </header>

      <section className="section">
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="kicker">What you can do</div>
            <h2 className="h2" style={{ marginTop: 10 }}>Pick a service and move fast</h2>
            <p className="p">Simple flows. Clear pricing. A portal to manage everything after checkout.</p>
          </div>
          <Link className="btn btn-secondary" href="/signup">
            Create account
          </Link>
        </div>

        <div className="cardGrid" style={{ marginTop: 18 }}>
          <Card icon="🚚" title="Courier Delivery" description="Same-day and scheduled local deliveries with transparent pricing." href="/courier" cta="Get a quote" />
          <Card icon="📄" title="Document Services" description="Print, scan, notarize, and deliver documents securely." href="/docs" cta="View services" />
          <Card icon="🚗" title="Auto Services" description="Affordable rentals and fleet solutions." href="/auto" cta="Browse vehicles" />
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 72 }}>
        <div className="card cardSoft" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="kicker">Customer portal</div>
            <h2 className="h2" style={{ marginTop: 10 }}>Already started something?</h2>
            <p className="p">Log in to complete verification, sign agreements, and manage orders.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/login">Log in</Link>
            <Link className="btn btn-gold" href="/signup">Create account</Link>
          </div>
        </div>
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
        <div className="cardIcon" aria-hidden="true">{icon}</div>
        <h2 className="cardTitle">{title}</h2>
        <p className="cardDesc">{description}</p>
      </div>

      <Link className="cardCta" href={href}>
        {cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}