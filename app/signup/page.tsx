"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import SiteFooter from "@/components/SiteFooter";

export default function SignupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // If email confirmations are OFF, you may already have a session.
    if (data.session) {
      router.push(next);
      return;
    }

    setSuccess(
      "Account created. If email confirmation is enabled, check your inbox to confirm."
    );
  }

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer">
        <div className="authWrap">
          <h1 className="pageTitle">Create account</h1>
          <p className="pageDesc">
            Start with the customer portal for rentals and deliveries.
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
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                  required
                />
              </div>

              {error && <div className="errorBox">{error}</div>}
              {success && <div className="successBox">{success}</div>}

              <div style={{ marginTop: 14 }}>
                <button
                  className="btn btnGold btnFull"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? "Creating..." : "Sign up"}
                </button>
              </div>

              <div style={{ marginTop: 12 }} className="rowBetween">
                <p className="smallMuted" style={{ margin: 0 }}>
                  Already have an account?{" "}
                  <Link className="mutedLink" href="/login">
                    Sign in
                  </Link>
                </p>

                <p className="smallMuted" style={{ margin: 0 }}>
                  After signup: <strong>{next}</strong>
                </p>
              </div>
            </form>
          </div>

          <p className="helpText">
            Questions? Email{" "}
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