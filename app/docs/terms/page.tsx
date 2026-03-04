import Link from "next/link";
import { DOCS_TERMS_VERSION } from "@/lib/docsTerms";

export default function DocsTermsPage() {
  return (
    <main className="page" style={{ padding: 24 }}>
      <div className="cContainer" style={{ maxWidth: 900 }}>
        <h1 style={{ marginTop: 0 }}>Docs Service Terms</h1>
        <p style={{ color: "#4b5563" }}>
          Effective version: <strong>{DOCS_TERMS_VERSION}</strong>. These terms apply to Couranr Docs services and are designed for
          print/scan centers and clerical support workflows similar to major office-service providers.
        </p>

        <section>
          <h3>1) Scope of service</h3>
          <p>
            Couranr Docs provides administrative support services such as printing, scanning, packet assembly,
            data entry, resume formatting, and local handoff/delivery coordination.
          </p>
          <p>
            We are not a law firm, not legal representatives, and not affiliated with any government agency.
            Immigration/DMV support is clerical preparation only.
          </p>
        </section>

        <section>
          <h3>2) Customer responsibilities</h3>
          <ul>
            <li>You are responsible for the accuracy, completeness, and legality of all submitted materials.</li>
            <li>You confirm you have rights/permission to reproduce all files you upload.</li>
            <li>You must review final outputs before official filing or distribution.</li>
          </ul>
        </section>

        <section>
          <h3>3) Quotes, pricing, and changes</h3>
          <ul>
            <li>Quotes are based on scope at review time and may change if files/instructions change.</li>
            <li>Additional work (rush edits, reprints, formatting corrections) can incur extra charges.</li>
            <li>Payment may be required before completion or release of final deliverables.</li>
          </ul>
        </section>

        <section>
          <h3>4) Turnaround and delivery</h3>
          <ul>
            <li>Timelines are estimates, not guaranteed unless explicitly confirmed in writing.</li>
            <li>Delivery/pickup windows can vary by traffic, file quality, and service volume.</li>
            <li>Delays caused by unclear instructions, unreadable files, or third-party services are not our liability.</li>
          </ul>
        </section>

        <section>
          <h3>5) Data handling and file retention</h3>
          <ul>
            <li>Uploaded files are stored to process your order and provide support.</li>
            <li>For security and storage management, files may be removed after a retention period.</li>
            <li>Keep your own backup copies of all originals and final outputs.</li>
          </ul>
        </section>

        <section>
          <h3>6) Refunds and rework</h3>
          <ul>
            <li>Service fees may be non-refundable once work has started.</li>
            <li>If output does not match provided instructions, we may offer reasonable rework.</li>
            <li>Refund decisions consider completed labor, materials consumed, and confirmed scope.</li>
          </ul>
        </section>

        <section>
          <h3>7) Liability limits</h3>
          <p>
            To the fullest extent permitted by law, Couranr Docs is not liable for indirect, incidental, or
            consequential losses, filing outcomes, penalties, lost profits, or missed opportunities. Our direct
            liability is limited to the amount paid for the specific affected service.
          </p>
        </section>

        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/docs/request" className="btn btnGold">
            Back to Docs Request
          </Link>
          <Link href="/terms" className="btn btnGhost">
            View Site Terms
          </Link>
        </div>
      </div>
    </main>
  );
}
