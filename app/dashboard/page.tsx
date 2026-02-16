// app/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type UserRole = "admin" | "driver" | "customer";

export default function DashboardPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Loading dashboard…");

  useEffect(() => {
    let alive = true;

    async function go() {
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        const session = data.session;

        if (!session?.user) {
          router.replace("/login?next=/dashboard");
          return;
        }

        const { data: prof, error } = await supabaseBrowser
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        // If no profile row yet (or any error), default to customer
        let role: UserRole = "customer";
        if (!error && prof?.role) role = (prof.role as UserRole) ?? "customer";

        if (!alive) return;

        if (role === "admin") router.replace("/admin");
        else if (role === "driver") router.replace("/driver");
        else router.replace("/dashboard/home");
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Failed to load dashboard.");
        // Fallback route so you don't get stuck
        router.replace("/dashboard/home");
      }
    }

    go();
    return () => {
      alive = false;
    };
  }, [router]);

  return <p style={{ padding: 24 }}>{msg}</p>;
}