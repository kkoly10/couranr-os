"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const HIDE_ON_PREFIX = ["/dashboard", "/admin", "/driver"];

export default function PublicHeader({
  isAuthed = false,
}: {
  isAuthed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const shouldHideByPath = useMemo(() => {
    return HIDE_ON_PREFIX.some((p) => pathname?.startsWith(p));
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
              Dashboard
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
                Dashboard
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