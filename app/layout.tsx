// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Couranr",
  description:
    "Local delivery, document services, and vehicle solutions — built for speed, clarity, and trust.",
  // Optional: once you upload favicon files in /public (later), these will work.
  // icons: {
  //   icon: [
  //     { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
  //     { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
  //   ],
  //   apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  // },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="appBody">
        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}