"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSignup = async () => {
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "customer",
          marketing_opt_in: true,
        },
      },
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Account created. Check your email to confirm, then sign in.");
    }

    setLoading(false);
  };

  return (
    <main className="min-h-[calc(100vh-140px)]">
      <div className="c-container flex justify-center py-14">
        <div className="w-full max-w-md rounded-3xl border bg-[var(--surface)] p-8 shadow-sm">
          <div className="mb-6">
            <Link href="/" className="text-sm font-extrabold text-[var(--text)]">
              Couranr<span className="text-[var(--gold)]">•</span>
            </Link>
            <h1 className="mt-3 text-2xl font-extrabold text-[var(--text)]">Create account</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Start renting in minutes.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-[var(--text)]">Email</label>
              <input
                className="mt-1 w-full rounded-xl border bg-white px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--gold)]"
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
                className="mt-1 w-full rounded-xl border bg-white px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--gold)]"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
              />
            </div>

            {message && (
              <div className="rounded-xl border bg-[var(--surface-2)] p-3 text-sm text-[var(--text)]">
                {message}
              </div>
            )}

            <button onClick={handleSignup} disabled={loading} className="btn btn-primary w-full">
              {loading ? "Creating…" : "Sign up"}
            </button>

            <p className="text-sm text-[var(--muted)]">
              Already have an account?{" "}
              <Link href="/login" className="font-extrabold text-[var(--primary)] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}