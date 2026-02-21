"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import SiteFooter from "@/components/SiteFooter";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  // ✅ FIXED: Now defaults to the smart portal router instead of dashboard
  const next = params.get("next") || "/portal";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push(next);
  }

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <div className="authWrap">
          <h1 className="pageTitle">Sign in</h1>
          <p className="pageDesc">
            Access your portal to manage rentals and deliveries.
          </p>

          <div className="authCard">
            <form onSubmit={onSubmit}>
              <div className="field">
                <div className="label">Email</div>
                <input
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="field">
                <div className="label">Password</div>
                <input
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  required
                />
              </div>

              {error && <div className="errorBox">{error}</div>}

              <div style={{ marginTop: 14 }}>
                <button
                  className="btn btnGold btnFull"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </div>

              <div style={{ marginTop: 12 }} className="rowBetween">
                <p className="smallMuted" style={{ margin: 0 }}>
                  Don’t have an account?{" "}
                  <Link className="mutedLink" href="/signup">
                    Create one
                  </Link>
                </p>

                <p className="smallMuted" style={{ margin: 0 }}>
                  Redirect after login: <strong>{next}</strong>
                </p>
              </div>
            </form>
          </div>

          <p className="helpText">
            Need help? Email{" "}
            <a className="mutedLink" href="mailto:couranr@couranrauto.com">
              couranr@couranrauto.com
            </a>
            .
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
