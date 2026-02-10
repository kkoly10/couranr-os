"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type SessionUser = { email?: string | null };

export default function Navbar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isLoggedIn = !!user?.email;

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white">
              C
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-zinc-900">Couranr</p>
              <p className="text-xs text-zinc-500">Auto • Courier</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <Link
              href="/auto/available"
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Auto
            </Link>
            <Link
              href="/courier"
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Courier
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/auto/available"
            className="hidden rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 sm:inline-flex"
          >
            View cars
          </Link>

          {!loading && !isLoggedIn && (
            <>
              <Link
                href="/login"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Sign up
              </Link>
            </>
          )}

          {!loading && isLoggedIn && (
            <>
              <Link
                href="/dashboard"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Dashboard
              </Link>
              <Link
                href="/admin"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Admin
              </Link>
              <button
                onClick={() => supabase.auth.signOut()}
                className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Log out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}