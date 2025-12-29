"use client";

import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useState } from "react";
import LogoutButton from "./LogoutButton";

export default function Header() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 24px",
        borderBottom: "1px solid #eee",
      }}
    >
      <Link href="/" style={{ fontWeight: 600 }}>
        • Couranr
      </Link>

      <nav style={{ display: "flex", gap: 16 }}>
        {!user && <Link href="/login">Login</Link>}
        {user && (
          <>
            <Link href="/delivery/status">My Orders</Link>
            <LogoutButton />
          </>
        )}
      </nav>
    </header>
  );
}