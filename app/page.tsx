// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <header className="publicHeader">
        <div className="c-container publicHeaderInner">
          <Link className="brandRow" href="/" aria-label="Couranr home">
            <span className="brandMark">
              C<span className="brandDot">.</span>
            </span>
            <span className="brandName">Couranr</span>
          </Link>

          <nav className="publicNav" aria-label="Primary">
            <Link href="/auto">Auto</Link>
            <Link href="/courier">Courier</Link>
            <Link href="/docs">Docs</Link>
          </nav>

          <div className="publicActions">
            <Link className="btn btnGhost" href="/login">
              Log in
            </Link>
            <Link className="btn btnPrimary" href="/signup">
              Create account
            </Link>
          </div>
        </div>
      </header>

      <main className="home">
        <div className="bgGlow" aria-hidden="true" />

        <div className="c-container">
          <section className="heroCard">
            <div className="badgeRow">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge ghost">One platform</span>
            </div>

            <h1 className="heroTitle">Local services, built clean.</h1>

            <p className="heroDesc">
              Courier delivery, document help, and auto rentals — with a simple flow and one portal
              to manage everything after checkout.
            </p>

            <div className="heroActions">
              <Link className="btn btnPrimary" href="/courier">
                Start a delivery quote →
              </Link>
              <Link className="btn btnSecondary" href="/auto">
                Browse vehicles
              </Link>
              <Link className="btn btnGhost" href="/login">
                Customer portal
              </Link>
            </div>
          </section>

          <section className="section" style={{ marginTop: 26 }}>
            <div>
              <div className="kicker">Services</div>
              <h2 className="h2" style={{ marginTop: 10 }}>
                Pick what you need
              </h2>
              <p className="p">Simple flows. Clear pricing. Track everything after checkout.</p>
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
                icon="🚗"
                title="Auto Rentals"
                description="Browse vehicles, verify quickly, and manage your rental in one place."
                href="/auto"
                cta="Browse vehicles"
              />
              <Card
                icon="📄"
                title="Document Services"
                description="Print, scan, notarize, and deliver documents securely. (Coming soon)"
                href="/docs"
                cta="View docs"
              />
            </div>
          </section>

          <section className="section">
            <div className="card">
              <div className="kicker">How it works</div>
              <h2 className="h2" style={{ marginTop: 10 }}>
                Request → confirm → track
              </h2>
              <p className="p">
                Start with a quick quote. Confirm details. Track status and receipts in your portal.
              </p>

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <Step n="1" title="Start a request" desc="Choose a service and answer a few questions." />
                <Step n="2" title="Confirm details" desc="Review price and requirements; upload what’s needed." />
                <Step n="3" title="Track in portal" desc="Manage orders, receipts, and next steps after checkout." />
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function Card(props: { icon: string; title: string; description: string; href: string; cta: string }) {
  return (
    <div className="card interactiveCard">
      <div>
        <div className="cardIcon" aria-hidden="true">{props.icon}</div>
        <h3 className="cardTitle">{props.title}</h3>
        <p className="cardDesc">{props.description}</p>
      </div>
      <Link className="cardCta" href={props.href}>
        {props.cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Step(props: { n: string; title: string; desc: string }) {
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
            background: "rgba(201,162,39,0.12)",
            border: "1px solid rgba(201,162,39,0.28)",
            fontWeight: 950,
          }}
        >
          {props.n}
        </span>
        <div style={{ fontWeight: 950 }}>{props.title}</div>
      </div>
      <p style={{ marginTop: 10, marginBottom: 0, color: "rgba(71,85,105,0.95)" }}>{props.desc}</p>
    </div>
  );
}