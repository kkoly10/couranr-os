import Link from "next/link";

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
          <p className="mt-16" style={{ maxWidth: 520 }}>
            Couranr is an online-first service platform for courier delivery,
            document printing, and appointment-based document preparation —
            without the hassle of storefronts or walk-ins.
          </p>

          <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
            <Link href="/courier">
              <button>Start a Delivery</button>
            </Link>
            <Link href="#services">
              <button style={{ background: "#f3f4f6", color: "#111827" }}>
                Explore Services
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "72px 0", background: "#ffffff" }}>
        <div className="container">
          <h2>How it works</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 24,
              marginTop: 32
            }}
          >
            <div className="card">
              <h3>Create your order</h3>
              <p>Place an order online in minutes.</p>
            </div>

            <div className="card">
              <h3>We handle pickup</h3>
              <p>Your items or documents are picked up as scheduled.</p>
            </div>

            <div className="card">
              <h3>Delivered to you</h3>
              <p>Secure delivery with photo verification.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{ padding: "72px 0" }}>
        <div className="container">
          <h2>Services</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              marginTop: 32
            }}
          >
            <div className="card">
              <h3>Courier Delivery</h3>
              <p>
                On-demand or scheduled delivery with transparent pricing and
                secure handling.
              </p>
              <Link href="/courier">
                <button className="mt-16">Get a Quote</button>
              </Link>
            </div>

            <div className="card">
              <h3>Print & Document Services</h3>
              <p>
                Upload or email documents. We print, prepare, and deliver them
                to your door.
              </p>
              <button className="mt-16">Upload Documents</button>
            </div>

            <div className="card">
              <h3>Document Preparation</h3>
              <p>
                Appointment-based help with DMV forms, applications, and
                official paperwork.
              </p>
              <button className="mt-16">Book Appointment</button>
            </div>
          </div>
        </div>
      </section>

      {/* WHY COURANR */}
      <section style={{ padding: "72px 0", background: "#ffffff" }}>
        <div className="container">
          <h2>Why Couranr</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 24,
              marginTop: 32
            }}
          >
            <p>Online-first convenience</p>
            <p>Transparent pricing</p>
            <p>Secure payments</p>
            <p>Photo-verified delivery</p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: "72px 0" }}>
        <div className="container">
          <div className="card" style={{ textAlign: "center" }}>
            <h2>Get started in minutes</h2>
            <p className="mt-16">
              Create an order online and let Couranr handle the rest.
            </p>
            <Link href="/courier">
              <button className="mt-24">Start a Delivery</button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
