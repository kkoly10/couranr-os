"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const HIDE_ON_PREFIX = ["/dashboard", "/admin", "/driver"];

export default function PublicHeader({
  initialIsAuthed = false,
}: {
  initialIsAuthed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(initialIsAuthed);

  const shouldHideByPath = useMemo(() => {
    return HIDE_ON_PREFIX.some((p) => pathname?.startsWith(p));
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Keep header auth state in sync on the client (fixes stale "Log in" display after auth)
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsAuthed(!!data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (shouldHideByPath) return null;

  return (
    <header className="publicHeader">
      <div className="publicHeaderInner">
        <Link href="/" className="brand" aria-label="Couranr home">
          <span className="brandMark" aria-hidden="true">
            C
          </span>
          <span className="brandName">Couranr</span>
        </Link>

        {/* Desktop nav */}
        <nav className="publicNav" aria-label="Primary">
          <Link className="navItem" href="/auto">
            Auto
          </Link>
          <Link className="navItem" href="/courier">
            Courier
          </Link>
          <Link className="navItem" href="/docs">
            Docs
          </Link>
        </nav>

        {/* Desktop actions */}
        <div className="publicActions">
          {isAuthed ? (
            <Link className="btn btnGold" href="/portal">
              Open portal
            </Link>
          ) : (
            <>
              <Link className="btn btnGhost" href="/login">
                Log in
              </Link>
              <Link className="btn btnGold" href="/signup">
                Create account
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="menuBtn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          type="button"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="mobilePanel">
          <div className="mobileLinks">
            <Link className="mobileItem" href="/auto">
              Auto
            </Link>
            <Link className="mobileItem" href="/courier">
              Courier
            </Link>
            <Link className="mobileItem" href="/docs">
              Docs
            </Link>
          </div>

          <div className="mobileActions">
            {isAuthed ? (
              <Link className="btn btnGold wFull" href="/portal">
                Open portal
              </Link>
            ) : (
              <>
                <Link className="btn btnGhost wFull" href="/login">
                  Log in
                </Link>
                <Link className="btn btnGold wFull" href="/signup">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}