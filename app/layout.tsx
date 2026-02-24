// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

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
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#0b0f17",
          color: "#f9fafb",
        }}
      >
        {children}
      </body>
    </html>
  );
}