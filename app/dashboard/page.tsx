"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type UserRole = "admin" | "driver" | "customer";

export default function DashboardRouter() {
  const router = useRouter();
  const [msg, setMsg] = useState("Loading dashboard…");

  useEffect(() => {
    let alive = true;

    async function route() {
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        const session = data.session;

        if (!session?.user) {
          router.push("/login?next=/dashboard");
          return;
        }

        // Read role from profiles (RLS: profiles_select_own allows this)
        const { data: prof, error } = await supabaseBrowser
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (error) {
          setMsg(`Failed to load your role: ${error.message}`);
          return;
        }

        const role = (prof?.role ?? "customer") as UserRole;

        if (role === "admin") router.push("/admin");
        else if (role === "driver") router.push("/driver");
        else router.push("/dashboard/home");
      } catch (e: any) {
        setMsg(e?.message || "Failed to load dashboard.");
      }
    }

    route();
    return () => {
      alive = false;
    };
  }, [router]);

  return <p style={{ padding: 24 }}>{msg}</p>;
}