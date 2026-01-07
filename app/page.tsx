// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "80px 24px",
      }}
    >
      <header style={{ marginBottom: 48 }}>
        <h1
          style={{
            fontSize: 44,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            marginBottom: 12,
          }}
        >
          Couranr
        </h1>

        <p style={{ fontSize: 18, color: "#555", maxWidth: 720 }}>
          Local delivery, document services, and vehicle solutions — built for
          speed, clarity, and trust.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
        }}
      >
        {/* Courier */}
        <Card
          title="Courier Delivery"
          description="Same-day and scheduled local deliveries with transparent pricing."
          href="/courier"
          cta="Get a quote"
        />

        {/* Docs */}
        <Card
          title="Document Services"
          description="Print, scan, notarize, and deliver documents securely."
          href="/docs"
          cta="View services"
        />

        {/* Auto */}
        <Card
          title="Auto Services"
          description="Affordable vehicle rentals and fleet solutions."
          href="/auto"
          cta="Browse vehicles"
        />
      </section>
    </main>
  );
}

function Card({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 24,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          {title}
        </h2>
        <p style={{ color: "#555", lineHeight: 1.6 }}>{description}</p>
      </div>

      <Link
        href={href}
        style={{
          marginTop: 18,
          display: "inline-block",
          padding: "12px 16px",
          borderRadius: 10,
          background: "#111827",
          color: "#fff",
          fontWeight: 700,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        {cta}
      </Link>
    </div>
  );
}