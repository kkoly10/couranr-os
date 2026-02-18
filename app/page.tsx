// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <div className="bgGlow" aria-hidden="true" />

      {/* HERO */}
      <section className="heroCard">
        <div className="badgeRow">
          <span className="badge">Local • Fast • Trusted</span>
          <span className="badge ghost">One platform</span>
        </div>

        <h1 className="heroTitle">Local services, built clean.</h1>
        <p className="heroDesc">
          Courier delivery, document assistance, and auto rentals — request online, confirm fast, then manage everything in your portal.
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

        <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          <strong>Important:</strong> Docs services are assistance-only (no legal advice). Courier availability depends on scheduling and service area.
        </div>
      </section>

      {/* SERVICES */}
      <section className="section">
        <div className="sectionHeader">
          <div>
            <div className="kicker">Services</div>
            <h2 className="h2">Pick a service and move fast</h2>
            <p className="p">
              Clear steps, transparent expectations, and a portal to track progress after you start.
            </p>
          </div>
          <Link className="btn btnSecondary" href="/signup">
            Create account
          </Link>
        </div>

        <div className="cardGrid">
          <Card
            icon="🚚"
            title="Courier Delivery"
            desc="Same-day and scheduled local deliveries with clear pricing and tracking."
            bullets={[
              "Local pickup + drop-off",
              "Business or personal deliveries",
              "Photo / status updates (where available)",
            ]}
            href="/courier"
            cta="Get a quote"
          />
          <Card
            icon="🚗"
            title="Auto Rentals"
            desc="Affordable rentals with a guided process: verification, agreement, payment, pickup/return."
            bullets={[
              "Short-term and weekly rentals",
              "Verification + agreement flow",
              "Support for receipts and records",
            ]}
            href="/auto"
            cta="Browse vehicles"
          />
          <Card
            icon="📄"
            title="Document Services"
            desc="Print/scan + paperwork assistance and appointment support for common tasks."
            bullets={[
              "Print, scan, copy, deliver (where available)",
              "DMV paperwork assistance + appointment help",
              "Immigration form assistance (clerical only)",
            ]}
            href="/docs"
            cta="View services"
          />
        </div>

        <div className="noticeCard" style={{ marginTop: 16 }}>
          <strong>Docs disclaimer:</strong> We are not a law firm and do not provide legal advice or representation.
          We provide clerical help (organizing, typing, translating where offered, uploading, and scheduling support).
          Outcomes (USCIS/DMV approval) are not guaranteed.
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="card cardSoft">
          <div className="kicker">How it works</div>
          <h2 className="h2">A clean flow from request → confirmation</h2>

          <div className="stepGrid">
            <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
            <Step n="2" title="Confirm details" desc="Review requirements, pricing, and timing. Upload what’s needed." />
            <Step n="3" title="Track in your portal" desc="Log in to see status, receipts, and next steps." />
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btnPrimary" href="/login">
              Go to customer portal
            </Link>
            <Link className="btn btnGhost" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="sectionHeader">
          <div>
            <div className="kicker">FAQ</div>
            <h2 className="h2">Common questions</h2>
            <p className="p">Short answers now — and we’ll expand as Couranr grows.</p>
          </div>
        </div>

        <div className="faqGrid">
          <FAQ
            q="Is Couranr the same as Uber/TaskRabbit?"
            a="No. Couranr is a local service platform with structured workflows (quotes, confirmation, receipts, portal tracking)."
          />
          <FAQ
            q="Do you guarantee delivery time or approvals?"
            a="Courier timing depends on scheduling, traffic, and service conditions. For Docs (USCIS/DMV), we do not guarantee approvals — we assist with preparation and organization only."
          />
          <FAQ
            q="What items can’t be delivered?"
            a="No illegal items, hazardous materials, weapons, or anything prohibited by law or carrier rules. We may refuse items for safety or compliance."
          />
          <FAQ
            q="Do you provide legal advice for immigration or DMV?"
            a="No. We provide clerical assistance only (typing, organizing, uploading, scheduling support). For legal advice, use a licensed attorney or accredited representative."
          />
          <FAQ
            q="Why do you collect ID/selfie for rentals?"
            a="For safety, fraud prevention, and to complete rental verification. See our Privacy Policy for what we collect and how it’s protected."
          />
          <FAQ
            q="How do I contact support?"
            a="Use the Contact section below or message us through the portal after you log in."
          />
        </div>
      </section>

      {/* ABOUT */}
      <section className="section">
        <div className="card">
          <div className="kicker">About</div>
          <h2 className="h2">Built for speed, clarity, and trust</h2>
          <p className="p" style={{ maxWidth: 860 }}>
            Couranr is one platform for local services — courier delivery, document help, and auto rentals — designed with
            simple flows, clear requirements, and a customer portal that keeps everything organized.
          </p>

          <div className="aboutGrid">
            <MiniCard title="Clear steps" desc="Know what happens next: confirm, upload, sign, pay, track." />
            <MiniCard title="Receipts & records" desc="Keep everything documented in your portal." />
            <MiniCard title="Local-first" desc="Focused on fast service, honest expectations, and practical support." />
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="section" style={{ paddingBottom: 64 }}>
        <div className="card cardSoft">
          <div className="kicker">Contact</div>
          <h2 className="h2">Need help or have a question?</h2>
          <p className="p" style={{ maxWidth: 860 }}>
            For the fastest support, log in and use your portal. For general questions, use the options below.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <Link className="btn btnPrimary" href="/login">
              Message in portal
            </Link>
            <Link className="btn btnSecondary" href="/terms">
              Terms
            </Link>
            <Link className="btn btnSecondary" href="/privacy">
              Privacy
            </Link>
          </div>

          <div className="noticeCard" style={{ marginTop: 14 }}>
            <strong>Safety note:</strong> In emergencies, call local emergency services. Couranr support is not emergency response.
          </div>
        </div>
      </section>
    </main>
  );
}

function Card({
  icon,
  title,
  desc,
  bullets,
  href,
  cta,
}: {
  icon: string;
  title: string;
  desc: string;
  bullets: string[];
  href: string;
  cta: string;
}) {
  return (
    <div className="card interactiveCard">
      <div>
        <div className="cardIcon" aria-hidden="true">
          {icon}
        </div>
        <h3 className="cardTitle">{title}</h3>
        <p className="cardDesc">{desc}</p>

        <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18, color: "var(--muted)" }}>
          {bullets.map((b) => (
            <li key={b} style={{ marginTop: 6 }}>
              {b}
            </li>
          ))}
        </ul>
      </div>

      <Link className="cardCta" href={href}>
        {cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
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
            background: "rgba(184,134,11,0.12)",
            border: "1px solid rgba(184,134,11,0.30)",
            fontWeight: 950,
          }}
        >
          {n}
        </span>
        <div style={{ fontWeight: 950 }}>{title}</div>
      </div>
      <p style={{ marginTop: 10, marginBottom: 0, color: "rgba(71,85,105,0.95)" }}>{desc}</p>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div className="card">
      <div style={{ fontWeight: 950, marginBottom: 8 }}>{q}</div>
      <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>{a}</div>
    </div>
  );
}

function MiniCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card" style={{ background: "#fff" }}>
      <div style={{ fontWeight: 950 }}>{title}</div>
      <div style={{ marginTop: 8, color: "var(--muted)" }}>{desc}</div>
    </div>
  );
}