"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function DebugTokenPage() {
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token || "");
    })();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Debug Token</h1>
      <p style={{ color: "#666" }}>
        Copy this token for API testing. Remove this page after testing.
      </p>

      <textarea
        value={token}
        readOnly
        style={{
          width: "100%",
          height: 220,
          padding: 12,
          fontFamily: "monospace",
          borderRadius: 10,
          border: "1px solid #ddd",
        }}
      />

      {!token && <p style={{ marginTop: 12 }}>Not logged in.</p>}
    </div>
  );
}