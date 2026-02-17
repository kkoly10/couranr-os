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

          <h1 className="authTitle">Create account</h1>
          <p className="authSub">Create your portal login to manage orders and bookings.</p>
        </div>

        {message && <div className="authNotice">{message}</div>}

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
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
            />
          </div>

          <button onClick={handleSignup} disabled={loading} className="btn btn-gold" style={{ width: "100%" }}>
            {loading ? "Creating…" : "Sign up"}
          </button>

          <div className="authMeta">
            <span>
              Already have an account?{" "}
              <Link className="authLink" href="/login">
                Sign in
              </Link>
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