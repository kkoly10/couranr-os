export default function CheckoutLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#f9fafb",
          pointerEvents: "auto"
        }}
      >
        {children}
      </body>
    </html>
  );
}
