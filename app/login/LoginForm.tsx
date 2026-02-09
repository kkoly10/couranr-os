// app/login/LoginForm.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClientComponentClient(), []);

  const redirectTo = searchParams.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // If the session isn't present, middleware will keep bouncing you.
      if (!data.session) {
        setError("Signed in, but no session was created. Check Supabase env vars and auth settings.");
        setLoading(false);
        return;
      }

      // Refresh server components + go to destination
      router.replace(redirectTo);
      router.refresh();
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "Login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-10">
          <Link href="/" className="inline-flex items-center gap-2 text-white font-semibold">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              C
            </span>
            <span className="tracking-tight">Couranr OS</span>
          </Link>
        </div>

        <div className="mx-auto max-w-md">
          <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="p-7">
              <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
              <p className="mt-2 text-sm text-white/70">
                Access your account to manage services and orders.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-white/90">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-2 w-full rounded-xl bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-white/25"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-white/90">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-2 w-full rounded-xl bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-white/25"
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleLogin}
                  disabled={loading}
                  className="w-full rounded-xl bg-white text-zinc-950 py-3 text-sm font-semibold hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>

                <div className="text-sm text-white/70">
                  Don’t have an account?{" "}
                  <Link href="/signup" className="text-white underline underline-offset-4 hover:text-white/90">
                    Create one
                  </Link>
                </div>

                <div className="text-xs text-white/40">
                  Tip: If you were redirected here, you’ll be sent back to{" "}
                  <span className="text-white/60">{redirectTo}</span> after sign in.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-white/40">
            Having trouble? Make sure Supabase env vars are set in Vercel.
          </div>
        </div>
      </div>
    </main>
  );
}