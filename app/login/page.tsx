"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // If login succeeds but session isn't immediately available, force re-check
    if (!data.session) {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        setError("Signed in, but session not found. Please try again.");
        setLoading(false);
        return;
      }
    }

    router.push(next);
  };

  return (
    <main className="min-h-[calc(100vh-140px)] bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-center px-6 py-14">
        <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <Link href="/" className="text-sm font-semibold text-zinc-900">
              Couranr<span className="text-zinc-500">.</span>
            </Link>
            <h1 className="mt-3 text-2xl font-semibold text-zinc-900">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Access your account to manage rentals and orders.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-zinc-900">Email</label>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-900">
                Password
              </label>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
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

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-sm text-zinc-600">
              Don’t have an account?{" "}
              <Link
                href="/signup"
                className="font-semibold text-zinc-900 hover:underline"
              >
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-600">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}