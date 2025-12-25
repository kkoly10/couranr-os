import Link from "next/link";
import SpecialRequestForm from "../components/SpecialRequestForm";

export default function HomePage() {
  return (
    <main>

      {/* HERO */}
      <section style={{ padding: "96px 0" }}>
        <div className="container">
          <h1>
            Online services,
            <br />
            delivered to you.
          </h1>

          <p style={{ maxWidth: 640, marginTop: 16 }}>
            Courier delivery for documents, packages, boxes, and everyday items —
            ordered online, verified with photos, and delivered to your door.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
            <Link href="/courier">
              <button className="btn btn-primary">Get a Delivery Quote</button>
            </Link>
            <Link href="#services">
              <button className="btn btn-secondary">Explore Services</button>
            </Link>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "72px 0", background: "#ffffff" }}>
        <div className="container">
          <h2>How it works</h2>
          <div className="grid3" style={{ marginTop: 32 }}>
            <div className="card hover">
              <h3>Create your order</h3>
              <p>Get a quote online in minutes.</p>
            </div>
            <div className="card hover">
              <h3>Verified pickup</h3>
              <p>Customer uploads a pickup photo.</p>
            </div>
            <div className="card hover">
              <h3>Verified delivery</h3>
              <p>Driver uploads a drop-off photo.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{ padding: "72px 0" }}>
        <div className="container">
          <h2>Services</h2>
          <div className="grid3" style={{ marginTop: 32 }}>
            <div className="card hover">
              <h3>Courier Delivery</h3>
              <p>
                Documents, envelopes, packages, boxes, and select electronics —
                within size, weight, and distance limits.
              </p>
              <Link href="/courier">
                <button className="btn btn-primary" style={{ marginTop: 16 }}>
                  Get a Quote
                </button>
              </Link>
            </div>

            <div className="card hover">
              <h3>Print & Document Services</h3>
              <p>
                Upload or email documents. We print and deliver them to you.
              </p>
            </div>

            <div className="card hover">
              <h3>Document Prep (Appointments)</h3>
              <p>
                DMV forms, applications, and official paperwork by appointment.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SPECIAL REQUESTS */}
      <section style={{ padding: "72px 0", background: "#ffffff" }}>
        <div className="container">
          <div className="grid2">
            <div>
              <h2>Special requests</h2>
              <p>
                Oversized items, fragile electronics, multi-stop deliveries, or
                anything outside our standard options.
              </p>
            </div>
            <div className="card">
              <SpecialRequestForm />
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
