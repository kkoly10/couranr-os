import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      {/* HERO */}
      <section style={{ padding: "96px 0" }}>
        <div className="container">
          <h1>Online services, delivered to you.</h1>
          <p style={{ maxWidth: 640, marginTop: 16 }}>
            Courier delivery for documents, packages, boxes, and everyday items —
            ordered online and delivered with verification.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
            <Link href="/courier">
              <button className="btn-primary">Get a quote</button>
            </Link>
            <Link href="#services">
              <button className="btn-secondary">Explore services</button>
            </Link>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{ padding: "72px 0", background: "white" }}>
        <div className="container">
          <h2>Services</h2>

          <div className="grid grid-3" style={{ marginTop: 32 }}>
            <div className="card">
              <h3>Courier Delivery</h3>
              <p>Local delivery for packages, documents, and boxes.</p>
            </div>

            <div className="card">
              <h3>Print & Documents</h3>
              <p>Upload, print, and get documents delivered.</p>
            </div>

            <div className="card">
              <h3>Appointments</h3>
              <p>Help preparing official paperwork by appointment.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
