import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Couranr",
  description: "Couranr multi-service platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
