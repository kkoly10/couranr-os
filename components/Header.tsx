"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import Brand from "./Brand";
import LogoutButton from "./LogoutButton";

type Role = "customer" | "driver" | "admin" | null;

export default function Header() {
  const [role, setRole] = useState<Role>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRole(null);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      setRole((data?.role as Role) ?? "customer");
    }
    load();
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <Brand />

        <nav style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Public links */}
          <Link href="/courier" style={{ color: "#111", textDecoration: "none" }}>
            Courier
          </Link>
          <Link href="/docs" style={{ color: "#111", textDecoration: "none" }}>
            Docs
          </Link>
          <Link href="/auto" style={{ color: "#111", textDecoration: "none" }}>
            Auto
          </Link>

          {/* Role-aware links */}
          {role === null && (
            <Link href="/login" style={{ color: "#111", textDecoration: "none" }}>
              Login
            </Link>
          )}

          {role === "customer" && (
            <>
              <Link href="/dashboard" style={{ color: "#111", textDecoration: "none" }}>
                Dashboard
              </Link>
              <LogoutButton />
            </>
          )}

          {role === "driver" && (
            <>
              <Link href="/driver" style={{ color: "#111", textDecoration: "none" }}>
                Driver
              </Link>
              <LogoutButton />
            </>
          )}

          {role === "admin" && (
            <>
              <Link href="/admin" style={{ color: "#111", textDecoration: "none" }}>
                Admin
              </Link>
              <LogoutButton />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}