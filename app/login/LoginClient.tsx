// app/login/LoginClient.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginClient() {
  const sp = useSearchParams();
  const next = sp.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    window.location.assign(next);
  };

  return (
    <main className="authWrap">
      <div className="bgGlow" aria-hidden="true" />

      <div className="authCard">
        <div className="authTop">
          <Link className="brandRow" href="/" aria-label="Couranr home">
            <span className="brandMark">
              C<span className="brandDot">.</span>
            </span>
            <span className="brandName">Couranr</span>
          </Link>

          <Link className="btn btnGhost" href="/signup">
            Create account
          </Link>
        </div>

        <h1 className="authTitle">Sign in</h1>
        <p className="authSub">Access your portal to manage rentals and deliveries.</p>

        <div className="field">
          <div className="label">Email</div>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="field">
          <div className="label">Password</div>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        {error && <div className="noticeErr">{error}</div>}

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <button onClick={handleLogin} disabled={loading} className="btn btnPrimary">
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div style={{ fontSize: 13, color: "rgba(71,85,105,0.95)" }}>
            You’ll be redirected to: <strong>{next}</strong>
          </div>

          <div style={{ fontSize: 13, color: "rgba(71,85,105,0.95)" }}>
            Don’t have an account?{" "}
            <Link href="/signup" style={{ fontWeight: 950, color: "rgba(11,18,32,0.95)" }}>
              Create one
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}