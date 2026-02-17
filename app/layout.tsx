// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="appBody">
        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}