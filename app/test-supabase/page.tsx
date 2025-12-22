"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function TestSupabase() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    const testConnection = async () => {
      const { data, error } = await supabase
        .from("health_check")
        .select("*")
        .limit(1);

      if (error) {
        setError(error);
      } else {
        setResult(data);
      }
    };

    testConnection();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Supabase Connection Test</h1>

      {error && (
        <pre style={{ color: "red", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(error, null, 2)}
        </pre>
      )}

      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}

      {!error && !result && <p>Testing connection...</p>}
    </main>
  );
}
