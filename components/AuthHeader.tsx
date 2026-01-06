"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function AuthHeader() {
  const [role, setRole] = useState<string | null>(null);
  const router = useRouter();

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

      setRole(data?.role ?? null);
    }

    load();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (!role) return null;

  const dashboardPath =
    role === "admin"
      ? "/admin"
      : role === "driver"
      ? "/driver"
      : "/dashboard";

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <Link
        href={dashboardPath}
        style={{
          fontWeight: 600,
          textDecoration: "none",
          color: "#111",
        }}
      >
        Dashboard
      </Link>

      <button
        onClick={logout}
        style={{
          border: "1px solid #e5e7eb",
          padding: "6px 10px",
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Logout
      </button>
    </div>
  );
}