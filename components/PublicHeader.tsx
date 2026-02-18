"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const HIDE_ON_PREFIX = ["/dashboard", "/admin", "/driver"];
const GOLD = "var(--gold, #c9a227)";

export default function PublicHeader() {
  const pathname = usePathname();
  const [hasSession, setHasSession] = useState(false);

  const shouldHideByPath = useMemo(() => HIDE_ON_PREFIX.some((p) => pathname?.startsWith(p)), [pathname]);

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

  const tabWrap: React.CSSProperties = {
    display: "inline-flex",
    gap: 6,
    padding: 6,
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.04)",
    flexWrap: "wrap",
  };

  const tab: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 999,
    fontWeight: 950,
    textDecoration: "none",
    color: "#0f172a",
    background: "#fff",
    border: "1px solid rgba(15,23,42,0.10)",
  };

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ position: "relative", display: "inline-block", fontWeight: 950, fontSize: 28, lineHeight: 1, color: "#0f172a" }}>
            C
            <span style={{ position: "absolute", right: -10, bottom: 2, fontSize: 18, lineHeight: 1, color: GOLD }}>.</span>
          </span>
          <span style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>Couranr</span>
        </Link>

        <nav style={tabWrap} aria-label="Primary">
          <Link href="/auto" style={tab}>Auto</Link>
          <Link href="/courier" style={tab}>Courier</Link>
          <Link href="/docs" style={tab}>Docs</Link>
        </nav>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/login" style={{ ...tab, background: "#fff" }}>Log in</Link>
          <Link href="/signup" style={{ ...tab, background: GOLD, borderColor: "rgba(0,0,0,0.08)" }}>Create account</Link>
        </div>
      </div>
    </header>
  );
}