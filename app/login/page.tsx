"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import SiteFooter from "@/components/SiteFooter";

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  
  // ✅ Matches your original: Defaults to smart portal
  const next = params.get("next") || "/portal";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // ✅ Matches your original: Uses .trim() to prevent accidental space errors
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // ✅ FORCE a clean reload to sync the auth session globally
    window.location.assign(next);
  }

  return (
    <div className="cContainer" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "60px" }}>
      <div style={{ maxWidth: "440px", width: "100%" }}>
        
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <h1 className="pageTitle" style={{ color: "var(--text)" }}>Sign in</h1>
          <p className="pageDesc" style={{ marginTop: "8px", color: "var(--muted)" }}>
            Access your portal to manage rentals and deliveries.
          </p>
        </div>

        {/* Form area using homepage card styling */}
        <div className="card" style={{ padding: "32px", background: "var(--card)" }}>
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            <div className="field">
              <label className="fieldLabel" style={{ color: "var(--text)" }}>Email Address</label>
              <input
                className="fieldInput"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="field">
              <label className="fieldLabel" style={{ color: "var(--text)" }}>Password</label>
              <input
                className="fieldInput"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                required
              />
            </div>

            {error && (
              <div style={{ padding: "12px", borderRadius: "12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "14px", fontWeight: 700 }}>
                {error}
              </div>
            )}

            <button className="btn btnGold" type="submit" disabled={loading} style={{ width: "100%", padding: "12px", fontSize: "16px", marginTop: "8px" }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>

            {/* ✅ Restored from your original: Redirection debugger */}
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: 0 }}>
                Redirect after login: <strong style={{ color: "var(--text)" }}>{next}</strong>
              </p>
            </div>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--muted)" }}>
          Don’t have an account?{" "}
          <Link href="/signup" style={{ color: "var(--text)", fontWeight: 950, textDecoration: "underline" }}>
            Create one
          </Link>
        </div>

        {/* ✅ Restored from your original: Help Email */}
        <p style={{ textAlign: "center", marginTop: "32px", fontSize: "12px", color: "var(--muted)" }}>
          Need help? Email{" "}
          <a className="mutedLink" href="mailto:couranr@couranrauto.com" style={{ fontWeight: 800 }}>
            couranr@couranrauto.com
          </a>.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="page">
      {/* Homepage background glow */}
      <div className="bgGlow" aria-hidden="true" />
      
      {/* Suspense is REQUIRED here for Vercel builds because we use useSearchParams. 
          Without it, the build will crash during static generation.
      */}
      <Suspense fallback={<div style={{ textAlign: "center", padding: "60px", color: "var(--muted)" }}>Connecting to portal...</div>}>
        <LoginContent />
      </Suspense>
      
      <div style={{ marginTop: "auto", paddingTop: "60px" }}>
        <SiteFooter />
      </div>
    </main>
  );
}
