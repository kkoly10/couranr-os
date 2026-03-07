import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function BuildPage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Website Builder • Step 2 of 2</span>
              <span className="badge ghost">Marketing + quote prep</span>
            </div>

            <h1 className="heroTitle">Build a website that sells while you sleep.</h1>
            <p className="heroDesc">
              You completed the intro. Now choose the website package that fits your goals,
              timeline, and budget. This is your final step before receiving a custom website
              quote.
            </p>

            <div className="heroActions">
              <a className="btn btnGold" href="mailto:couranr@couranrauto.com?subject=Website%20Builder%20Quote%20Request">
                Request your quote →
              </a>
              <Link className="btn btnGhost" href="/terms">
                Terms
              </Link>
              <Link className="btn btnGhost" href="/">
                Back to Step 1
              </Link>
            </div>

            <div className="heroMiniGrid" aria-label="Website builder process">
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">1️⃣</span>
                  <span className="miniTitle">Introduction</span>
                </div>
                <p className="miniDesc">Clarify your business goals, audience, and offer.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">2️⃣</span>
                  <span className="miniTitle">Build & quote</span>
                </div>
                <p className="miniDesc">Select your package and submit project details.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🚀</span>
                  <span className="miniTitle">Launch</span>
                </div>
                <p className="miniDesc">Approve the proposal, then we design and launch.</p>
              </div>
            </div>

            <p className="finePrint">
              Quotes are tailored to your goals. Final pricing depends on pages, copywriting,
              integrations, and timeline.
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Popular website packages</h2>
          <p className="sectionSub">Start lean or scale big — we can match your growth stage.</p>

          <div className="cardGrid">
            <PackageCard
              icon="⚡"
              title="Starter site"
              price="$499+"
              bullets={[
                "Up to 3 pages",
                "Mobile-responsive design",
                "Lead form + basic SEO setup",
              ]}
            />
            <PackageCard
              icon="📈"
              title="Growth site"
              price="$1,200+"
              bullets={[
                "Up to 8 pages",
                "Conversion-focused layout",
                "Analytics + booking/payment integration",
              ]}
            />
            <PackageCard
              icon="🏆"
              title="Premium brand site"
              price="$2,500+"
              bullets={[
                "Custom design system",
                "Advanced funnel pages",
                "CRM/email automation integration",
              ]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">What to prepare for a fast quote</h2>
          <div className="steps">
            <div className="step">
              <div className="stepNum">1</div>
              <h3 className="stepTitle">Business details</h3>
              <p className="stepDesc">Business name, industry, and core services/products.</p>
            </div>
            <div className="step">
              <div className="stepNum">2</div>
              <h3 className="stepTitle">Content & branding</h3>
              <p className="stepDesc">Logo, brand colors, and examples of websites you like.</p>
            </div>
            <div className="step">
              <div className="stepNum">3</div>
              <h3 className="stepTitle">Goals & timeline</h3>
              <p className="stepDesc">Your launch target date and what success looks like.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle">Ready for your custom website quote?</h2>
            <p className="cardDesc">
              Tell us your package preference and project goals. We will send a personalized plan
              with scope, timeline, and pricing.
            </p>
            <div className="heroActions" style={{ marginTop: 14 }}>
              <a className="btn btnGold" href="mailto:couranr@couranrauto.com?subject=Custom%20Website%20Quote">
                Submit quote request →
              </a>
              <Link className="btn btnGhost" href="/">
                Review intro step
              </Link>
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function PackageCard({
  icon,
  title,
  price,
  bullets,
}: {
  icon: string;
  title: string;
  price: string;
  bullets: string[];
}) {
  return (
    <div className="card">
      <div className="cardIcon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc" style={{ fontWeight: 800 }}>
        Starting at {price}
      </p>
      <ul className="cardList">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}
