import Brand from "../../components/Brand";
import LogoutButton from "../../components/LogoutButton";

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section>
      <header
        style={{
          borderBottom: "3px solid #16a34a",
          background:
            "linear-gradient(180deg, rgba(22,163,74,0.10), #ffffff 60%)",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Brand href="/driver" role="driver" />
          <LogoutButton />
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {children}
      </main>
    </section>
  );
}