"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const HIDE_ON_PREFIX = ["/dashboard", "/admin", "/driver"];

export default function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hasSession, setHasSession] = useState<boolean>(false);

  const shouldHideByPath = useMemo(() => {
    return HIDE_ON_PREFIX.some((p) => pathname?.startsWith(p));
  }, [pathname]);

  // Hide public nav when authenticated (session exists)
  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setHasSession(!!data.session);
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (shouldHideByPath || hasSession) return null;

  return (
    <header className="publicHeader">
      <div className="publicHeaderInner">
        <Link href="/" className="brand">
          <span className="brandMark" aria-hidden="true">
            <span className="brandC">C</span>
            <span className="brandDot">.</span>
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
          <Link className="btn btnSecondary" href="/login">
            Log in
          </Link>
          <Link className="btn btnGold" href="/signup">
            Create account
          </Link>
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
            <Link className="btn btnSecondary wFull" href="/login">
              Log in
            </Link>
            <Link className="btn btnGold wFull" href="/signup">
              Create account
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
