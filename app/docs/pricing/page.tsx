import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function DocsPricingPage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Transparent pricing</span>
              <span className="badge ghost">Final quote shown at checkout</span>
            </div>

            <h1 className="heroTitle">Couranr Docs Pricing</h1>
            <p className="heroDesc">
              Simple pricing for fast document work. Final pricing is confirmed after request details,
              file count, and delivery options are reviewed.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/docs/request">
                Start a docs request →
              </Link>
              <Link className="btn btnGhost" href="/login?next=%2Fdashboard%2Fdocs">
                Track requests
              </Link>
            </div>

            <p className="finePrint">
              Prices below are starting ranges for transparency. Complex jobs, urgent turnarounds,
              large files, or same-day requests may cost more.
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Printing & document handling</h2>
          <p className="sectionSub">Fast, small transactions similar to a print office workflow.</p>

          <div className="cardGrid">
            <PriceCard
              icon="🖨️"
              title="Print only"
              price="$5–$25+"
              bullets={[
                "Small jobs / basic print runs",
                "Price varies by pages, color, and paper",
                "Pickup or delivery options available",
              ]}
            />
            <PriceCard
              icon="📠"
              title="Scan / PDF prep"
              price="$5–$20+"
              bullets={[
                "Scan to PDF/email handoff",
                "Basic file naming / organization",
                "Multi-page packet scanning supported",
              ]}
            />
            <PriceCard
              icon="🚗"
              title="Local delivery add-on"
              price="$10–$35+"
              bullets={[
                "Based on distance and urgency",
                "Can be bundled with print or scanning",
                "Rush delivery may cost more",
              ]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">Typing, resume, and admin support</h2>
          <p className="sectionSub">Clerical support for individuals and businesses.</p>

          <div className="cardGrid">
            <PriceCard
              icon="⌨️"
              title="Typing / document entry"
              price="$15–$75+"
              bullets={[
                "Typing from notes, images, or PDFs",
                "Formatting and cleanup",
                "Price depends on length/complexity",
              ]}
            />
            <PriceCard
              icon="📄"
              title="Resume review & formatting"
              price="$25–$85+"
              bullets={[
                "Resume formatting and cleanup",
                "Job-targeted organization support",
                "Cover letter add-on optional",
              ]}
            />
            <PriceCard
              icon="📊"
              title="Business data-entry help"
              price="$35/hr+ or per-job"
              bullets={[
                "Overflow clerical support",
                "Invoice/form entry and cleanup",
                "Bulk/admin backlog pricing available",
              ]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">DMV & immigration document prep support</h2>
          <p className="sectionSub">
            Administrative assistance only — no legal advice or legal representation.
          </p>

          <div className="cardGrid">
            <PriceCard
              icon="🧾"
              title="Document prep support"
              price="$30–$150+"
              bullets={[
                "Typing, printing, packet assembly",
                "Checklist / readiness support",
                "No legal advice or guarantees",
              ]}
            />
            <PriceCard
              icon="📅"
              title="Appointment prep support"
              price="$20–$75+"
              bullets={[
                "Document readiness review",
                "Checklist and organization help",
                "Scheduling support when applicable",
              ]}
            />
            <PriceCard
              icon="⚡"
              title="Rush / same-day add-on"
              price="+$10–$60"
              bullets={[
                "Priority handling",
                "Subject to workload and file size",
                "Shown before checkout",
              ]}
            />
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h2 className="cardTitle">Important notes</h2>
            <ul className="cardList">
              <li>Final price is confirmed before you pay.</li>
              <li>Large/complex requests may require a custom quote.</li>
              <li>Couranr Docs is administrative support only — not legal advice.</li>
              <li>You are responsible for the accuracy and truthfulness of all documents submitted.</li>
            </ul>

            <div className="heroActions" style={{ marginTop: 14 }}>
              <Link className="btn btnGold" href="/docs/request">
                Start request →
              </Link>
              <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
                Ask a question
              </a>
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function PriceCard({
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
        Starting: {price}
      </p>
      <ul className="cardList">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
