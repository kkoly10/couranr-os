// app/dashboard/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getUserRole } from "@/lib/getUserRole";

export default function DashboardRouter() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    async function run() {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      if (!data.session) {
        router.replace("/login?next=/dashboard");
        return;
      }

      const role = await getUserRole();
      if (!alive) return;

      if (role === "admin") router.replace("/admin");
      else if (role === "driver") router.replace("/driver");
      else router.replace("/dashboard/home");
    }

    run();
    return () => {
      alive = false;
    };
  }, [router]);

  return <p style={{ padding: 24 }}>Loading dashboard…</p>;
}