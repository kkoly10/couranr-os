import Link from "next/link";

type Role = "customer" | "driver" | "admin";

const ROLE_COLORS: Record<Role, string> = {
  customer: "#2563eb",
  driver: "#16a34a",
  admin: "#7c3aed",
};

export default function Brand({
  href = "/",
  role,
}: {
  href?: string;
  role?: Role;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        textDecoration: "none",
        color: "#111",
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 650 }}>
        Couranr
        <span style={{ color: "#2563eb", fontSize: 22, marginLeft: 4 }}>•</span>
      </span>

      {role && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 999,
            background: ROLE_COLORS[role],
            color: "#fff",
          }}
        >
          {role.charAt(0).toUpperCase() + role.slice(1)}
        </span>
      )}
    </Link>
  );
}
