import Link from "next/link";

export default function HomePage() {
  return (
    <section>
      <div style={{ maxWidth: 900, marginTop: 60 }}>
        <h1
          style={{
            fontSize: 48,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
          }}
        >
          Local services,
          <br />
          delivered with clarity.
        </h1>

        <p style={{ marginTop: 20, fontSize: 18, color: "#444", maxWidth: 640 }}>
          Couranr lets you order deliveries, documents, and rentals online —
          with verification, tracking, and clear pricing.
        </p>

        <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
          <PrimaryButton href="/courier">Get delivery quote</PrimaryButton>
          <SecondaryButton href="/docs">Document services</SecondaryButton>
        </div>
      </div>

      <div
        style={{
          marginTop: 80,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 24,
        }}
      >
        <Feature
          title="Courier Delivery"
          desc="Documents, packages, and everyday items delivered with photo verification."
        />
        <Feature
          title="Document Services"
          desc="Upload, print, prepare, and receive documents without visiting a store."
        />
        <Feature
          title="Auto Rentals"
          desc="Affordable local car rentals managed online."
        />
      </div>
    </section>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        background: "#fff",
      }}
    >
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p style={{ marginTop: 10, color: "#555", lineHeight: 1.4 }}>{desc}</p>
    </div>
  );
}

function PrimaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "14px 20px",
        background: "#2563eb",
        color: "#fff",
        borderRadius: 10,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children }: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "14px 20px",
        border: "1px solid #d1d5db",
        borderRadius: 10,
        fontWeight: 600,
        textDecoration: "none",
        color: "#111",
      }}
    >
      {children}
    </Link>
  );
}
