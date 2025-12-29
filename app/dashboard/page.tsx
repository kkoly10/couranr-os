export default function CustomerDashboard() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>Customer Dashboard</h1>
      <p style={{ marginTop: 10, color: "#444", maxWidth: 720 }}>
        Track your deliveries, document requests, and receipts in one place.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 22 }}>
        <Card title="Delivery status" desc="View your current delivery progress and proof milestones." href="/delivery/status" />
        <Card title="Receipts" desc="See completed orders and totals." href="/delivery/status" />
        <Card title="Special request" desc="Request oversized or unusual deliveries." href="/courier/special-request" />
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