"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "driver" | "customer" | null;

export default function Navbar() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<Role>(null);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!mounted) return;

      setAuthed(!!session);
      setLoading(false);

      if (!session) {
        setRole(null);
        return;
      }

      // Fetch role from profiles
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (!mounted) return;
      setRole((prof?.role as Role) || "customer");
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;

      setAuthed(!!session);

      if (!session) {
        setRole(null);
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      setRole((prof?.role as Role) || "customer");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

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

          {!loading && !authed && (
            <>
              <Link href="/login" className="btn btn-outline">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up
              </Link>
            </>
          )}

          {!loading && authed && (
            <>
              {/* ONE dashboard per role */}
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
              {role === "customer" && (
                <Link href="/dashboard/home" className="btn btn-outline">
                  Dashboard
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