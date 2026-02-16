// components/Header.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Brand from "./Brand";
import LogoutButton from "./LogoutButton";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function Header() {
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsAuthed(!!data.session?.user);
    });

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session?.user);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "18px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Brand href="/" />

        <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Link href="/courier">Courier</Link>
          <Link href="/auto">Auto</Link>

          {!isAuthed && <Link href="/login">Log in</Link>}
          {isAuthed && <LogoutButton />}
        </nav>
      </div>
    </header>
  );
}