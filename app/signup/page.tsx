"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import SiteFooter from "@/components/SiteFooter";

function SignupContent() {
  const router = useRouter();
  const params = useSearchParams();
  
  // ✅ Preserved from your original: Smart redirect logic
  const next = params.get("next") || "/portal";

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

    // ✅ Preserved from your original: email.trim()
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // ✅ Preserved from your original: Handle immediate session or confirmation
    if (data.session) {
      window.location.assign(next);
      return;
    }

    setSuccess(
      "Account created. If email confirmation is enabled, check your inbox to confirm."
    );
  }

  return (
    <div className="cContainer" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "60px" }}>
      <div style={{ maxWidth: "440px", width: "100%" }}>
        
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <h1 className="pageTitle" style={{ color: "var(--text)" }}>Create account</h1>
          <p className="pageDesc" style={{ marginTop: "8px", color: "var(--muted)" }}>
            Start with the customer portal for rentals and deliveries.
          </p>
        </div>

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
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                required
                minLength={8}
              />
            </div>

            {error && (
              <div style={{ padding: "12px", borderRadius: "12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "14px", fontWeight: 700 }}>
                {error}
              </div>
            )}

            {/* ✅ Restored Success Message from original */}
            {success && (
              <div style={{ padding: "12px", borderRadius: "12px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: "14px", fontWeight: 700 }}>
                {success}
              </div>
            )}

            <button className="btn btnGold" type="submit" disabled={loading} style={{ width: "100%", padding: "12px", fontSize: "16px", marginTop: "8px" }}>
              {loading ? "Creating..." : "Sign up"}
            </button>

            {/* ✅ Restored Redirect Debugger from original */}
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: 0, textAlign: "center" }}>
                After signup, you'll go to: <strong style={{ color: "var(--text)" }}>{next}</strong>
              </p>
            </div>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--muted)" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--text)", fontWeight: 950, textDecoration: "underline" }}>
            Sign in
          </Link>
        </div>

        <p style={{ textAlign: "center", marginTop: "32px", fontSize: "12px", color: "var(--muted)" }}>
          Questions? Email{" "}
          <a className="mutedLink" href="mailto:couranr@couranrauto.com" style={{ fontWeight: 800 }}>
            couranr@couranrauto.com
          </a>.
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />
      
      <Suspense fallback={<div style={{ textAlign: "center", padding: "60px", color: "var(--muted)" }}>Initializing portal...</div>}>
        <SignupContent />
      </Suspense>

      <div style={{ marginTop: "auto", paddingTop: "60px" }}>
        <SiteFooter />
      </div>
    </main>
  );
}
