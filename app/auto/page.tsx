import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function AutoPage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Verification-first</span>
              <span className="badge ghost">Transparent policies</span>
            </div>

            <h1 className="heroTitle">Auto rentals, built for trust.</h1>
            <p className="heroDesc">
              Browse vehicles, verify quickly, and manage your rental in one portal.
              Clear rules, documentation, and payment flow—designed to reduce disputes.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/auto/vehicles">
                Browse vehicles →
              </Link>
              <Link className="btn btnGhost" href="/dashboard/auto">
                Customer portal
              </Link>
              <Link className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                Email support
              </Link>
            </div>

            <div className="heroMiniGrid" aria-label="Auto flow">
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🪪</span>
                  <span className="miniTitle">Verify</span>
                </div>
                <p className="miniDesc">ID checks help prevent fraud and improve safety.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🧾</span>
                  <span className="miniTitle">Agree</span>
                </div>
                <p className="miniDesc">Policies are shown before payment and pickup.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">📸</span>
                  <span className="miniTitle">Document</span>
                </div>
                <p className="miniDesc">Photos + condition records help resolve issues fast.</p>
              </div>
            </div>

            <p className="finePrint">
              Coverage availability and renter responsibility are defined at checkout and inside the rental agreement.
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">What you can expect</h2>
          <p className="sectionSub">A simple flow with clear rules and strong documentation.</p>

          <div className="cardGrid">
            <InfoCard
              icon="✅"
              title="Clear eligibility"
              desc="Basic requirements are confirmed before pickup to avoid surprises."
              bullets={["Account verification", "Accurate info required", "Fraud prevention checks"]}
            />
            <InfoCard
              icon="🧠"
              title="Straightforward rules"
              desc="No confusion—key restrictions are shown in the flow and agreement."
              bullets={["No unauthorized drivers", "No illegal activity", "Return expectations"]}
            />
            <InfoCard
              icon="🛡️"
              title="Reduced disputes"
              desc="Documentation and portal history help resolve issues professionally."
              bullets={["Photos when applicable", "Receipts + records", "Support trail"]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>
          <div className="faq">
            <FAQItem
              q="Do you require verification?"
              a="Verification may be required before a rental is approved. This helps reduce fraud and supports safety and dispute resolution."
            />
            <FAQItem
              q="Where do I manage my rental?"
              a="After checkout, your rental details, steps, and history are managed in the customer portal."
            />
            <FAQItem
              q="Do you guarantee availability?"
              a="Availability can change. Final confirmation happens after verification and approval."
            />
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function InfoCard({
  icon,
  title,
  desc,
  bullets,
}: {
  icon: string;
  title: string;
  desc: string;
  bullets: string[];
}) {
  return (
    <div className="card">
      <div className="cardIcon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="cardTitle">{title}</h3>
      <p className="cardDesc">{desc}</p>
      <ul className="cardList">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="faqItem">
      <summary className="faqQ">{q}</summary>
      <div className="faqA">{a}</div>
    </details>
  );
}
