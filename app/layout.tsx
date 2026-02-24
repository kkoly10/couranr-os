// app/layout.tsx
import "./globals.css";
import PublicHeader from "@/components/PublicHeader";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="appBody">
        <PublicHeader />
        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}