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
      options: { data: { role: "customer" } },
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

          <Link className="btn btnGhost" href="/login">
            Log in
          </Link>
        </div>

        <h1 className="authTitle">Create account</h1>
        <p className="authSub">Start with Auto today. Courier & Docs expanding soon.</p>

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
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
          />
        </div>

        {message && (
          <div className={message.toLowerCase().includes("check your email") ? "noticeOk" : "noticeErr"}>
            {message}
          </div>
        )}

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <button onClick={handleSignup} disabled={loading} className="btn btnPrimary">
            {loading ? "Creating…" : "Sign up"}
          </button>

          <div style={{ fontSize: 13, color: "rgba(71,85,105,0.95)" }}>
            Already have an account?{" "}
            <Link href="/login" style={{ fontWeight: 950, color: "rgba(11,18,32,0.95)" }}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}