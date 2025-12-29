import Link from "next/link";

type Role = "customer" | "driver" | "admin" | null;

const ROLE_STYLES: Record<string, { color: string; label: string }> = {
  customer: { color: "#2563eb", label: "Customer" },
  driver: { color: "#16a34a", label: "Driver" },
  admin: { color: "#7c3aed", label: "Admin" },
};

export default function Brand({
  href = "/",
  role = null,
}: {
  href?: string;
  role?: Role;
}) {
  const roleStyle = role ? ROLE_STYLES[role] : null;

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 650, color: "#111" }}>
          Couranr
        </span>
        <span style={{ color: "#2563eb", fontSize: 22, lineHeight: 1 }}>•</span>
      </div>

      {roleStyle && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 999,
            background: roleStyle.color,
            color: "#fff",
          }}
        >
          {roleStyle.label}
        </span>
      )}
    </Link>
  );
}