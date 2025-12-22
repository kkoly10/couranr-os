"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "var(--bg)"
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 420,
          width: "100%",
          padding: 32
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/" className="logo">
            Couranr<span className="logo-dot">.</span>
          </Link>
        </div>

        <h1 style={{ marginBottom: 8 }}>Sign in</h1>
        <p style={{ color: "var(--muted)", marginBottom: 24 }}>
          Access your account to manage services and orders.
        </p>

        {/* Email */}
        <label style={{ fontSize: 14, fontWeight: 500 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            width: "100%",
            padding: "12px 14px",
            marginTop: 6,
            marginBottom: 16,
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 14
          }}
        />

        {/* Password */}
        <label style={{ fontSize: 14, fontWeight: 500 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={{
            width: "100%",
            padding: "12px 14px",
            marginTop: 6,
            marginBottom: 20,
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 14
          }}
        />

        {error && (
          <p style={{ color: "#dc2626", marginBottom: 16 }}>{error}</p>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{ width: "100%" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p
          style={{
            marginTop: 20,
            fontSize: 14,
            color: "var(--muted)"
          }}
        >
          Don’t have an account?{" "}
          <Link href="/signup" style={{ color: "var(--primary)" }}>
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
