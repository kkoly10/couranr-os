"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function AuthGuard({
  children
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setChecking(false);
    };

    checkAuth();
  }, [router]);

  if (checking) {
    return <p style={{ padding: 40 }}>Checking authentication…</p>;
  }

  return <>{children}</>;
}
