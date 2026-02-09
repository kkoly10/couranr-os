import "./globals.css";
import type { Metadata } from "next";
import Navbar from "./ui/Navbar";
import Footer from "./ui/Footer";

export const metadata: Metadata = {
  title: "Couranr OS",
  description: "Couranr OS — Auto Rentals + Delivery + Docs, unified under one platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-white text-zinc-900">
          <Navbar />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
