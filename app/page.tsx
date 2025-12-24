import Link from "next/link";
import SpecialRequestForm from "../components/SpecialRequestForm";

export default function HomePage() {
  return (
    <main>
      <section className="section">
        <div className="container">
          <div
            className="card"
            style={{
              padding: 28,
              background:
                "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(241,245,249,0.75) 100%)",
              borderColor: "rgba(226,232,240,0.95)"
            }}
          >
            <h1>
              Online services,
              <br />
              delivered to you.
            </h1>

            <p style={{ maxWidth: 720 }}>
              Courier delivery for <strong>documents</strong>,{" "}
              <strong>packages</strong>, <strong>boxes</strong>, and{" "}
              <strong>everyday items</strong> — ordered online, handled with
              photo verification, and delivered to your door.
            </p>

            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
              <Link href="/courier">
                <button className="btn btn-primary">Get a Delivery Quote</button>
              </Link>
              <Link href="#services">
                <button className="btn btn-secondary">Explore Services</button>
              </Link>
              <Link href="#special-requests">
                <button className="btn btn-link">Special request</button>
              </Link>
            </div>

            <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
              Transparent pricing • Secure payments • Online-first • Appointment-based options
            </div>
          </div>
        </div>
      </section>

      <section className="section sectionAlt">
        <div className="container">
          <h2>How it works</h2>
          <p>Fast, clear, and built to prevent disputes with verification.</p>

          <div className="grid3" style={{ marginTop: 22 }}>
            <div className="card hover">
              <h3>1) Create your order</h3>
              <p>Get a quote online and choose standard or scheduled delivery.</p>
            </div>
            <div className="card hover">
              <h3>2) Verified pickup</h3>
              <p>Customer uploads a pickup photo. We lock in details before dispatch.</p>
            </div>
            <div className="card hover">
              <h3>3) Verified drop-off</h3>
              <p>Driver uploads drop-off photo. Payment is captured after delivery.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="section">
        <div className="container">
          <h2>Services</h2>
          <p>Online-first services designed for convenience and clarity.</p>

          <div className="grid3" style={{ marginTop: 22 }}>
            <div className="card hover">
              <h3>Courier Delivery</h3>
              <p>
                Local delivery for documents, envelopes, packages, boxes, and select electronics
                — within our size, weight, and distance guidelines.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/courier">
                  <button className="btn btn-primary">Get a Quote</button>
                </Link>
                <Link href="#special-requests">
                  <button className="btn btn-secondary">Special request</button>
                </Link>
              </div>
            </div>

            <div className="card hover">
              <h3>Print & Document Services</h3>
              <p>
                Upload or email documents. We print (B&W or color), organize, and deliver to you.
              </p>
              <ul style={{ marginTop: 12, paddingLeft: 18, color: "var(--muted)" }}>
                <li>Upload & print (B&W / color)</li>
                <li>Scan, copy & email PDFs</li>
                <li>Basic document preparation</li>
              </ul>
              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" disabled>
                  Upload (coming next)
                </button>
                <Link href="#special-requests">
                  <button className="btn btn-secondary">Ask a question</button>
                </Link>
              </div>
            </div>

            <div className="card hover">
              <h3>Appointment-Based Document Prep</h3>
              <p>
                Need help preparing paperwork (e.g., DMV-related forms, applications, official
                documents)? Book an appointment and upload your files ahead of time.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" disabled>
                  Book (coming next)
                </button>
                <Link href="#special-requests">
                  <button className="btn btn-secondary">Request an appointment</button>
                </Link>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 13, color: "var(--muted)" }}>
            Note: For oversized, fragile, high-value, or unusual items, use a Special Request so we can confirm feasibility and pricing.
          </div>
        </div>
      </section>

      <section id="special-requests" className="section sectionAlt">
        <div className="container">
          <div className="grid2">
            <div>
              <h2>Special requests</h2>
              <p style={{ maxWidth: 520 }}>
                Have an unusual delivery, fragile electronics, multiple stops, or something that
                doesn’t fit our standard options? Send the details and we’ll respond with next steps.
              </p>

              <div style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
                Typical examples: TVs, fragile items, multi-stop deliveries, oversized boxes, or time-sensitive requests.
              </div>
            </div>

            <div className="card">
              <SpecialRequestForm />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="card" style={{ textAlign: "center" }}>
            <h2>Ready to get started?</h2>
            <p style={{ marginTop: 8 }}>
              Get a quote online and schedule your delivery in minutes.
            </p>
            <div style={{ marginTop: 16 }}>
              <Link href="/courier">
                <button className="btn btn-primary">Get a Delivery Quote</button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
