"use client";

import Link from "next/link";
import LogoutButton from "./LogoutButton";

export default function AdminHeader() {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid #000",
        background: "#f4f4f4",
      }}
    >
      <Link href="/admin/deliveries" style={{ fontWeight: 600 }}>
        • Couranr Admin
      </Link>

      <LogoutButton />
    </header>
  );
}