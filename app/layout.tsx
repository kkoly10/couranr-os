// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Couranr",
  description: "Couranr OS — Delivery, Auto Rentals, and Docs",
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