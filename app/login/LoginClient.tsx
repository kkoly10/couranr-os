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
    <main className="min-h-[calc(100vh-140px)]">
      <div className="c-container flex justify-center py-14">
        <div className="w-full max-w-md rounded-3xl border bg-[var(--surface)] p-8 shadow-sm">
          <div className="mb-6">
            <Link href="/" className="text-sm font-extrabold text-[var(--text)]">
              Couranr<span className="text-[var(--gold)]">•</span>
            </Link>
            <h1 className="mt-3 text-2xl font-extrabold text-[var(--text)]">Sign in</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Manage rentals, agreements, payments, and more.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-[var(--text)]">Email</label>
              <input
                className="mt-1 w-full rounded-xl border bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-[var(--gold)]"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--text)]">Password</label>
              <input
                className="mt-1 w-full rounded-xl border bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-[var(--gold)]"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button onClick={handleLogin} disabled={loading} className="btn btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-sm text-[var(--muted)]">
              Don’t have an account?{" "}
              <Link href="/signup" className="font-extrabold text-[var(--primary)] hover:underline">
                Create one
              </Link>
            </p>

            <p className="text-xs text-[var(--muted)]">
              You’ll be redirected to: <span className="font-semibold">{next}</span>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
