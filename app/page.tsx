import Link from "next/link";
import SpecialRequestForm from "../components/SpecialRequestForm";

export default function HomePage() {
  return (
    <main>
      {/* HERO */}
      <section style={{ padding: "96px 0" }}>
        <div className="container">
          <h1>Online services, delivered to you.</h1>

          <p style={{ maxWidth: 680, marginTop: 16 }}>
            Courier delivery for documents, packages, boxes, and everyday items —
            ordered online, handled with photo verification, and delivered to
            your door.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
            <Link href="/courier">
              <button className="btn-primary">Get a delivery quote</button>
            </Link>
            <Link href="#services">
              <button className="btn-secondary">Explore services</button>
            </Link>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "72px 0", background: "white" }}>
        <div className="container">
          <h2>How it works</h2>

          <div className="grid grid-3" style={{ marginTop: 32 }}>
            <div className="card">
              <h3>Create your order</h3>
              <p>
                Get a quote online, choose standard or scheduled delivery, and
                submit your request in minutes.
              </p>
            </div>

            <div className="card">
              <h3>Verified pickup</h3>
              <p>
                Customers upload a pickup photo so item condition and details
                are documented before dispatch.
              </p>
            </div>

            <div className="card">
              <h3>Verified delivery</h3>
              <p>
                Drivers upload a drop-off photo. Payment is captured only after
                delivery is confirmed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{ padding: "72px 0" }}>
        <div className="container">
          <h2>Services</h2>

          <div className="grid grid-3" style={{ marginTop: 32 }}>
            <div className="card">
              <h3>Courier Delivery</h3>
              <p>
                Local delivery for documents, envelopes, packages, boxes, and
                select electronics — within size, weight, and distance
                guidelines.
              </p>
              <Link href="/courier">
                <button className="btn-primary" style={{ marginTop: 16 }}>
                  Get a quote
                </button>
              </Link>
            </div>

            <div className="card">
              <h3>Print & Document Services</h3>
              <p>
                Upload or email documents. We print (black & white or color),
                organize, and deliver them to you.
              </p>
              <p style={{ marginTop: 8 }}>
                Upload & print • Scan & email • Basic document preparation
              </p>
            </div>

            <div className="card">
              <h3>Appointment-Based Document Prep</h3>
              <p>
                Need help preparing official paperwork such as DMV forms,
                applications, or other documents? Book an appointment and upload
                files ahead of time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT WE DELIVER */}
      <section style={{ padding: "72px 0", background: "white" }}>
        <div className="container">
          <h2>More than paperwork</h2>
          <p style={{ maxWidth: 720, marginTop: 12 }}>
            Couranr is not limited to documents. We deliver everyday items —
            documents, envelopes, packages, boxes, and select electronics —
            as long as they meet our size, weight, and distance requirements.
          </p>
        </div>
      </section>

      {/* SPECIAL REQUESTS */}
      <section style={{ padding: "72px 0" }}>
        <div className="container">
          <div className="grid">
            <div>
              <h2>Special requests</h2>
              <p style={{ maxWidth: 680, marginTop: 12 }}>
                Have an oversized item, fragile electronics, multiple stops, or
                something that doesn’t fit our standard options? Submit a
                special request and we’ll review feasibility and pricing.
              </p>

              <p style={{ marginTop: 12 }}>
                Examples: TVs, fragile items, multi-stop deliveries, oversized
                boxes, or time-sensitive requests.
              </p>
            </div>

            <div className="card" style={{ marginTop: 24 }}>
              <SpecialRequestForm />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
