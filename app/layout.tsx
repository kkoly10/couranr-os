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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthed = !!session;

  return (
    <html lang="en">
      <body className="appBody">
        {/* Always render ONE header. It will hide itself on dashboard/admin paths. */}
        <PublicHeader initialIsAuthed={isAuthed} />

        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}