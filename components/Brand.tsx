import Link from "next/link";
import { CouranrLogo } from "@/components/brand/CouranrLogo";

/**
 * Legacy brand link.
 *
 * Previously rendered the `C.` mark and the typed word "Couranr", both of which
 * BRAND_GUIDE.md retires. It now renders the approved outlined wordmark.
 *
 * This component currently has no importers — it was orphaned when the legacy
 * driver layout was removed. It is corrected rather than deleted so that
 * anything picking it up later gets the approved mark, not the retired one.
 */
export default function Brand({
  href = "/",
  role,
  tone = "light",
}: {
  href?: string;
  role?: "admin" | "driver" | "customer" | string;
  tone?: "light" | "dark";
}) {
  return (
    <Link href={href} className="brand" aria-label="Couranr home">
      <CouranrLogo variant={tone === "dark" ? "reverse" : "primary"} width={140} />
      {role ? <span className="brandRole">{role}</span> : null}
    </Link>
  );
}
