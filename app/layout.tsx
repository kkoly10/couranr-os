import "./globals.css";
import Header from "../components/Header";

export const metadata = {
  title: "Couranr",
  description: "Online services, delivered to you."
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
