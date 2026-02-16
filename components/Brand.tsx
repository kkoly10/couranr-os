// components/Brand.tsx
import Link from "next/link";

export default function Brand({
  href = "/",
  role,
}: {
  href?: string;
  role?: "admin" | "driver" | "customer" | string;
}) {
  const badge =
    role === "admin" ? "Admin" : role === "driver" ? "Driver" : role ? role : null;

  return (
    <Link href={href} style={{ textDecoration: "none", color: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "#111827",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 900,
          }}
        >
          C
        </div>

        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontWeight: 900 }}>Couranr</div>
          {badge && (
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
              {badge}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}