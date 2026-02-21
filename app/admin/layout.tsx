import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import Brand from "@/components/Brand";
import LogoutButton from "@/components/LogoutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. Initialize Supabase on the server
  const supabase = createServerComponentClient({ cookies });

  // 2. Get the user session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login?next=/admin");
  }

  // 3. Verify the Admin Role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    // Kick standard users back to their dashboard
    redirect("/dashboard");
  }

  return (
    <section>
      <header
        style={{
          borderBottom: "3px solid #7c3aed",
          background:
            "linear-gradient(180deg, rgba(124,58,237,0.12), #ffffff 60%)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Brand href="/admin" role="admin" />

          <nav style={{ display: "flex", gap: 14 }}>
            <Link href="/admin" style={navLink}>
              🚚 Deliveries
            </Link>
            <Link href="/admin/auto" style={navLink}>
              🚗 Auto Rentals
            </Link>
            <span style={{ opacity: 0.4 }}>📄 Docs</span>
          </nav>

          <LogoutButton />
        </div>
      </header>

      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "28px 24px",
        }}
      >
        {children}
      </main>
    </section>
  );
}

const navLink: React.CSSProperties = {
  fontWeight: 800,
  textDecoration: "none",
  color: "#111",
};
