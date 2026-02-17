import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      <section className="hero">
        <div className="heroInner">
          <div className="heroTop">
            <div className="badges">
              <span className="badge">Local • Fast • Trusted</span>
              <span className="badge badgeGhost">One platform</span>
            </div>
          </div>

          <h1 className="heroTitle">
            Local services, <span className="heroAccent">built clean</span>.
          </h1>

          <p className="heroDesc">
            Courier delivery, document help, and auto rentals — with a simple flow and one portal to manage everything after checkout.
          </p>

          <div className="heroActions">
            <Link className="btn btnPrimary" href="/courier">
              Start a delivery quote
            </Link>
            <Link className="btn btnSecondary" href="/auto">
              Browse vehicles
            </Link>
            <Link className="btn btnGhost" href="/login">
              Customer portal
            </Link>
          </div>

          <div className="servicePills">
            <span className="pillRow">
              <span className="pillItem">🚚 Courier</span>
              <span className="pillItem">📄 Docs</span>
              <span className="pillItem">🚗 Auto</span>
            </span>
            <span className="pillHint">Clear pricing • Fast flow • Track everything after checkout</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <div>
            <div className="kicker">Services</div>
            <h2 className="h2">Pick what you need</h2>
            <p className="p">Simple flows. Clear pricing. Track everything after checkout.</p>
          </div>
        </div>

        <div className="cardGrid">
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
            desc="Print, scan, notarize, and deliver documents securely."
            href="/docs"
            cta="View docs"
          />
          <ServiceCard
            icon="🚗"
            title="Auto Rentals"
            desc="Affordable rentals and a guided flow from booking to pickup."
            href="/auto"
            cta="Browse vehicles"
          />
        </div>
      </section>

      <section className="section">
        <div className="card cardSoft">
          <div className="kicker">How it works</div>
          <h2 className="h2">Request → confirm → manage</h2>

          <div className="howGrid">
            <HowStep n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
            <HowStep n="2" title="Confirm details" desc="Review price and requirements. Upload what’s needed." />
            <HowStep n="3" title="Track & manage" desc="Log in anytime to see status, receipts, and next steps." />
          </div>

          <div className="howActions">
            <Link className="btn btnPrimary" href="/login">
              Go to portal
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

function ServiceCard(props: { icon: string; title: string; desc: string; href: string; cta: string }) {
  return (
    <div className="card interactiveCard">
      <div>
        <div className="cardIcon" aria-hidden="true">
          {props.icon}
        </div>
        <h3 className="cardTitle">{props.title}</h3>
        <p className="cardDesc">{props.desc}</p>
      </div>

      <Link className="cardCta" href={props.href}>
        {props.cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function HowStep(props: { n: string; title: string; desc: string }) {
  return (
    <div className="card">
      <div className="howStepTop">
        <span className="howNum">{props.n}</span>
        <div className="howTitle">{props.title}</div>
      </div>
      <p className="howDesc">{props.desc}</p>
    </div>
  );
}