// app/dashboard/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";

export default function DashboardHomePage() {
  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <h1 style={styles.h1}>Your Couranr Dashboard</h1>
          <p style={styles.sub}>
            Choose a service to manage requests, rentals, and deliveries.
          </p>
        </div>
      </div>

      <div style={styles.grid}>
        <ServiceCard
          emoji="🚚"
          title="Delivery"
          description="Track or create courier requests."
          href="/dashboard/delivery"
          cta="Open Delivery →"
        />

        <ServiceCard
          emoji="🚗"
          title="Auto Rentals"
          description="Manage verification, pickup, return, and deposit status."
          href="/dashboard/auto"
          cta="Open Auto →"
        />

        <ServiceCard
          emoji="📄"
          title="Docs"
          description="Printing, document prep help, typing, resume support, and more."
          href="/dashboard/docs"
          cta="Open Docs →"
        />
      </div>
    </div>
  );
}

function ServiceCard({
  emoji,
  title,
  description,
  href,
  cta,
}: {
  emoji: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTop}>
        <div style={styles.iconBox}>{emoji}</div>
        <div>
          <h2 style={styles.cardTitle}>{title}</h2>
          <p style={styles.cardDesc}>{description}</p>
        </div>
      </div>

      <div style={styles.cardFooter}>
        <Link href={href} style={styles.cta}>
          {cta}
        </Link>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    paddingTop: 8,
  },
  hero: {
    background: "linear-gradient(135deg, #ffffff, #f8fafc)",
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  h1: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.15,
    color: "#111827",
    fontWeight: 900,
  },
  sub: {
    margin: "8px 0 0 0",
    color: "#6b7280",
    fontSize: 14,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14,
  },
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 180,
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  },
  cardTop: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#f3f4f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    flexShrink: 0,
  },
  cardTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
    color: "#111827",
  },
  cardDesc: {
    margin: "6px 0 0 0",
    fontSize: 14,
    lineHeight: 1.45,
    color: "#6b7280",
  },
  cardFooter: {
    marginTop: 16,
  },
  cta: {
    display: "inline-block",
    textDecoration: "none",
    background: "#111827",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 800,
    fontSize: 14,
  },
};
