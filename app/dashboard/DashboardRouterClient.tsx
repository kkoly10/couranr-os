"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getUserRole } from "@/lib/getUserRole";

export default function DashboardRouterClient() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function route() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/login?next=/dashboard");
          return;
        }

        // Optional: allow /dashboard?next=/somewhere
        const next = sp.get("next");
        if (next && next.startsWith("/")) {
          router.replace(next);
          return;
        }

        let role: "admin" | "driver" | "customer" | null = null;
        try {
          role = await getUserRole();
        } catch {
          role = "customer";
        }

        if (cancelled) return;

        if (role === "admin") router.replace("/admin");
        else if (role === "driver") router.replace("/driver");
        else router.replace("/dashboard/home");
      } catch {
        router.replace("/dashboard/home");
      }
    }

    route();
    return () => {
      cancelled = true;
    };
  }, [router, sp]);

  return <p style={{ padding: 24 }}>Loading dashboard…</p>;
}