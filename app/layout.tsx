import type { Metadata } from "next";
import "./globals.css";

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import PublicHeader from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthed = !!session;

  return (
    <html lang="en">
      <body className="appBody">
        {/* Public nav only when NOT authenticated */}
        {!isAuthed && <PublicHeader />}
        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}