// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import PublicHeader from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Couranr",
  description: "Couranr OS — Delivery, Auto Rentals, and Docs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="appBody" suppressHydrationWarning>
        <PublicHeader />
        {/* Use div (not <main>) because page files already render <main className="page"> */}
        <div className="appMain">{children}</div>
      </body>
    </html>
  );
}