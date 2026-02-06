// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      {/* Ambient background */}
      <div className="bgGlow" aria-hidden="true" />

      <header className="homeHero">
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
          Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.
        </p>

        <div className="heroActions">
          <Link className="btn btnPrimary" href="/auto">
            Browse vehicles
          </Link>
          <Link className="btn btnSecondary" href="/courier">
            Get a delivery quote
          </Link>
          <Link className="btn btnGhost" href="/login">
            Log in
          </Link>
        </div>
      </header>

      <section className="cardGrid">
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
          description="Affordable vehicle rentals and fleet solutions."
          href="/auto"
          cta="Browse vehicles"
        />
      </section>

      <section className="homeCTA">
        <div className="homeCTACard">
          <h2 className="homeCTATitle">Customer portal</h2>
          <p className="homeCTADesc">
            Already started a booking? Log in to complete verification, sign the agreement, and pay.
          </p>
          <div className="homeCTAActions">
            <Link className="btn btnPrimary" href="/login">
              Log in to continue
            </Link>
            <Link className="btn btnSecondary" href="/auto">
              Start a new rental
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
        <div className="cardIcon" aria-hidden="true">
          {icon}
        </div>

        <h2 className="cardTitle">{title}</h2>
        <p className="cardDesc">{description}</p>
      </div>

      <Link className="cardCta" href={href}>
        {cta} <span className="arrow" aria-hidden="true">→</span>
      </Link>
    </div>
  );
}