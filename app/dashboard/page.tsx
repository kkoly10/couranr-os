// app/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type UserRole = "admin" | "driver" | "customer";

export default function DashboardPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Loading dashboard…");
  const [details, setDetails] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function go() {
      try {
        setMsg("Checking session…");
        const { data: sessRes, error: sessErr } = await supabaseBrowser.auth.getSession();

        if (sessErr) {
          if (!alive) return;
          setMsg("Session error (auth.getSession).");
          setDetails(sessErr.message);
          return;
        }

        const session = sessRes.session;
        if (!session?.user) {
          if (!alive) return;
          setMsg("No session found. Redirecting to login…");
          router.replace("/login?next=/dashboard");
          return;
        }

        setMsg("Session found. Reading your role…");

        const { data: prof, error: profErr } = await supabaseBrowser
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (!alive) return;

        if (profErr) {
          setMsg("Failed to read profiles.role.");
          setDetails(
            JSON.stringify(
              {
                code: (profErr as any).code,
                message: profErr.message,
                hint: (profErr as any).hint,
                details: (profErr as any).details,
                userId: session.user.id,
                email: session.user.email,
              },
              null,
              2
            )
          );
          return;
        }

        const role = (prof?.role ?? "customer") as UserRole;

        setMsg(`Routing as: ${role}…`);

        if (role === "admin") router.replace("/admin");
        else if (role === "driver") router.replace("/driver");
        else router.replace("/dashboard/home");
      } catch (e: any) {
        if (!alive) return;
        setMsg("Dashboard crashed.");
        setDetails(e?.message || String(e));
      }
    }

    go();
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Dashboard Router</h1>
      <p style={{ marginBottom: 12 }}>{msg}</p>

      {details ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#111",
            color: "#0f0",
            padding: 12,
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          {details}
        </pre>
      ) : (
        <p style={{ color: "#666", fontSize: 12 }}>
          (No error details yet — if it keeps loading, it’s likely routing away.)
        </p>
      )}
    </div>
  );
}