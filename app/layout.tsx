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
        {/* Always render one global header. It will switch actions based on auth. */}
        <PublicHeader isAuthed={isAuthed} />

        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}