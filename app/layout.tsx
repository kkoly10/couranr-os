import Header from "../components/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", color: "#111" }}>
        <Header />
        <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}