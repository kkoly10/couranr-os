"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function LoginPage() {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = searchParams.get("next") || "/dashboard/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Basic guard
    if (!email || !password) {
      setBusy(false);
      setError("Please enter your email and password.");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }

    // If sign-in worked but no session returned, surface it
    if (!data?.session) {
      setBusy(false);
      setError("Signed in, but session was not created. Check cookies/domain.");
      return;
    }

    // Refresh server components / middleware-protected routes
    router.refresh();
    router.push(next);
  }

  return (
    <div className="relative mx-auto max-w-6xl px-6 py-16">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute top-40 right-[-140px] h-[340px] w-[340px] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-md rounded-3xl border border-white/12 bg-white/[0.04] p-6 shadow-2xl shadow-black/40">
        <div className="mb-2 text-sm text-white/80">Welcome back</div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Sign in to Couranr
        </h1>
        <p className="mt-2 text-sm text-white/80">
          Access your dashboard, deliveries, rentals, and account.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-white/90">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/25 focus:outline-none"
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-white/90">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/25 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
              <div className="mt-2 text-xs text-red-100/80">
                If this keeps happening on Vercel, confirm your Supabase env vars
                are set (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY).
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <div className="text-center text-sm text-white/80">
            Don&apos;t have an account?{" "}
            <a className="text-white underline underline-offset-4" href="/signup">
              Create one
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}