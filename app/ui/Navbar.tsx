// app/ui/Navbar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type UserRole = "admin" | "driver" | "customer";

type SessionUser = { email?: string | null; id: string };

export default function Navbar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadRole(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error || !data?.role) return null;
    return data.role as UserRole;
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;

        const u = data.session?.user;
        if (!u) {
          setUser(null);
          setRole(null);
          return;
        }

        setUser({ id: u.id, email: u.email });
        const r = await loadRole(u.id);
        if (!alive) return;
        setRole(r);
      } finally {
        if (alive) setLoading(false);
      }
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!alive) return;

      const u = session?.user;
      if (!u) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      setUser({ id: u.id, email: u.email });
      const r = await loadRole(u.id);
      if (!alive) return;
      setRole(r);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isLoggedIn = !!user?.email;

  return (
    <header className="sticky top-0 z-50 border-b bg-[var(--surface)]/85 backdrop-blur">
      <div className="c-container flex items-center justify-between py-3">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--primary)] text-white font-extrabold">
              C
            </span>
            <div className="leading-tight">
              <div className="text-sm font-extrabold text-[var(--text)]">
                Couranr <span className="text-[var(--gold)]">•</span>
              </div>
              <div className="text-xs text-[var(--muted)]">Auto Rentals • Courier</div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/auto/available"
              className="rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              Auto
            </Link>
            <Link
              href="/courier"
              className="rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              Courier
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/auto/available" className="btn btn-gold hidden sm:inline-flex">
            View cars
          </Link>

          {!loading && !isLoggedIn && (
            <>
              <Link href="/login" className="btn btn-outline">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up
              </Link>
            </>
          )}

          {!loading && isLoggedIn && (
            <>
              <Link href="/dashboard" className="btn btn-outline">
                Dashboard
              </Link>

              {role === "admin" && (
                <Link href="/admin" className="btn btn-outline">
                  Admin
                </Link>
              )}

              {role === "driver" && (
                <Link href="/driver" className="btn btn-outline">
                  Driver
                </Link>
              )}

              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.assign("/");
                }}
                className="btn btn-primary"
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
