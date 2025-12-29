import AdminHeader from "../../components/AdminHeader";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section>
      <AdminHeader />
      <main style={{ padding: 24 }}>{children}</main>
    </section>
  );
}