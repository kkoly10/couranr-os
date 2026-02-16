// app/signup/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSignup() {
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role: "customer" },
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setMessage("Account created. Check your email to verify, then sign in.");
    setLoading(false);
  }

  return (
    <main className="min-h-[calc(100vh-0px)]" style={{ padding: 24 }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <Link href="/" style={{ fontWeight: 900, textDecoration: "none" }}>
          Couranr
        </Link>

        <h1 style={{ marginTop: 14, marginBottom: 6, fontSize: 28, fontWeight: 900 }}>
          Create account
        </h1>
        <p style={{ marginTop: 0, color: "#475569" }}>
          Start with rentals today. Delivery coming soon.
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
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
            />
          </div>

          <button
            onClick={handleSignup}
            disabled={loading}
            className="btn btnPrimary"
            style={{ width: "100%" }}
          >
            {loading ? "Creating…" : "Sign up"}
          </button>

          {message && (
            <div style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.12)", padding: 12, borderRadius: 12 }}>
              {message}
            </div>
          )}

          <p style={{ color: "#475569", marginTop: 6 }}>
            Already have an account?{" "}
            <Link href="/login" style={{ fontWeight: 900 }}>
              Sign in
            </Link>
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