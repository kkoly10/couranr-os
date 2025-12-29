import DriverHeader from "../../components/DriverHeader";

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section>
      <DriverHeader />
      <main style={{ padding: 24 }}>{children}</main>
    </section>
  );
}