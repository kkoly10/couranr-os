import Link from "next/link";

export default function Brand({
  href = "/",
  role,
}: {
  href?: string;
  role?: "admin" | "driver" | "customer" | string;
}) {
  return (
    <Link href={href} className="brand">
      <span className="brandMark" aria-hidden="true">
        <span className="brandC">C</span>
        <span className="brandDot">.</span>
      </span>

      <span className="brandWord">Couranr</span>

      {role ? <span className="brandRole">{role}</span> : null}
    </Link>
  );
}