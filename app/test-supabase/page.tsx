import { supabase } from "../../lib/supabaseClient";

export default async function TestSupabase() {
  const { data, error } = await supabase
    .from("health_check")
    .select("*")
    .limit(1);

  return (
    <main style={{ padding: 40 }}>
      <h1>Supabase Connection Test</h1>

      {error ? (
        <pre style={{ color: "red", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(error, null, 2)}
        </pre>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}
