// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

/**
 * Favicon and PWA icons come from the approved app mark — a white `C` with the
 * gold motion accent on a navy rounded square — not from a retyped letter or a
 * mockup crop. Sources: Couranr_Canonical_Logo_System_v1.zip.
 */
export const metadata: Metadata = {
  title: "Couranr",
  description: "Couranr OS — Delivery, Auto Rentals, and Docs",
  icons: {
    icon: [
      { url: "/brand/couranr-app-icon.svg", type: "image/svg+xml" },
      { url: "/brand/couranr-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/couranr-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/couranr-app-icon-256.png", sizes: "256x256", type: "image/png" }],
  },
};

/**
 * Root layout — document shell only.
 *
 * `PublicHeader` used to be rendered here, which meant the legacy
 * "Auto | Courier | Docs | Open portal" navigation sat on top of EVERY
 * canonical Couranr screen: /sign-in, /sign-up, the merchant shell and the
 * Operations shell all inherited it. Browser verification caught it — it was
 * visible in all 28 screenshots and no unit test could see it.
 *
 * The header now belongs to the legacy segments that want it
 * (`app/auto`, `app/docs`, `app/admin`, … each mount it in their own layout)
 * and to `app/page.tsx`, the legacy marketing page. Canonical routes under
 * `app/(couranr)/` simply never compose it.
 *
 * This is structural: canonical screens never render the header at all, rather
 * than rendering it and hiding it afterwards.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="appBody" suppressHydrationWarning>
        {/* Use div (not <main>) because page files already render <main className="page"> */}
        <div className="appMain">{children}</div>
      </body>
    </html>
  );
}