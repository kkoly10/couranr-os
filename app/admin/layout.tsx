"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Brand from "@/components/Brand";
import LogoutButton from "@/components/LogoutButton";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    async function guard() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.session.user.id)
        .single();

      if (profile?.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setOk(true);
    }

    guard();
  }, [router]);

  if (!ok) return <p style={{ padding: 24 }}>Verifying admin access…</p>;

  return (
    <section>
      <header
        style={{
          borderBottom: "3px solid #7c3aed",
          background:
            "linear-gradient(180deg, rgba(124,58,237,0.12), #ffffff 60%)",
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
          <Brand href="/admin" role="admin" />
          <LogoutButton />
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {children}
      </main>
    </section>
  );
}