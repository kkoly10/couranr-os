import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function DocsPage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <section className="hero">
          <div className="heroCard">
            <div className="badgeRow">
              <span className="badge">Fast document help</span>
              <span className="badge ghost">Clerical support only</span>
            </div>

            <h1 className="heroTitle">Couranr Docs</h1>
            <p className="heroDesc">
              Printing, scan & delivery, typing, resume support, business data-entry help, and
              document-prep assistance for DMV and immigration paperwork — all in one flow.
            </p>

            <div className="heroActions">
              <Link className="btn btnGold" href="/docs/request">
                Start a docs request →
              </Link>
              <Link className="btn btnGhost" href="/docs/pricing">
                View pricing
              </Link>
              <Link className="btn btnGhost" href="/login?next=%2Fdashboard%2Fdocs">
                Track requests
              </Link>
            </div>

            <div className="heroMiniGrid" aria-label="Docs flow">
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">📤</span>
                  <span className="miniTitle">Upload</span>
                </div>
                <p className="miniDesc">Send files and tell us what you need done.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🛠️</span>
                  <span className="miniTitle">Process</span>
                </div>
                <p className="miniDesc">We handle printing, prep, typing, or clerical support.</p>
              </div>
              <div className="mini">
                <div className="miniTop">
                  <span className="miniIcon">🚗</span>
                  <span className="miniTitle">Deliver</span>
                </div>
                <p className="miniDesc">Local delivery/pickup or digital handoff based on the job.</p>
              </div>
            </div>

            <p className="finePrint">
              Couranr Docs provides administrative/document assistance only — not legal advice, not
              a law firm, and not affiliated with USCIS, DMV, or any government agency. You are
              responsible for the accuracy and truthfulness of all information and submissions.
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">What we do</h2>
          <p className="sectionSub">
            Think “FedEx Office + admin support” with a cleaner online workflow.
          </p>

          <div className="cardGrid">
            <InfoCard
              icon="🖨️"
              title="Print / scan / deliver"
              desc="Upload files, choose print options, and request local delivery or pickup."
              bullets={[
                "Black & white or color printing",
                "Scan to PDF / email handoff",
                "Local delivery or pickup scheduling",
              ]}
            />

            <InfoCard
              icon="⌨️"
              title="Typing & resume support"
              desc="Need something typed, cleaned up, or reviewed? We help with clerical formatting and edits."
              bullets={[
                "Typing from image or notes",
                "Resume formatting + review support",
                "Basic document cleanup",
              ]}
            />

            <InfoCard
              icon="📊"
              title="Business data entry help"
              desc="For businesses overwhelmed with paperwork, we can support clerical backlogs and structured entry."
              bullets={[
                "Invoice / form entry support",
                "Spreadsheet-ready organization",
                "Overflow admin support",
              ]}
            />

            <InfoCard
              icon="🧾"
              title="DMV & immigration prep help"
              desc="Clerical support only: checklists, typing, printing, and packet organization."
              bullets={[
                "Readiness checklist",
                "Packet assembly",
                "No legal advice",
              ]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">How it works</h2>

          <div className="steps">
            <div className="step">
              <div className="stepNum">1</div>
              <h3 className="stepTitle">Create request</h3>
              <p className="stepDesc">
                Choose a service, add instructions, and upload your files.
              </p>
            </div>
            <div className="step">
              <div className="stepNum">2</div>
              <h3 className="stepTitle">Review & pay</h3>
              <p className="stepDesc">
                See pricing before checkout. We review your request and confirm details.
              </p>
            </div>
            <div className="step">
              <div className="stepNum">3</div>
              <h3 className="stepTitle">Track status</h3>
              <p className="stepDesc">
                Follow progress in your Docs dashboard from submitted to completed.
              </p>
            </div>
          </div>

          <div className="heroActions" style={{ marginTop: 16 }}>
            <Link className="btn btnGold" href="/docs/request">
              Start request →
            </Link>
            <Link className="btn btnGhost" href="/docs/pricing">
              Pricing
            </Link>
            <a className="btn btnGhost" href="mailto:couranr@couranrauto.com">
              Email support
            </a>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>
          <div className="faq">
            <FAQItem
              q="Do you provide legal advice for immigration or DMV?"
              a="No. Couranr Docs provides clerical and administrative support only (typing, organizing, printing/scanning, checklists, and packet preparation help). If you need legal advice, consult a licensed attorney or accredited representative."
            />
            <FAQItem
              q="Can businesses use this for admin backlogs?"
              a="Yes. We can support structured clerical work such as data entry, document sorting, and form typing for businesses that need overflow help."
            />
            <FAQItem
              q="Do you guarantee approvals?"
              a="No. Government decisions and timelines are outside our control. We help prepare and organize documents, but approvals are never guaranteed."
            />
            <FAQItem
              q="Are you affiliated with USCIS or DMV?"
              a="No. Couranr is an independent service provider and not a government agency."
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
