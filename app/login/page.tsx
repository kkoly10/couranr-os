// app/login/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const sp = useSearchParams();
  const next = sp.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Hard redirect so session is definitely applied everywhere
    window.location.assign(next);
  }

  return (
    <main className="min-h-[calc(100vh-0px)]" style={{ padding: 24 }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <Link href="/" style={{ fontWeight: 900, textDecoration: "none" }}>
          Couranr
        </Link>

        <h1 style={{ marginTop: 14, marginBottom: 6, fontSize: 28, fontWeight: 900 }}>
          Sign in
        </h1>
        <p style={{ marginTop: 0, color: "#475569" }}>
          Access your portal to manage services and orders.
        </p>

        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Email</label>
            <input
              style={inputStyle}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Password</label>
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 12, borderRadius: 12, color: "#991b1b" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn btnPrimary"
            style={{ width: "100%" }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p style={{ color: "#475569", marginTop: 6 }}>
            Don’t have an account?{" "}
            <Link href="/signup" style={{ fontWeight: 900 }}>
              Create one
            </Link>
          </p>

          <p style={{ fontSize: 12, color: "#64748b" }}>
            Redirect after login: <span style={{ fontWeight: 800 }}>{next}</span>
          </p>
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.16)",
  outline: "none",
};