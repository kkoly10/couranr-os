"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const HIDE_ON_PREFIX = ["/dashboard", "/admin", "/driver"];
const GOLD = "var(--gold, #c9a227)";

export default function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const shouldHideByPath = useMemo(() => HIDE_ON_PREFIX.some((p) => pathname?.startsWith(p)), [pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => mounted && setHasSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setHasSession(!!session));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (shouldHideByPath || hasSession) return null;

  const pill: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#fff",
    fontWeight: 900,
    textDecoration: "none",
    color: "#0f172a",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <span style={{ position: "relative", display: "inline-block", fontWeight: 950, fontSize: 28, lineHeight: 1, color: "#0f172a" }}>
              C
              <span style={{ position: "absolute", right: -10, bottom: 2, fontSize: 18, lineHeight: 1, color: GOLD }}>.</span>
            </span>
            <span style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>Couranr</span>
          </Link>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href="/signup" style={{ ...pill, background: GOLD, borderColor: "rgba(0,0,0,0.08)" }}>
              Create account
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              style={{ ...pill, width: 46, height: 42, padding: 0 }}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? "✕" : "☰"}
            </button>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/auto" style={pill}>Auto</Link>
              <Link href="/courier" style={pill}>Courier</Link>
              <Link href="/docs" style={pill}>Docs</Link>
            </div>

            <Link href="/login" style={pill}>Log in</Link>
          </div>
        )}
      </div>
    </header>
  );
}