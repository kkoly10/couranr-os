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

      if (!alive) return;

      if (error) {
        setMsg(`Failed to load your role: ${error.message}`);
        return;
      }

      const role = (prof?.role ?? "customer") as UserRole;

      if (role === "admin") router.replace("/admin");
      else if (role === "driver") router.replace("/driver");
      else router.replace("/dashboard/home");
    }

    go();
    return () => {
      alive = false;
    };
  }, [router]);

  return <p style={{ padding: 24 }}>{msg}</p>;
}