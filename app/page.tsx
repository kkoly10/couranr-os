// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      {/* Home-only top row (NO admin links) */}
      <div className="homeTop">
        <Link href="/" className="brandMini" aria-label="Couranr home">
          <span className="brandMark">
            C<span className="brandDot">.</span>
          </span>
          <span className="brandWord">Couranr</span>
        </Link>

        <div className="homeTopActions">
          <Link className="btn btnGhost" href="/login">
            Log in
          </Link>
          <Link className="btn btnPrimary" href="/courier">
            Get a quote
          </Link>
        </div>
      </div>

      {/* HERO: 2-column like mock 1-B */}
      <header className="homeHero">
        <div className="heroGrid">
          <div>
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
                Start a delivery →
              </Link>
              <Link className="btn btnSecondary" href="/auto">
                Browse vehicles
              </Link>
              <Link className="btn btnGhost" href="/signup">
                Create account
              </Link>
            </div>
          </div>

          <aside className="heroPanel">
            <h3 className="heroPanelTitle">Quick start</h3>
            <p className="heroPanelSub">
              Pick a service. We’ll guide you through a clean flow and you can manage everything in your portal.
            </p>

            <div className="heroPanelButtons">
              <Link className="pillBtn" href="/courier">
                <span>Courier delivery</span>
                <span className="pillMeta">Quote →</span>
              </Link>

              <Link className="pillBtn" href="/auto">
                <span>Auto rentals</span>
                <span className="pillMeta">Browse →</span>
              </Link>

              <Link className="pillBtn" href="/docs">
                <span>Document services</span>
                <span className="pillMeta">Coming soon →</span>
              </Link>
            </div>
          </aside>
        </div>
      </header>

      {/* SERVICES */}
      <section className="section">
        <div
          style={{
            display: "flex",
            alignItems: "flex-end", // ✅ FIX: was "end"
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="kicker">What you can do</div>
            <h2 className="h2" style={{ marginTop: 10 }}>
              Pick a service and move fast
            </h2>
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
          <h2 className="h2" style={{ marginTop: 10 }}>
            A clean flow from request → confirmation
          </h2>

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
            <Step n="3" title="Track & manage" desc="Log in anytime to see status, receipts, and next steps." />
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
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
      <section className="section">
        <div className="card">
          <h2 className="h2">Already started something?</h2>
          <p className="p">Log in to complete verification, sign agreements, and manage orders.</p>

          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btnPrimary" href="/login">
              Log in
            </Link>
            <Link className="btn btnSecondary" href="/signup">
              Create account
            </Link>
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
            background: "rgba(37,99,235,0.10)",
            border: "1px solid rgba(37,99,235,0.22)",
            fontWeight: 950,
            color: "rgba(29,78,216,1)",
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