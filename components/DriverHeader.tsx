"use client";

import Link from "next/link";
import LogoutButton from "./LogoutButton";

export default function DriverHeader() {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid #ddd",
        background: "#fafafa",
      }}
    >
      <Link href="/driver/deliveries" style={{ fontWeight: 600 }}>
        • Couranr Driver
      </Link>

      <LogoutButton />
    </header>
  );
}