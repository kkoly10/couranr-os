// components/LogoutButton.tsx
"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await supabaseBrowser.auth.signOut();
        window.location.assign("/");
      }}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid #d1d5db",
        background: "#111827",
        color: "#fff",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      Log out
    </button>
  );
}