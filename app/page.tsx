import Link from "next/link";

export default function HomePage() {
  return (
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
            Courier delivery, document help, and auto rentals — managed in one portal after checkout.
          </p>

          <div className="heroActions">
            <Link className="btn btnPrimary" href="/courier">
              Start a delivery quote →
            </Link>
            <Link className="btn btnGhost" href="/auto">
              Browse vehicles
            </Link>
            <Link className="btn btnGhost" href="/login">
              Customer portal
            </Link>
          </div>
        </section>

        <section className="section">
          <div className="cardGrid">
            <Card
              icon="🚚"
              title="Courier Delivery"
              desc="Same-day and scheduled local deliveries with transparent pricing."
              href="/courier"
              cta="Get a quote"
            />
            <Card
              icon="🚗"
              title="Auto Rentals"
              desc="Browse vehicles, verify quickly, and manage your rental in one place."
              href="/auto"
              cta="Browse vehicles"
            />
            <Card
              icon="📄"
              title="Document Services"
              desc="Print, scan, notarize, and deliver documents securely. (Coming soon)"
              href="/docs"
              cta="View docs"
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({
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
    <div className="card">
      <div className="cardIcon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <Link className="cardCta" href={href}>
        {cta} →
      </Link>
    </div>
  );
}