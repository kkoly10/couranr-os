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

  const a: React.CSSProperties = { fontWeight: 950, textDecoration: "none", color: "#0f172a" };

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50, background: "#fff", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 16px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={{ ...a, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ position: "relative", fontSize: 28, lineHeight: 1 }}>
              C
              <span style={{ position: "absolute", right: -10, bottom: 2, fontSize: 18, color: GOLD }}>.</span>
            </span>
            <span style={{ fontSize: 18 }}>Couranr</span>
          </Link>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/login" style={{ ...a, padding: "10px 14px", borderRadius: 999, border: "1px solid rgba(15,23,42,0.14)" }}>Log in</Link>
            <Link href="/signup" style={{ ...a, padding: "10px 14px", borderRadius: 999, background: GOLD, border: "1px solid rgba(0,0,0,0.08)" }}>Create account</Link>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/auto" style={a}>Auto</Link>
          <Link href="/courier" style={a}>Courier</Link>
          <Link href="/docs" style={a}>Docs</Link>
        </div>
      </div>
    </header>
  );
}