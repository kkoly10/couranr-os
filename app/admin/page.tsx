export default function AdminHome() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>Admin Control</h1>
      <p style={{ marginTop: 10, color: "#444", maxWidth: 780 }}>
        Operations view for monitoring deliveries, assigning drivers, and resolving issues safely.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 22 }}>
        <Card title="Deliveries" desc="Assign drivers, monitor status, and intervene if needed." href="/admin/deliveries" />
        <Card title="Drivers" desc="Manage driver accounts and roles." href="/admin/drivers" />
        <Card title="Settings" desc="Delivery parameters, safety rules, and service limits." href="/admin/settings" />
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
