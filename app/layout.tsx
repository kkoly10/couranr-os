// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import PublicHeader from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document help, and auto rentals — built for speed, clarity, and trust.",
};

type AppRole = "guest" | "customer" | "driver" | "admin";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  let role: AppRole = session ? "customer" : "guest";

  if (session?.user) {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      const dbRole = String(profile?.role || "").toLowerCase();

      if (dbRole === "admin") role = "admin";
      else if (dbRole === "driver") role = "driver";
      else role = "customer";
    } catch {
      // Keep a safe fallback so layout never crashes if profiles/RLS is off
      role = "customer";
    }
  }

  const portalHref =
    role === "admin" ? "/admin" : role === "driver" ? "/driver" : "/dashboard";

  return (
    <html lang="en">
      <body className="appBody">
        <PublicHeader
          isAuthed={!!session}
          role={role}
          portalHref={portalHref}
          userEmail={session?.user?.email ?? null}
        />

        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}