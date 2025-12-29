export default function DriverHome() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>Driver Dashboard</h1>
      <p style={{ marginTop: 10, color: "#444", maxWidth: 720 }}>
        Focus view for assigned deliveries. Proof required at drop-off before completion.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 22 }}>
        <Card title="My deliveries" desc="See jobs assigned to you and start delivery." href="/driver/deliveries" />
        <Card title="Policies" desc="What to do for signature, no-contact, and issues." href="/driver/policies" />
      </div>
    </div>
  );
}

function Card({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a
      href={href}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 16,
        textDecoration: "none",
        color: "#111",
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 650 }}>{title}</div>
      <div style={{ marginTop: 8, color: "#555", lineHeight: 1.35 }}>{desc}</div>
    </a>
  );
}
