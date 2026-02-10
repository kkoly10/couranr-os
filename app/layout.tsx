import "./globals.css";
import type { Metadata } from "next";
import Navbar from "./ui/Navbar";
import Footer from "./ui/Footer";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Couranr — Premium Auto Rentals",
  description:
    "Couranr OS — premium auto rentals today, courier and docs coming soon. Unified platform for customers, drivers, and admin operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
          <Navbar />
          <main className="min-h-[60vh]">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}