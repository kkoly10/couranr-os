import Link from "next/link";

export default function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: 20,
        fontWeight: 650,
        letterSpacing: "-0.02em",
        textDecoration: "none",
        color: "#111",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span>Couranr</span>
      <span style={{ color: "#2563eb", fontSize: 22, lineHeight: 1 }}>•</span>
    </Link>
  );
}