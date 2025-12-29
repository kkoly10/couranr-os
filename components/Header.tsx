"use client";

import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useState } from "react";
import Brand from "./Brand";
import LogoutButton from "./LogoutButton";

export default function Header() {
  const [isAuthed, setIsAuthed] = useState<boolean>(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsAuthed(!!data.user);
    });
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
        <Brand />

        <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Link href="/courier">Courier</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/auto">Auto</Link>

          {!isAuthed && <Link href="/login">Login</Link>}
          {isAuthed && <LogoutButton />}
        </nav>
      </div>
    </header>
  );
}
