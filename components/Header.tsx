"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import Brand from "./Brand";
import LogoutButton from "./LogoutButton";

export default function Header() {
  const [role, setRole] = useState<"customer" | "driver" | "admin" | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      setRole(data?.role ?? "customer");
    }
    load();
  }, []);

  return (
    <header
      style={{
        borderBottom: "3px solid #2563eb",
        background:
          "linear-gradient(180deg, rgba(37,99,235,0.08), #ffffff 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "18px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Brand role={role ?? "customer"} />

        <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Link href="/courier">Courier</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/auto">Auto</Link>
          {role && <Link href="/dashboard">Dashboard</Link>}
          {role ? <LogoutButton /> : <Link href="/login">Login</Link>}
        </nav>
      </div>
    </header>
  );
}