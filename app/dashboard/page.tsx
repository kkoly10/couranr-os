"use client";

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

  if (!user) {
    return <p style={{ padding: 40 }}>Loading...</p>;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Welcome to Couranr</h1>
      <p>You are logged in as:</p>
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </main>
  );
}
