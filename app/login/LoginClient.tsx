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
      <div className="authCard">
        <div className="authHeader">
          <Link href="/" className="brand brand--center" aria-label="Couranr home">
            <span className="brandMark" aria-hidden="true">
              <span className="brandC">C</span>
              <span className="brandDot">.</span>
            </span>
            <span className="brandName">Couranr</span>
          </Link>

          <h1 className="authTitle">Sign in</h1>
          <p className="authSub">
            Access your portal to manage rentals, deliveries, agreements, and payments.
          </p>
        </div>

        {error && <div className="authError">{error}</div>}

        <div className="authForm">
          <div className="field">
            <label className="label">Email</label>
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
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button onClick={handleLogin} disabled={loading} className="btn btn-gold" style={{ width: "100%" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div className="authMeta">
            <span>
              Don’t have an account?{" "}
              <Link className="authLink" href="/signup">
                Create one
              </Link>
            </span>

            <span className="authRedirect">
              Redirect: <span className="mono">{next}</span>
            </span>
          </div>

          <div className="authBack">
            <Link className="btn btn-outline" href="/">
              Back home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}