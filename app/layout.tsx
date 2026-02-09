import "./globals.css";
import type { Metadata } from "next";
import Navbar from "./ui/Navbar";
import Footer from "./ui/Footer";

export const metadata: Metadata = {
  title: "Couranr OS",
  description:
    "Couranr OS — One platform powering Couranr Auto Rentals and Courier Delivery.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
        <div className="min-h-screen">
          <Navbar />
          <main className="min-h-[70vh]">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}