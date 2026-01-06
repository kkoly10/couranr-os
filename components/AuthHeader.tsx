"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function AuthHeader() {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function loadUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    setRole(data?.role ?? null);
    setLoading(false);
  }

  useEffect(() => {
    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadUser();
      router.refresh(); // ensures layout consistency
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setRole(null);
    router.push("/");
    router.refresh();
  }

  if (loading) return null;

  // 🔓 Logged out
  if (!role) {
    return (
      <Link
        href="/login"
        style={{ fontWeight: 600, textDecoration: "none", color: "#111" }}
      >
        Login
      </Link>
    );
  }

  // 🔐 Logged in
  const dashboardHref =
    role === "admin"
      ? "/admin"
      : role === "driver"
      ? "/driver"
      : "/dashboard";

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <Link
        href={dashboardHref}
        style={{ fontWeight: 600, textDecoration: "none", color: "#111" }}
      >
        Dashboard
      </Link>

      <button
        onClick={handleLogout}
        style={{
          border: "1px solid #e5e7eb",
          background: "#fff",
          padding: "6px 12px",
          borderRadius: 8,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Logout
      </button>
    </div>
  );
}