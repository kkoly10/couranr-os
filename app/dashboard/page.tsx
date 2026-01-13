"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getUserRole } from "@/lib/getUserRole";

export default function DashboardRouter() {
  const router = useRouter();

  useEffect(() => {
    async function route() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }

      const role = await getUserRole();

      if (role === "admin") router.push("/admin");
      else if (role === "driver") router.push("/driver");
      else router.push("/dashboard/home");
    }

    route();
  }, [router]);

  return <p style={{ padding: 24 }}>Loading dashboard…</p>;
}