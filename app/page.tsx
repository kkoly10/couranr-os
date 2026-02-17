// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="home">
      <div className="container">
        {/* HERO (Option A) */}
        <section className="section">
          <div className="card cardSoft heroGrid">
            <div className="heroLeft">
              <div className="kicker">Local services, one platform</div>

              <h1 className="h1" style={{ marginTop: 12 }}>
                Move fast with Couranr
                <span className="heroTitleAccent">.</span>
              </h1>

              <p className="p" style={{ fontSize: 16, maxWidth: 680 }}>
                Clean flows for courier delivery, document help, and auto services — plus a portal to track everything after checkout.
              </p>

              <div className="pillRow">
                <span className="pill pillGold">Same-day options</span>
                <span className="pill">Clear pricing</span>
                <span className="pill">Verified workflows</span>
              </div>

              <div className="btnRow" style={{ marginTop: 18 }}>
                <Link className="btn btnGold" href="/courier">
                  Get a delivery quote →
                </Link>
                <Link className="btn btnSoft" href="/auto">
                  Browse vehicles
                </Link>
                <Link className="btn btnGhost" href="/login">
                  Customer portal
                </Link>
              </div>
            </div>

            {/* Right panel (quick actions / proof) */}
            <aside className="heroRight">
              <div className="card cardPad" style={{ background: "rgba(255,255,255,0.92)" }}>
                <div className="kicker">Quick start</div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <Link className="btn btnSoft" href="/courier">
                    Courier → Quote & checkout
                  </Link>
                  <Link className="btn btnSoft" href="/auto">
                    Auto → View availability
                  </Link>
                  <Link className="btn btnSoft" href="/docs">
                    Docs → Services
                  </Link>
                </div>
              </div>

              <div className="card cardPad cardSoft">
                <div className="kicker">Why it feels easy</div>
                <p className="p" style={{ marginTop: 10 }}>
                  Request → confirm → track. No clutter. No confusion.
                </p>
              </div>
            </aside>
          </div>
        </section>

        {/* SERVICES */}
        <section className="section">
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div className="kicker">What you can do</div>
              <h2 className="h2" style={{ marginTop: 10 }}>
                Pick a service and move fast
              </h2>
              <p className="p">Simple flows. Clear requirements. A portal to manage everything after checkout.</p>
            </div>

            <Link className="btn btnSoft" href="/signup">
              Create account
            </Link>
          </div>

          <div className="cardGrid" style={{ marginTop: 16 }}>
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
              cta="View services"
            />
            <ServiceCard
              icon="🚗"
              title="Auto Services"
              desc="Affordable rentals and fleet solutions."
              href="/auto"
              cta="Browse vehicles"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="section">
          <div className="card cardPad cardSoft">
            <div className="kicker">How it works</div>
            <h2 className="h2" style={{ marginTop: 10 }}>
              A clean flow from request → confirmation
            </h2>
            <p className="p">Designed to reduce back-and-forth and keep everything trackable.</p>

            <div className="steps">
              <Step n="1" title="Start a request" desc="Choose Courier, Docs, or Auto and answer a few quick questions." />
              <Step n="2" title="Confirm details" desc="Review the price and requirements. Upload anything needed." />
              <Step n="3" title="Track & manage" desc="Log in anytime to see status, receipts, and next steps." />
            </div>

            <div className="btnRow" style={{ marginTop: 16 }}>
              <Link className="btn btnGold" href="/login">
                Go to customer portal
              </Link>
              <Link className="btn btnGhost" href="/dashboard">
                Open dashboard
              </Link>
            </div>
          </div>

          <div className="footerLite">
            © {new Date().getFullYear()} Couranr. Built for speed, clarity, and trust.
          </div>
        </section>
      </div>
    </div>
  );
}

function ServiceCard({ icon, title, desc, href, cta }: { icon: string; title: string; desc: string; href: string; cta: string }) {
  return (
    <div className="card serviceCard">
      <div className="serviceIcon" aria-hidden="true">{icon}</div>
      <div className="serviceTitle">{title}</div>
      <p className="serviceDesc">{desc}</p>

      <Link className="serviceLink" href={href}>
        {cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="card cardPad" style={{ background: "rgba(255,255,255,0.92)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="stepN">{n}</span>
        <div style={{ fontWeight: 950 }}>{title}</div>
      </div>
      <p className="p" style={{ marginTop: 10 }}>{desc}</p>
    </div>
  );
}