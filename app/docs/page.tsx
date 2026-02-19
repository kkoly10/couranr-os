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
              <span className="badge">Appointments</span>
              <span className="badge ghost">Administrative help</span>
            </div>

            <h1 className="heroTitle">Document help, without the confusion.</h1>
            <p className="heroDesc">
              Printing/scanning, form organization, and appointment-based paperwork support —
              including immigration and DMV-related assistance.
            </p>

            <div className="heroActions">
              <a className="btn btnGold" href="mailto:couranr@couranrauto.com">
                Email to book →
              </a>
              <Link className="btn btnGhost" href="/login">
                Customer portal
              </Link>
              <Link className="btn btnGhost" href="/privacy">
                Privacy policy
              </Link>
            </div>

            <p className="finePrint">
              Couranr Docs provides administrative/document assistance only — not legal advice, not a law firm,
              not affiliated with USCIS/DMV, and no outcome is guaranteed. You are responsible for accuracy and
              truthfulness of all submissions.
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">What we help with</h2>
          <p className="sectionSub">
            Support is clerical/organizational—designed to help you prepare and submit correctly.
          </p>

          <div className="cardGrid">
            <InfoCard
              icon="🖨️"
              title="Print / scan / organize"
              desc="Prepare clean PDFs, print packets, scan to email, and keep files structured."
              bullets={["PDF cleanup (when possible)", "Scanning + file naming", "Packet assembly"]}
            />
            <InfoCard
              icon="🧾"
              title="Form assistance"
              desc="Typing and organizing information into forms you provide (no legal guidance)."
              bullets={["Data entry/typing", "Checklists + missing-items review", "Upload assistance"]}
            />
            <InfoCard
              icon="📅"
              title="Appointments"
              desc="Appointment-based support for DMV/immigration-related paperwork steps."
              bullets={["Scheduling support", "Document readiness checklist", "Reminders + prep notes"]}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">How it works</h2>

          <div className="steps">
            <div className="step">
              <div className="stepNum">1</div>
              <h3 className="stepTitle">Email your request</h3>
              <p className="stepDesc">
                Tell us what you need, your city, and preferred times.
              </p>
            </div>
            <div className="step">
              <div className="stepNum">2</div>
              <h3 className="stepTitle">Bring/upload documents</h3>
              <p className="stepDesc">
                We’ll tell you what to bring/upload so nothing is missing.
              </p>
            </div>
            <div className="step">
              <div className="stepNum">3</div>
              <h3 className="stepTitle">Complete the appointment</h3>
              <p className="stepDesc">
                Administrative support + file organization to help you submit properly.
              </p>
            </div>
          </div>

          <div className="contactRow" style={{ marginTop: 16 }}>
            <span className="emailPill">
              ✉️{" "}
              <a className="mutedLink" href="mailto:couranr@couranrauto.com">
                couranr@couranrauto.com
              </a>
            </span>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionTitle">FAQ</h2>
          <div className="faq">
            <FAQItem
              q="Do you provide legal advice for immigration or DMV?"
              a="No. We provide administrative assistance only (typing, organizing, printing/scanning, uploading, appointment coordination). If you need legal advice, consult a licensed attorney or accredited representative."
            />
            <FAQItem
              q="Do you guarantee approvals?"
              a="No. Government decisions and processing timelines are outside our control. You are responsible for the accuracy and truthfulness of submissions."
            />
            <FAQItem
              q="Are you affiliated with USCIS or the DMV?"
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