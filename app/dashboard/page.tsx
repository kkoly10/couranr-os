"use client";

import AuthGuard from "../../components/AuthGuard";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user);
    };

    getUser();
  }, []);

  return (
    <AuthGuard>
      <main style={{ padding: 40 }}>
        <h1>Dashboard</h1>

        {user ? (
          <>
            <p>Logged in as:</p>
            <pre>{JSON.stringify(user, null, 2)}</pre>
          </>
        ) : (
          <p>Loading user...</p>
        )}
      </main>
    </AuthGuard>
  );
}
